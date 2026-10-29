import Phaser from 'phaser';
import { BubbleLayer } from './bubbles';
import { EDITH_FRAMES, ULTRON_FRAMES } from './sprites';
import { drawEastWing } from './wing';
import type { Activity, Agent, Character, Point, WorldState } from '../../shared/types';
import { distance, canSee, HOUSE_ROOMS, INTERACTION_DISTANCE, isWalkable, ROOM_SIZE, ROOM_HEIGHT, TILE_SIZE } from '../../shared/room';

export interface WorldGameCallbacks {
  onMove(target: Point): void;
  onInteract(agentId: string): void;
  onApproach(agentId: string): void;
  onPlayerClick(): void;
  onPlayerPosition(x: number,y: number): void;
  onHint(text: string): void;
}

export interface WorldGame {
  setWorld(world: WorldState): void;
  setZoom(value: number): void;
  setOverview(value: boolean): void;
  focusAgent(agentId?: string): void;
  moveDirection(dx: number, dy: number): void;
  destroy(): void;
}

// Room art and navigation share a single fixed projection. These image-space
// coordinates stay unchanged when the canvas fits a phone or a large monitor.
const CHARACTER_SCALE = 0.29;
const CHARACTER_FRAME = 362;

function project(point: Point): Point {
  return {
    x: (point.x + .5) * TILE_SIZE,
    y: (point.y + .5) * TILE_SIZE,
  };
}

function unproject(x: number, y: number): Point {
  return { x: Math.floor(x / TILE_SIZE), y: Math.floor(y / TILE_SIZE) };
}

interface CharacterView {
  id: string;
  root: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  ring: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  prompt: Phaser.GameObjects.Text;
  chair: Phaser.GameObjects.Graphics;
  typing: Phaser.GameObjects.Graphics;
  seatPose?: 'work' | 'rest';
  seatAmount: number;
  motionTime: number;
  from: Point;
  target: Point;
  movedAt: number;
  activity: Activity;
  row: number;
  assistant: boolean;
  lastMessage: string | undefined;
  ultron: boolean;
  edith: boolean;
  eyes: Phaser.GameObjects.Graphics;
  thinking: boolean;
}

class RoomScene extends Phaser.Scene {
  private currentWorld?: WorldState;
  private readonly callbacks: WorldGameCallbacks;
  private views = new Map<string, CharacterView>();
  private ready = false;
  private bubbles?: BubbleLayer;
  private zoomFactor = 1;
  private overview = false;
  private cameraReady = false;
  private activeRoom: typeof HOUSE_ROOMS[number] = HOUSE_ROOMS[2];
  private cameraTarget = {x:384,y:720,zoom:1};
  private baselineSet = false;
  private seenMessages = new Set<string>();
  private seenSpeech?: string;
  private marker?: Phaser.GameObjects.Graphics;
  private markerTime = 0;
  private heldKeys = new Set<string>();
  private lastMove = 0;
  private pendingInteraction = false;
  private interactingAgentId = 'ultron_001';
  private approachStarted = 0;
  private approachUpdated = 0;
  private lastHint = -1000;
  private ambientLights: Phaser.GameObjects.Ellipse[] = [];
  private dust: Array<{ dot: Phaser.GameObjects.Rectangle; x: number; y: number; phase: number }> = [];
  private readonly handleKeyDown: (event: KeyboardEvent) => void;
  private readonly handleKeyUp: (event: KeyboardEvent) => void;
  private readonly handleBlur: () => void;

  constructor(callbacks: WorldGameCallbacks) {
    super({ key: 'home' });
    this.callbacks = callbacks;
    this.handleKeyDown = event => {
      if (this.isTextInput(event.target)) return;
      const key = event.key.toLowerCase();
      if (!['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright', 'e', 'escape'].includes(key)) return;
      event.preventDefault();
      if (key === 'escape') { this.pendingInteraction = false; this.heldKeys.clear(); return; }
      if (key === 'e' && !event.repeat) {
        const nearby=this.nearestResident();
        if(nearby)this.interact(nearby.id); else this.hint('Podejdź bliżej mieszkańca.');
        return;
      }
      this.heldKeys.add(key);
    };
    this.handleKeyUp = event => { this.heldKeys.delete(event.key.toLowerCase()); };
    this.handleBlur = () => this.heldKeys.clear();
  }

  preload() {
    this.load.image('room', '/assets/house-six-rooms.png');
    this.load.spritesheet('characters', '/assets/characters.png', { frameWidth: CHARACTER_FRAME, frameHeight: CHARACTER_FRAME });
    this.load.image('ultron', '/assets/ultron.png');
    this.load.image('edith', '/assets/edith.png');
  }

  create() {
    ULTRON_FRAMES.forEach((frame,index) => this.textures.get('ultron').add(index,0,frame.x,frame.y,frame.width,frame.height));
    const edithTexture = this.textures.get('edith');
    EDITH_FRAMES.forEach((frame,index) => edithTexture.add(index,0,frame.x,frame.y,frame.width,frame.height));
    this.bubbles = new BubbleLayer(this.game.canvas.parentElement!);
    this.game.canvas.setAttribute('aria-label', 'Dom z góry: salon, pracownia, sypialnia, kuchnia, biblioteka i pokój gier. Steruj sobą strzałkami lub WASD. Kliknij własną postać, aby napisać dymek.');
    this.game.canvas.setAttribute('role', 'img');
    this.game.canvas.style.touchAction = 'none';
    this.cameras.main.setBackgroundColor('#262822');
    drawEastWing(this);
    for (const point of [{ x: 1145, y: 109 }, { x: 94, y: 772 }, { x: 985, y: 119 }]) {
      this.ambientLights.push(this.add.ellipse(point.x, point.y, 25, 35, 0xffe5a4, 0.1).setDepth(1));
    }
    for (let index = 0; index < 12; index++) {
      const x = 200 + (index * 83) % 600;
      const y = 290 + (index * 67) % 340;
      this.dust.push({ dot: this.add.rectangle(x, y, 2, 2, 0xe9ca84, 0.4).setDepth(50), x, y, phase: index * 1.7 });
    }
    this.marker = this.add.graphics().setDepth(2).setVisible(false);
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer, objects: Phaser.GameObjects.GameObject[]) => {
      if (objects.length) return;
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const target = unproject(worldPoint.x, worldPoint.y);
      if (!isWalkable(target)) {
        if (target.x >= 0 && target.y >= 0 && target.x < ROOM_SIZE && target.y < ROOM_HEIGHT) this.hint('Wybierz wolne miejsce na podłodze.');
        return;
      }
      this.pendingInteraction = false;
      this.moveTo(target);
    });
    this.scale.on('resize', this.resize, this);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', this.handleKeyDown);
      window.removeEventListener('keyup', this.handleKeyUp);
      window.removeEventListener('blur', this.handleBlur);
      this.scale.off('resize', this.resize, this);
      this.bubbles?.destroy();
    });
    this.ready = true;
    this.resize();
    if (this.currentWorld) this.setWorld(this.currentWorld);
  }

  private isTextInput(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  }

  private resize() {
    if (!this.ready) return;
    const width = this.scale.width;
    const height = this.scale.height;
    const room = this.activeRoom;
    const fit = this.overview
      ? Math.min(width / (ROOM_SIZE*TILE_SIZE+64), (height-100) / 1024)
      : Math.min(width / ((room.width+2)*TILE_SIZE+60), (height-120) / ((room.height+2)*TILE_SIZE));
    this.cameraTarget = {
      x:this.overview ? ROOM_SIZE*TILE_SIZE/2 : (room.x+room.width/2)*TILE_SIZE,
      y:this.overview ? 490 : (room.y+room.height/2)*TILE_SIZE,
      zoom:Math.max(.15,fit*this.zoomFactor),
    };
    if (!this.cameraReady) {
      this.cameras.main.setZoom(this.cameraTarget.zoom).centerOn(this.cameraTarget.x,this.cameraTarget.y);
      this.cameraReady = true;
    }
  }

  setZoom(value: number) {
    this.zoomFactor = Phaser.Math.Clamp(value > 6 ? value / 100 : value, 1, 4);
    this.resize();
  }

  setOverview(value: boolean) { this.overview=value; this.zoomFactor=1; this.resize(); }

  setWorld(world: WorldState) {
    this.currentWorld = world;
    if (!this.ready) return;
    if (!this.baselineSet) {
      world.messages.forEach(m => this.seenMessages.add(m.id));
      this.seenSpeech = world.playerSpeech?.id;
      this.baselineSet = true;
      this.cameraReady = false;
    }
    const nextRoom = HOUSE_ROOMS.find(r => world.player.position.x>=r.x && world.player.position.x<r.x+r.width && world.player.position.y>=r.y && world.player.position.y<r.y+r.height);
    if (nextRoom && nextRoom.id!==this.activeRoom.id) { this.activeRoom=nextRoom; this.resize(); }
    if (!this.cameraReady) this.resize();
    const activeIds = new Set([world.player.id, ...world.agents.map(a => a.id)]);
    for (const [id, view] of this.views) if (!activeIds.has(id)) {
      view.root.destroy(); this.bubbles?.hide(id); this.views.delete(id);
    }
    for (const character of [world.player, ...world.agents]) {
      let view = this.views.get(character.id);
      if (!view) {
        view = this.createCharacter(character, character.id !== world.player.id);
        this.views.set(character.id, view);
      }
      const target = project(character.position);
      if (target.x !== view.target.x || target.y !== view.target.y) {
        view.from = { x: view.root.x, y: view.root.y };
        view.target = target;
        view.movedAt = this.time.now;
        if (view.ultron || view.edith) {
          const back = target.y < view.root.y;
          const left = target.x < view.root.x;
          view.row = back ? (left ? 12 : 18) : left ? 6 : 0;
          view.sprite.setFlipX(false);
        } else view.sprite.setFlipX(target.x < view.root.x);
      }
      if (character.activity === 'working') view.seatPose='work';
      else if (character.activity === 'resting') view.seatPose='rest';
      else if (character.activity !== 'talking') view.seatPose=undefined;
      view.activity = character.activity;
      view.thinking = view.assistant && (character as Agent).ai?.status === 'thinking';
      const latest = world.messages.filter(m=>m.role==='assistant' && m.agentId===character.id).at(-1);
      if (view.assistant && latest && !this.seenMessages.has(latest.id)) {
        this.seenMessages.add(latest.id);
        if (distance(character.position,world.player.position)<=7 && canSee(character.position,world.player.position)) this.showBubble(view,latest.text);
      }
      if (!view.assistant && world.playerSpeech && world.playerSpeech.id!==this.seenSpeech) {
        this.seenSpeech=world.playerSpeech.id;
        if (world.simTime<world.playerSpeech.expiresAt) this.bubbles?.show(view.id,'TY',world.playerSpeech.text,true);
      }
      if (!view.assistant && world.playerSpeech && world.simTime>=world.playerSpeech.expiresAt) this.bubbles?.hide(view.id);
    }
    if (this.pendingInteraction) this.checkApproach();
  }

  private createCharacter(character: Character, assistant: boolean): CharacterView {
    const point = project(character.position);
    const root = this.add.container(point.x, point.y).setDepth(100 + point.y);
    const ring = this.add.graphics();
    const skin = assistant ? (character as Agent).profile.skin : 'player';
    const ultron = skin === 'ultron';
    const edith = skin === 'edith';
    ring.lineStyle(2, ultron ? 0xbd3041 : edith ? 0x6a83c3 : assistant ? 0x4d8b77 : 0xc26337, 0.6);
    ring.strokePoints([{ x: 0, y: -9 }, { x: 24, y: 3 }, { x: 0, y: 15 }, { x: -24, y: 3 }], true);
    const shadow = this.add.ellipse(0, 1, 30, 13, 0x433827, 0.2);
    const row = assistant ? 0 : 6;
    const sprite = this.add.sprite(0, 3, ultron ? 'ultron' : edith ? 'edith' : 'characters', ultron || edith ? 0 : row).setScale(ultron || edith ? .37 : CHARACTER_SCALE).setOrigin(0.5, ultron || edith ? 1 : .95);
    sprite.setInteractive({ useHandCursor: true });
    sprite.on('pointerdown', (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      if (assistant) this.interact(character.id); else this.callbacks.onPlayerClick();
    });
    const label = this.add.text(0, -103, assistant ? character.name.toUpperCase() : 'TY', {
      fontFamily: 'Arial, sans-serif', fontSize: '12px', color: '#f4f0dd', fontStyle: 'bold',
      backgroundColor: '#1b2431cc', padding: { x: 6, y: 3 },
    }).setOrigin(0.5, 0).setResolution(2);
    const prompt=this.add.text(0,21,'E · Porozmawiaj',{fontFamily:'Arial, sans-serif',fontSize:'12px',color:'#f5f5e9',backgroundColor:'#20384be8',padding:{x:9,y:6}}).setOrigin(.5,0).setResolution(2).setVisible(false).setInteractive({useHandCursor:true});
    prompt.on('pointerdown',(_p:unknown,_x:unknown,_y:unknown,event:Phaser.Types.Input.EventData)=>{event.stopPropagation();this.interact(character.id);});
    const chair=this.add.graphics();
    chair.fillStyle(0x202a3b).fillRoundedRect(-21,-49,42,52,5);
    chair.fillStyle(0x435c79).fillRoundedRect(-18,-46,36,27,4);
    chair.fillStyle(0x72879c).fillRect(-15,-42,30,3);
    chair.fillStyle(0x233344).fillRect(-24,-15,48,10);
    chair.fillStyle(0x8d9aa3).fillRect(-3,-3,6,8).fillRect(-18,5,36,3);
    chair.setVisible(false);
    const typing=this.add.graphics();
    typing.fillStyle(ultron?0xff4155:0x7bceef,.65).fillRect(9,-29,10,2).fillRect(19,-32,6,2);
    typing.setVisible(false);
    const eyes = this.add.graphics();
    if (ultron) { eyes.fillStyle(0xff253b, .25).fillEllipse(12, -67, 12, 6); eyes.fillStyle(0xff5865, .55).fillEllipse(12, -67, 7, 2); }
    root.add([ring, shadow, chair, sprite, typing, eyes, label, prompt]);
    return { id: character.id, root, sprite, shadow, ring, label, prompt, chair, typing, seatAmount: ['working','resting'].includes(character.activity)?1:0, seatPose:character.activity==='working'?'work':character.activity==='resting'?'rest':undefined, motionTime:0, from: point, target: point, movedAt: 0, activity: character.activity, row, assistant, lastMessage: undefined, ultron, edith, eyes, thinking: false };
  }

  private nearestResident(): Agent | undefined {
    const world=this.currentWorld;if(!world)return;
    return world.agents.filter(a=>distance(a.position,world.player.position)<=INTERACTION_DISTANCE&&canSee(a.position,world.player.position)).sort((a,b)=>distance(a.position,world.player.position)-distance(b.position,world.player.position))[0];
  }

  private showBubble(view: CharacterView, text: string) {
    this.bubbles?.show(view.id,view.label.text,text);
  }

  private hint(text: string) {
    if (this.time.now - this.lastHint < 800) return;
    this.lastHint = this.time.now;
    this.callbacks.onHint(text);
  }

  private moveTo(target: Point) {
    if (!this.currentWorld?.running) {
      this.hint(this.currentWorld?.started ? 'Świat jest wstrzymany. Naciśnij WZNÓW.' : 'Naciśnij START, żeby wejść do świata.');
      return;
    }
    if (!isWalkable(target)) return;
    this.callbacks.onMove(target);
    const point = project(target);
    this.marker?.clear().lineStyle(2, 0xc9673f, 0.8).strokePoints([
      { x: point.x, y: point.y - 13 }, { x: point.x + 26, y: point.y },
      { x: point.x, y: point.y + 13 }, { x: point.x - 26, y: point.y },
    ], true).setVisible(true).setAlpha(1);
    this.markerTime = this.time.now;
  }

  moveDirection(dx: number, dy: number) {
    const world = this.currentWorld;
    if (!world) return;
    this.pendingInteraction = false;
    const gridX = Math.sign(dx);
    const gridY = Math.sign(dy);
    const target = { x: Math.round(world.player.position.x) + gridX, y: Math.round(world.player.position.y) + gridY };
    if (isWalkable(target)) this.moveTo(target);
    else if (isWalkable({ x: target.x, y: Math.round(world.player.position.y) })) this.moveTo({ x: target.x, y: Math.round(world.player.position.y) });
    else if (isWalkable({ x: Math.round(world.player.position.x), y: target.y })) this.moveTo({ x: Math.round(world.player.position.x), y: target.y });
  }

  interact(agentId = this.interactingAgentId) {
    this.interactingAgentId = agentId;
    const world = this.currentWorld;
    const agent = world?.agents.find(a => a.id === agentId);
    if (!world || !agent) return;
    this.callbacks.onApproach(agent.id);
    if (distance(world.player.position, agent.position) <= INTERACTION_DISTANCE && canSee(world.player.position,agent.position)) {
      this.pendingInteraction = false;
      this.callbacks.onInteract(agent.id);
      return;
    }
    if (!world.running) {
      this.hint(world.started ? 'Wznów świat, aby podejść do mieszkańca.' : 'Naciśnij START, aby podejść do mieszkańca.');
      return;
    }
    this.pendingInteraction = true;
    this.approachStarted = this.time.now;
    this.approachUpdated = -2000;
    this.hint('Podchodzisz do postaci ' + agent.name + '…');
    this.checkApproach();
  }

  private checkApproach() {
    const world = this.currentWorld;
    const agent = world?.agents.find(a => a.id === this.interactingAgentId);
    if (!world || !agent) return;
    if (distance(world.player.position, agent.position) <= INTERACTION_DISTANCE && canSee(world.player.position,agent.position)) {
      this.pendingInteraction = false;
      this.callbacks.onInteract(agent.id);
      return;
    }
    if (this.time.now - this.approachStarted > 20_000) {
      this.pendingInteraction = false;
      this.hint('Postać jest w ruchu. Spróbuj podejść ponownie.');
      return;
    }
    if (!world.running || this.time.now - this.approachUpdated < 1500) return;
    const choices: Point[] = [];
    for (let x = 0; x < ROOM_SIZE; x++) for (let y = 0; y < ROOM_HEIGHT; y++) {
      const point = { x, y };
      if (isWalkable(point) && distance(point, agent.position) <= 1.8 && distance(point, agent.position) >= 1 && canSee(point,agent.position)) choices.push(point);
    }
    choices.sort((a, b) => distance(a, world.player.position) - distance(b, world.player.position));
    const target = choices[0];
    if (target) { this.moveTo(target); this.approachUpdated = this.time.now; }
  }

  update(time: number, delta: number) {
    if (!this.ready) return;
    const camera=this.cameras.main;
    const blend=1-Math.exp(-delta/190);
    camera.setZoom(Phaser.Math.Linear(camera.zoom,this.cameraTarget.zoom,blend));
    camera.centerOn(Phaser.Math.Linear(camera.midPoint.x,this.cameraTarget.x,blend),Phaser.Math.Linear(camera.midPoint.y,this.cameraTarget.y,blend));
    const running = Boolean(this.currentWorld?.running);
    if (running) {
      this.ambientLights.forEach((light, index) => light.setAlpha(0.08 + (Math.sin(time / 900 + index) + 1) * 0.025));
      this.dust.forEach(({ dot, x, y, phase }) => dot.setPosition(x + Math.sin(time / 4500 + phase) * 14, y + Math.cos(time / 5200 + phase) * 10).setAlpha((Math.sin(time / 1900 + phase) + 1) * 0.15));
    }
    for (const view of this.views.values()) {
      const progress = view.thinking ? 1 : Phaser.Math.Clamp((time - view.movedAt) / 320, 0, 1);
      view.root.setPosition(Phaser.Math.Linear(view.from.x, view.target.x, progress), Phaser.Math.Linear(view.from.y, view.target.y, progress));
      view.root.setDepth(100 + view.root.y);
      const walking = running && !view.thinking && (view.activity === 'walking' || progress < 1);
      if(running && !view.thinking) {
        view.motionTime+=delta;
        view.seatAmount=Phaser.Math.Linear(view.seatAmount,view.seatPose?1:0,1-Math.exp(-delta/130));
      }
      const phase=view.motionTime;
      const seated=Boolean(view.seatPose);
      const frame=walking?[0,1,0,2][Math.floor(phase/95)%4]:seated?(view.seatPose==='work'?3:4):view.thinking?0:view.activity==='talking'?5:0;
      view.sprite.setFrame(view.row+frame);
      const baseScale=view.ultron||view.edith ? .37 : CHARACTER_SCALE;
      view.sprite.setScale(baseScale,baseScale*(1-(seated?(1-view.seatAmount)*.06:view.seatAmount*.06)));
      view.chair.setVisible(view.edith && view.seatAmount>.02).setAlpha(view.seatAmount);
      view.typing.setVisible(seated && view.seatPose==='work' && !view.thinking).setAlpha(.4+Math.sin(phase/120)*.3).setY(Math.floor(phase/100)%2);
      view.eyes.setVisible(view.ultron && view.row<12 && frame<3).setAlpha(.2+(Math.sin(phase/650)+1)*.08).setScale(view.row===6?-1:1,1);
      const breathe=Math.sin(phase/900)*.5;
      if(!view.thinking) {
        view.sprite.y=3+(walking?-Math.abs(Math.sin(phase/120))*1.5:breathe)+(seated?(1-view.seatAmount)*-4:view.seatAmount*3);
        view.sprite.angle=walking?Math.sin(phase/120)*.6:view.activity==='talking'?Math.sin(phase/360)*.7:0;
      }
      view.shadow.setScale(seated?1.15:walking?.96+Math.abs(Math.sin(phase/120))*.06:1);
      view.ring.setAlpha(view.assistant && this.pendingInteraction && view.id===this.interactingAgentId ? .75:.25);
      view.label.setScale(Math.min(1.4,.8/camera.zoom));
      view.label.setY(seated?-85:-103);
      const nearest=this.nearestResident();
      view.prompt.setVisible(running && !view.thinking && nearest?.id===view.id && !document.body.classList.contains('composing')).setScale(Math.min(1.4,.85/camera.zoom));
      if(!view.assistant)this.callbacks.onPlayerPosition((view.root.x-camera.worldView.x)*camera.zoom,(view.root.y-108-camera.worldView.y)*camera.zoom);
      this.bubbles?.position(view.id,(view.root.x-camera.worldView.x)*camera.zoom,(view.root.y-108-camera.worldView.y)*camera.zoom);
    }
    this.bubbles?.layout();
    if (this.marker?.visible) this.marker.setAlpha(Math.max(0, 1 - (time - this.markerTime) / 1500));
    if (this.heldKeys.size && time - this.lastMove > 240 && !this.isTextInput(document.activeElement)) {
      let dx = 0, dy = 0;
      if (this.heldKeys.has('a') || this.heldKeys.has('arrowleft')) dx--;
      if (this.heldKeys.has('d') || this.heldKeys.has('arrowright')) dx++;
      if (this.heldKeys.has('w') || this.heldKeys.has('arrowup')) dy--;
      if (this.heldKeys.has('s') || this.heldKeys.has('arrowdown')) dy++;
      if (dx || dy) this.moveDirection(dx, dy);
      this.lastMove = time;
    }
  }
}

export function createWorldGame(parent: HTMLElement, callbacks: WorldGameCallbacks): WorldGame {
  const scene = new RoomScene(callbacks);
  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    backgroundColor: '#262822',
    pixelArt: true,
    antialias: false,
    banner: false,
    audio: { noAudio: true },
    input: { activePointers: 2, touch: { capture: true } },
    scale: { mode: Phaser.Scale.RESIZE, width: Math.max(1, parent.clientWidth), height: Math.max(1, parent.clientHeight) },
    render: { roundPixels: true },
    scene: [scene],
    fps: { target: 60 },
  });
  const resizeObserver = new ResizeObserver(() => {
    if (game.isBooted && parent.clientWidth && parent.clientHeight) game.scale.resize(parent.clientWidth, parent.clientHeight);
  });
  resizeObserver.observe(parent);
  return {
    setWorld: world => scene.setWorld(world),
    setZoom: value => scene.setZoom(value),
    setOverview: value => scene.setOverview(value),
    focusAgent: id => scene.interact(id),
    moveDirection: (dx, dy) => scene.moveDirection(dx, dy),
    destroy: () => { resizeObserver.disconnect(); game.destroy(true); },
  };
}
