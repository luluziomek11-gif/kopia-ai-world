import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Simulation, initialWorld } from '../server/simulation.js';
import { WorldStore } from '../server/store.js';
import { JSONProvider, type AIProvider } from '../server/providers.js';
import { clientMessageSchema, decisionSchema, replySchema } from '../server/validation.js';
import { addressedResident } from '../shared/conversation.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const sink = () => {};
const fake = (model: string, onReply = () => {}): AIProvider => ({
  name: 'ollama', model, health: async () => {},
  decide: async () => ({ action: 'observe', reason: 'Czytam w bibliotece.', room: 'library' }),
  chat: async () => { onReply(); return { reply: 'Cześć z ' + model, memory: 'Zapamiętana rozmowa z graczem.' }; },
});
function placeTogether(engine: Simulation) {
  engine.world.player.position = { x: 11, y: 7 };
  engine.world.agents[0].position = { x: 11, y: 6 };
  engine.world.agents[1].position = { x: 13, y: 7 };
}

test('addressed bubble reaches Ultron only, even when Edith is closer and both can hear', async () => {
  let edithReplies = 0, ultronReplies = 0;
  const engine = new Simulation(new WorldStore(':memory:'), fake('gemma', () => edithReplies++), sink, 1000, { ultron_001: fake('gpt-oss', () => ultronReplies++) }, 'edith_002');
  try {
    placeTogether(engine);
    engine.handle({ type: 'say', text: 'Cześć, Ultronie.', agentId: 'ultron_001' }, sink);
    engine.tick(.1); await settle();
    assert.equal(edithReplies, 0); assert.equal(ultronReplies, 1);
    assert.equal(engine.world.playerSpeech?.targetAgentId, 'ultron_001');
    assert.deepEqual(engine.world.playerSpeech?.heardBy, ['ultron_001']);
    for (let i=0; i<5; i++) { engine.tick(.1); await settle(); }
    assert.equal(edithReplies, 0); assert.equal(ultronReplies, 1);
    assert.ok(engine.world.messages.every(message => message.agentId === 'ultron_001'));
  } finally { engine.close(); }
});

test('unaddressed bubble latches its first nearby listener and unknown recipients are rejected', async () => {
  let edithReplies = 0, ultronReplies = 0;
  const engine = new Simulation(new WorldStore(':memory:'), fake('gemma', () => edithReplies++), sink, 1000, { ultron_001: fake('gpt-oss', () => ultronReplies++) }, 'edith_002');
  try {
    placeTogether(engine);
    let error = '';
    engine.handle({ type: 'say', text: 'Nieznany.', agentId: 'missing' }, m => { if (m.type === 'error') error=m.message; });
    assert.equal(error, 'Nieznany rozmówca.'); assert.equal(Boolean(engine.world.playerSpeech), false);
    engine.handle({ type: 'say', text: 'Cześć.' }, sink);
    engine.tick(.1); await settle();
    assert.equal(engine.world.playerSpeech?.targetAgentId, 'edith_002');
    engine.world.agents[1].position = { x: 11, y: 7 };
    engine.tick(.1); await settle();
    assert.equal(edithReplies, 1); assert.equal(ultronReplies, 0);
  } finally { engine.close(); }
});

test('restart restores dialogue and memory but never replays an old on-screen utterance', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'speech-restart-'));
  const file = join(folder, 'world.sqlite');
  let replies = 0;
  try {
    const first = new Simulation(new WorldStore(file), fake('gemma', () => replies++), sink, 1000, {}, 'edith_002');
    first.world.player.position = { x:11, y:7 };
    first.handle({ type:'say', text:'Zapamiętaj nasze spotkanie.', agentId:'edith_002' }, sink);
    first.tick(.1); await settle(); first.close();
    assert.equal(replies, 1);
    const restored = new Simulation(new WorldStore(file), fake('gemma', () => replies++), sink, 1000, {}, 'edith_002');
    try {
      assert.equal(restored.world.playerSpeech, undefined);
      assert.equal(restored.store.history(100,'edith_002').messages.length, 2);
      assert.equal(restored.store.history(100,'edith_002').memories.length, 1);
      restored.tick(.1); await settle(); assert.equal(replies, 1);
    } finally { restored.close(); }
  } finally { rmSync(folder,{recursive:true,force:true}); }
});

class Responses extends JSONProvider {
  readonly name='ollama' as const;
  readonly model='test';
  calls: {prompt:string;schema:object;input:string}[]=[];
  constructor(private outputs: unknown[]) { super(); }
  health=async()=>{};
  protected async generate(prompt:string,_input:string,schema:object):Promise<unknown> {
    this.calls.push({prompt,schema,input:_input});
    const result=this.outputs.shift();
    if(result instanceof Error)throw result;
    return result;
  }
}
const signal = () => new AbortController().signal;

test('malformed JSON and engine metadata inside dialogue trigger one real-generation retry', async () => {
  for (const invalid of [
    new SyntaxError('Unterminated string in JSON'),
    {reply:'Cześć! {relationship:ultron_001, affinityChange:5, note:'},
    {reply:'Cześć!',activity:'talking'},
  ]) {
    const provider=new Responses([invalid,{reply:'Cześć! Co wymyślimy dzisiaj?',memory:'Przywitanie gracza.'}]);
    const result=await provider.chat(initialWorld(fake('gemma'),'edith_002'),signal());
    assert.equal(result.reply,'Cześć! Co wymyślimy dzisiaj?');
    assert.equal(provider.calls.length,2);
    assert.ok(provider.calls[1].prompt.includes('Poprzednia odpowiedź była niepoprawna'));
  }
});

test('spoken names address the right resident without an explicit UI recipient', async () => {
  for (const greeting of ['hej ultron', 'Cześć, Ultronie!', 'Ultron, co robisz?']) {
    let edithReplies=0,ultronReplies=0;
    const engine=new Simulation(new WorldStore(':memory:'),fake('gemma',()=>edithReplies++),sink,1000,{ultron_001:fake('gpt-oss',()=>ultronReplies++)},'edith_002');
    try {
      placeTogether(engine);
      engine.handle({type:'say',text:greeting},sink); await settle();
      assert.equal(ultronReplies,1); assert.equal(edithReplies,0);
      assert.equal(engine.world.playerSpeech?.targetAgentId,'ultron_001');
    } finally {engine.close();}
  }
  assert.equal(addressedResident('Hej E.D.I.T.H., co robisz?'),'edith_002');
  assert.equal(addressedResident('Edi, opowiedz mi coś.'),'edith_002');
  assert.equal(addressedResident('Co sądzisz o Ultronie?'),undefined);
});

test('resident waits while the player writes and reads, then resumes after the player leaves', async () => {
  const engine=new Simulation(new WorldStore(':memory:'),fake('gemma'),sink,5,{ultron_001:fake('gpt-oss')},'edith_002');
  try {
    placeTogether(engine); await engine.checkHealth();
    const ultron=engine.world.agents[1], start={...ultron.position};
    engine.handle({type:'conversation',agentId:ultron.id},sink);
    for(let i=0;i<30;i++){engine.tick(1);await settle();}
    assert.deepEqual(ultron.position,start);
    assert.equal(engine.world.decisions.filter(d=>d.agentId===ultron.id).length,0);
    engine.handle({type:'say',text:'Hej Ultron'},sink);await settle();
    for(let i=0;i<35;i++){engine.tick(1);await settle();}
    assert.deepEqual(ultron.position,start);
    assert.equal(engine.world.decisions.filter(d=>d.agentId===ultron.id).length,0);
    engine.world.player.position={x:10,y:14};
    for(let i=0;i<2;i++){engine.tick(1);await settle();}
    assert.ok(engine.world.decisions.some(d=>d.agentId===ultron.id));
  } finally {engine.close();}
});

test('player interrupts an autonomous conversation and stale social generation cannot replace their reply', async () => {
  let call=0, finishSocial:((value:{reply:string})=>void)|undefined;
  const edith:AIProvider={...fake('gemma'),decide:async()=>({action:'talk',targetAgentId:'ultron_001',say:'Pogadamy?',reason:'Rozmowa.'})};
  const ultron:AIProvider={...fake('gpt-oss'),chat:async(_world,_signal,incoming)=>{
    call++;
    if(incoming?.fromId!=='player')return new Promise(resolve=>finishSocial=resolve);
    assert.equal(incoming.text,'hej ultron');return {reply:'Słucham cię, człowieku.'};
  }};
  const engine=new Simulation(new WorldStore(':memory:'),edith,sink,1000,{ultron_001:ultron},'edith_002');
  try{
    placeTogether(engine);await engine.checkHealth();await engine.decide('edith_002');engine.tick(.1);await settle();
    assert.equal(call,1);
    engine.handle({type:'say',text:'hej ultron'},sink);await settle();
    assert.equal(call,2);
    finishSocial?.({reply:'Odpowiadam Edith, nie graczowi.'});await settle();
    assert.equal(engine.world.messages.at(-1)?.text,'Słucham cię, człowieku.');
    assert.equal(engine.world.messages.at(-1)?.targetAgentId,'player');
    assert.ok(!engine.world.messages.some(m=>m.text.includes('Odpowiadam Edith')));
  } finally{engine.close();}
});

test('chat generation receives the exact incoming text and a history limited to that conversation',async()=>{
  const provider=new Responses([{reply:'Witaj, człowieku.'}]);
  const world=initialWorld(fake('gpt-oss'),'ultron_001');
  world.messages=[
    {id:'1',timestamp:1,role:'user',agentId:'ultron_001',text:'Pamiętasz mnie?'},
    {id:'2',timestamp:2,role:'assistant',agentId:'edith_002',targetAgentId:'ultron_001',text:'Zagrajmy w szachy!'},
    {id:'3',timestamp:3,role:'assistant',agentId:'ultron_001',targetAgentId:'edith_002',text:'Idę do ciebie.'},
  ];
  await provider.chat(world,signal(),{fromId:'player',text:'hej ultron'});
  const input=JSON.parse(provider.calls[0].input);
  assert.deepEqual(input.messageToAnswer,{speaker:'player',recipient:'ultron_001',text:'hej ultron'});
  assert.deepEqual(input.background.conversation.map((m:{text:string})=>m.text),['Pamiętasz mnie?']);
  assert.equal(replySchema.safeParse({reply:'x'.repeat(421)}).success,false);
});

test('invalid dialogue fails after two attempts without a fabricated or truncated reply', async () => {
  const bad={reply:'Plan! {"affinityChange":5}'};
  const provider=new Responses([bad,bad,{reply:'Nie wolno wykonać trzeciej próby.'}]);
  await assert.rejects(()=>provider.chat(initialWorld(fake('gemma'),'edith_002'),signal()));
  assert.equal(provider.calls.length,2);
  assert.ok(replySchema.safeParse({reply:'Zbiór {1, 2, 3} wygląda całkiem dobrze.',relationship:{targetId:'player',affinityChange:2,note:'Dobry pomysł.'}}).success);
});

test('room and movement protocols admit the new wing, and invalid decisions can be retried', async () => {
  assert.ok(clientMessageSchema.safeParse({type:'move',target:{x:39,y:6}}).success);
  assert.equal(clientMessageSchema.safeParse({type:'move',target:{x:48,y:6}}).success,false);
  assert.ok(clientMessageSchema.safeParse({type:'say',text:'Cześć.',agentId:'ultron_001'}).success);
  assert.ok(decisionSchema.safeParse({action:'wander',reason:'Odwiedzam pokój gier.',room:'arcade'}).success);
  const provider=new Responses([{action:'observe',reason:'Patrzę.',say:'{memory:abc}'},{action:'observe',reason:'Czytam.',room:'library'}]);
  const result=await provider.decide(initialWorld(fake('gemma'),'edith_002'),signal());
  assert.equal(result.room,'library'); assert.equal(provider.calls.length,2);
  assert.ok(JSON.stringify(provider.calls[1].schema).includes('arcade'));
});
