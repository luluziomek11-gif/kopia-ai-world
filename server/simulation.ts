import { randomUUID } from 'node:crypto';
import { canSee, distance, HOUSE_ROOMS, INTERACTION_DISTANCE, isWalkable, ROOM_SIZE, ROOM_HEIGHT, SPAWNS, SPOTS } from '../shared/room.js';
import type { Agent, AgentAction, AgentEvent, ClientMessage, Point, ServerMessage, WorldState } from '../shared/types.js';
import { findPath } from './pathfinding.js';
import type { AIProvider, ModelDecision, ModelReply } from './providers.js';
import { decisionSchema, replySchema } from './validation.js';
import { WorldStore } from './store.js';
import { createAgent, defaultProfile } from './profiles.js';
import { addressedResident } from '../shared/conversation.js';

export function initialWorld(provider: AIProvider, primaryAgentId = 'mika'): WorldState {
  const primary = createAgent(primaryAgentId, provider.name, provider.model, { ...SPAWNS[primaryAgentId as keyof typeof SPAWNS] ?? SPAWNS.mika });
  return { version: 1, mapVersion: 2, started: true, running: true, simTime: 0, savedAt: null,
    player: { id: 'player', name: 'Ty', position: { ...SPAWNS.player }, activity: 'idle' },
    agents: [primary], decisions: [], messages: [], memories: [], events: [], ai: primary.ai };
}
interface Runtime { path: Point[]; action: AgentAction; nextDecision: number; talkUntil: number; pendingTalk?: { targetId: string; say: string; expires: number } }
type Generation = { controller: AbortController; kind: 'decision' | 'chat'; agentId: string; fromId?: string };

/** Models return validated data; only this authoritative engine can change the world. */
export class Simulation {
  readonly world: WorldState;
  readonly providers = new Map<string, AIProvider>();
  private runtimes = new Map<string, Runtime>();
  private playerPath: Point[] = [];
  private movementBudget = 0;
  private generation?: Generation;
  private attention?: { agentId: string; until: number; approaching: boolean };
  private socialReplies: { agentId: string; fromId: string }[] = [];
  private healthBusy = false;
  private closed = false;

  constructor(readonly store: WorldStore, readonly provider: AIProvider, private publish: (message: ServerMessage) => void, private decisionInterval = 30, additionalProviders: Record<string, AIProvider> = {}, readonly primaryAgentId = 'mika') {
    this.providers.set(primaryAgentId, provider);
    for (const [id, model] of Object.entries(additionalProviders)) this.providers.set(id, model);
    this.world = store.load() ?? initialWorld(provider, primaryAgentId);
    // The journal persists; an on-screen utterance belongs to its original live session.
    delete this.world.playerSpeech;
    this.world.events ??= [];
    for (const memory of this.world.memories) memory.agentId ??= 'mika';
    for (const [id, model] of this.providers) {
      let agent = this.world.agents.find(a => a.id === id);
      if (!agent) {
        agent = this.world.archivedAgents?.find(a => a.id === id) ?? createAgent(id, model.name, model.model, { ...SPAWNS[id as keyof typeof SPAWNS] ?? SPAWNS.mika });
        this.world.agents.push(agent);
      }
      agent.profile = store.profile(id) ?? agent.profile ?? defaultProfile(id, model.name, model.model);
      agent.profile.model = model.model; agent.profile.provider = model.name;
      agent.ai = { provider: model.name, model: model.model, status: 'checking' };
      this.runtimes.set(id, { path: [], action: 'wander', nextDecision: this.world.simTime + 2 + this.runtimes.size * 5, talkUntil: 0 });
    }
    const inactive = this.world.agents.filter(a => !this.providers.has(a.id));
    const archive = new Map((this.world.archivedAgents ?? []).filter(a => !this.providers.has(a.id)).map(a => [a.id, a]));
    for (const agent of inactive) {
      agent.profile = store.profile(agent.id) ?? agent.profile ?? defaultProfile(agent.id, agent.ai.provider, agent.ai.model);
      archive.set(agent.id, structuredClone(agent));
    }
    if (archive.size) this.world.archivedAgents = [...archive.values()]; else delete this.world.archivedAgents;
    // Save every departing profile and journal before removing it from the active roster.
    // Its complete character snapshot remains archived, so no old resident data is discarded.
    if (inactive.length) store.save(this.world);
    this.world.agents = [...this.providers.keys()].map(id => this.world.agents.find(a => a.id === id)!);
    if (this.world.mapVersion !== 2) {
      this.world.mapVersion = 2;
      for (const c of [this.world.player, ...this.world.agents]) c.position = { ...SPAWNS[c.id as keyof typeof SPAWNS] ?? SPAWNS.mika };
    }
    for (const c of [this.world.player, ...this.world.agents]) {
      if (!isWalkable(c.position)) c.position = { ...SPAWNS[c.id as keyof typeof SPAWNS] ?? SPAWNS.mika };
      if (['walking', 'talking'].includes(c.activity)) c.activity = 'idle';
    }
    this.world.ai = this.world.agents[0].ai;
    if (inactive.length) this.save();
  }
  emit(): void { this.world.ai = this.world.agents[0].ai; this.publish({ type: 'state', world: this.world }); }
  save(): number { this.world.ai = this.world.agents[0].ai; return this.store.save(this.world); }
  private agent(id = this.primaryAgentId): Agent { const a = this.world.agents.find(a => a.id === id); if (!a) throw new Error('Nieznany agent.'); return a; }
  private context(id: string): WorldState {
    const copy = structuredClone(this.world);
    copy.agents.sort((a, b) => a.id === id ? -1 : b.id === id ? 1 : 0);
    copy.ai = copy.agents[0].ai; return copy;
  }
  async checkHealth(): Promise<void> {
    if (this.healthBusy || this.generation || this.closed) return;
    this.healthBusy = true;
    try {
      for (const [id, provider] of this.providers) {
        try { await provider.health(); if (!this.generation && !this.closed) this.agent(id).ai = { provider: provider.name, model: provider.model, status: 'ready' }; }
        catch (error) { if (!this.generation && !this.closed) this.setOffline(id, error); }
      }
    } finally { this.healthBusy = false; if (!this.closed) this.emit(); }
  }
  private setOffline(id: string, error: unknown): void {
    const raw = error instanceof Error ? error.message : '';
    console.warn('[AI ' + id + '] ' + raw.slice(0, 600));
    const message = /Brak modelu|Ollama: HTTP|Gemini: HTTP|Ustaw GEMINI|Brak klucza/.test(raw) ? raw : 'Model jest niedostępny lub odpowiedź nie przeszła walidacji. Sprawdź silnik AI na serwerze.';
    this.agent(id).ai = { ...this.agent(id).ai, status: 'offline', error: message };
    this.world.ai = this.world.agents[0].ai;
  }
  private cancelGeneration(): void {
    if (!this.generation) return;
    const agent = this.agent(this.generation.agentId);
    this.generation.controller.abort(); agent.ai.status = 'ready';
    if (agent.activity === 'talking') agent.activity = 'idle';
    this.generation = undefined;
  }
  private attentive(id: string): boolean {
    const focus = this.attention;
    if (!focus) return false;
    const a = this.agent(focus.agentId);
    const nearby = distance(a.position, this.world.player.position) <= 4 && canSee(a.position, this.world.player.position);
    if (nearby) focus.approaching = false;
    if (this.world.simTime > focus.until || (!focus.approaching && !nearby)) { this.attention = undefined; return false; }
    return focus.agentId === id;
  }
  private listenToPlayer(id: string): void {
    const a = this.agent(id), r = this.runtimes.get(id)!;
    this.attention = { agentId: id, until: this.world.simTime + 60, approaching: distance(a.position, this.world.player.position) > 4 || !canSee(a.position, this.world.player.position) };
    if (this.generation?.agentId === id && this.generation.fromId !== 'player') this.cancelGeneration();
    r.path = []; r.pendingTalk = undefined;
    if (a.activity === 'walking') a.activity = 'idle';
    this.socialReplies = this.socialReplies.filter(s => s.agentId !== id && s.fromId !== id);
    for (const [otherId, runtime] of this.runtimes) if (runtime.pendingTalk?.targetId === id) {
      runtime.pendingTalk = undefined; runtime.path = [];
      if (this.agent(otherId).activity === 'walking') this.agent(otherId).activity = 'idle';
    }
  }
  private deliverSpeech(respond: (message: ServerMessage) => void): void {
    const speech = this.world.playerSpeech;
    if (!speech || speech.heardBy.length || this.world.simTime >= speech.expiresAt || this.generation?.fromId === 'player') return;
    const listener = this.world.agents.filter(a => (!speech.targetAgentId || speech.targetAgentId === a.id) && distance(a.position, this.world.player.position) <= INTERACTION_DISTANCE && canSee(a.position, this.world.player.position)).sort((a,b) => distance(a.position, this.world.player.position) - distance(b.position, this.world.player.position))[0];
    if (!listener) return;
    speech.targetAgentId = listener.id; speech.heardBy.push(listener.id);
    void this.chat(speech.text, respond, listener.id);
  }
  handle(message: ClientMessage, respond: (message: ServerMessage) => void): void {
    if (this.closed) return;
    if (message.type === 'ping') { respond({ type: 'pong' }); return; }
    if (message.type === 'conversation') {
      if (message.agentId === null) this.attention = undefined;
      else if (this.providers.has(message.agentId) && this.world.running) this.listenToPlayer(message.agentId);
      this.emit(); return;
    }
    if (message.type === 'control') {
      if (message.action === 'save') { respond({ type: 'saved', timestamp: this.save() }); this.emit(); return; }
      if (message.action === 'start') {
        this.world.started = true; this.world.running = true;
        for (const a of this.world.agents) if (!this.world.events.some(e => e.agentId === a.id && e.kind === 'arrival')) {
          this.event(a.id, 'arrival', 'Początek życia w wirtualnym domu.'); this.remember(a.id, 'Pierwsze uruchomienie wspólnego domu.');
        }
      } else if (message.action === 'pause') {
        this.world.running = false; this.cancelGeneration();
        for (const a of [this.world.player, ...this.world.agents]) if (a.activity === 'talking') a.activity = 'idle';
      } else {
        if (!this.world.started) { respond({ type: 'error', message: 'Najpierw uruchom świat przyciskiem START.' }); return; }
        this.world.running = true;
      }
      this.save(); this.emit(); return;
    }
    if (message.type === 'move') {
      if (!this.world.running) return;
      const route = findPath(this.world.player.position, message.target);
      if (route === null) { respond({ type: 'error', message: 'Wybierz wolne miejsce na podłodze.' }); return; }
      this.playerPath = route; this.world.player.activity = route.length ? 'walking' : 'idle'; this.emit(); return;
    }
    if (message.type === 'say') {
      if (!this.world.running) { respond({ type: 'error', message: 'Wznów czas w domu, aby coś powiedzieć.' }); return; }
      if (message.agentId && !this.providers.has(message.agentId)) { respond({ type: 'error', message: 'Nieznany rozmówca.' }); return; }
      if (this.generation?.fromId === 'player') { respond({ type: 'error', message: this.agent(this.generation.agentId).name + ' jeszcze odpowiada na Twoją wiadomość.' }); return; }
      const targetId = message.agentId ?? addressedResident(message.text) ?? (this.attention && this.attentive(this.attention.agentId) ? this.attention.agentId : undefined);
      this.world.playerSpeech = { id: randomUUID(), text: message.text, timestamp: Date.now(), expiresAt: this.world.simTime + 90, heardBy: [], ...(targetId ? { targetAgentId: targetId } : {}) };
      this.deliverSpeech(respond);
      this.save(); this.emit(); return;
    }
    if (!this.providers.has(message.agentId ?? this.primaryAgentId)) { respond({ type: 'error', message: 'Nieznany agent.' }); return; }
    void this.chat(message.text, respond, message.agentId);
  }
  tick(delta: number): void {
    if (this.closed || !this.world.running) return;
    const dt = Math.max(0, Math.min(delta, 1));
    this.world.simTime += dt; this.movementBudget += dt;
    this.deliverSpeech(message => this.publish(message));
    while (this.movementBudget >= 1 / 3) {
      this.movementBudget -= 1 / 3;
      if (this.playerPath.length) { this.world.player.position = this.playerPath.shift()!; this.world.player.activity = this.playerPath.length ? 'walking' : 'idle'; }
      for (const a of this.world.agents) {
        const r = this.runtimes.get(a.id); if (!r) continue;
        if (r.path.length && !this.attentive(a.id) && a.activity !== 'talking' && a.ai.status !== 'thinking') { a.position = r.path.shift()!; a.activity = r.path.length ? 'walking' : this.activityFor(r.action); }
      }
    }
    for (const a of this.world.agents) {
      const r = this.runtimes.get(a.id); if (!r) continue;
      if (a.activity === 'talking' && this.generation?.agentId !== a.id && this.world.simTime > r.talkUntil) a.activity = 'idle';
      a.energy = Math.max(0, Math.min(100, a.energy + dt * (a.activity === 'resting' ? .45 : a.activity === 'working' ? -.18 : -.04)));
      a.mood = a.id === 'ultron_001' ? a.energy < 30 ? 'Regeneruje zasoby' : a.activity === 'working' ? 'Realizuje własną strategię' : 'Pewny swojej wyższości' : a.id === 'edith_002' ? a.energy < 30 ? 'Potrzebuje przerwy na kawę' : a.activity === 'working' ? 'Ma tysiąc pomysłów' : 'Ciekawa wszystkiego' : a.energy < 30 ? 'Senna' : a.activity === 'working' ? 'Skupiona' : 'Zaciekawiona';
      if (r.action === 'project' && a.activity === 'working' && a.ai.status !== 'thinking') {
        const plan = a.profile.plans.find(p => p.status === 'active');
        if (plan) { plan.progress = Math.min(100, plan.progress + dt * 2); if (plan.progress >= 100) { plan.status = 'complete'; this.event(a.id, 'project', 'Ukończono fikcyjny projekt: ' + plan.text); this.remember(a.id, 'Sukces projektu w symulacji: ' + plan.text); this.save(); } }
      }
      if (r.pendingTalk) {
        if (this.attentive(a.id) || this.attentive(r.pendingTalk.targetId)) { r.pendingTalk = undefined; r.path = []; if (a.activity === 'walking') a.activity = 'idle'; continue; }
        const target = this.world.agents.find(other => other.id === r.pendingTalk!.targetId);
        if (target && distance(a.position, target.position) <= INTERACTION_DISTANCE && canSee(a.position,target.position) && a.ai.status !== 'thinking') {
          const say = r.pendingTalk.say; r.pendingTalk = undefined; r.path = [];
          this.addMessage(a.id, 'assistant', say, target.id); this.event(a.id, 'conversation', 'Rozmowa z ' + target.name + ': ' + say, target.id);
          this.event(target.id, 'conversation', a.name + ': ' + say, a.id);
          a.activity = 'talking'; r.talkUntil = this.world.simTime + 8;
          this.socialReplies.push({ agentId: target.id, fromId: a.id }); this.save();
        } else if (this.world.simTime > r.pendingTalk.expires) {
          this.event(a.id, 'conversation', 'Nie udało się podejść do rozmówcy. Plan rozmowy trzeba zmienić.', r.pendingTalk.targetId); r.pendingTalk = undefined;
        }
      }
    }
    this.deliverSpeech(message => this.publish(message));
    if (!this.generation) {
      const social = this.socialReplies.shift();
      if (social && !this.attentive(social.agentId) && !this.attentive(social.fromId)) { void this.reply(social.agentId, () => {}, social.fromId); return; }
      const due = this.world.agents.filter(a => this.runtimes.has(a.id) && !this.attentive(a.id) && a.activity !== 'talking' && this.world.simTime >= this.runtimes.get(a.id)!.nextDecision)
        .sort((a, b) => this.runtimes.get(a.id)!.nextDecision - this.runtimes.get(b.id)!.nextDecision)[0];
      if (due) { this.runtimes.get(due.id)!.nextDecision = this.world.simTime + this.decisionInterval; void this.decide(due.id); }
    }
  }
  private activityFor(action: AgentAction): Agent['activity'] { return ['work', 'project'].includes(action) ? 'working' : ['rest', 'sleep'].includes(action) ? 'resting' : 'idle'; }
  private routine(id: string): ModelDecision {
    const a = this.agent(id); const options: AgentAction[] = ['work', 'plants', 'rest', 'wander'];
    const previous = this.world.decisions.filter(d => d.agentId === id).at(-1)?.action;
    return { action: a.energy < 30 ? 'sleep' : options[(options.indexOf(previous!) + 1) % options.length], reason: 'Lokalna rutyna ruchu i energii. Model AI jest niedostępny; brak wygenerowanej decyzji fabularnej.' };
  }
  private applyDecision(id: string, decision: ModelDecision, source: 'ollama' | 'gemini' | 'routine'): void {
    const safe = decisionSchema.parse(decision); const a = this.agent(id); const r = this.runtimes.get(id)!;
    if (this.attentive(id) || (safe.action === 'talk' && safe.targetAgentId && this.attentive(safe.targetAgentId))) return;
    if (safe.action === 'talk' && (!safe.say || !safe.targetAgentId || safe.targetAgentId === id || !this.providers.has(safe.targetAgentId))) throw new Error('Nieprawidłowy cel rozmowy.');
    r.action = safe.action; r.pendingTalk = undefined;
    let spot = SPOTS[safe.action];
    if (safe.action === 'work' || safe.action === 'project') spot = id === 'ultron_001' ? SPOTS.project : SPOTS.work;
    if (safe.action === 'wander' || safe.action === 'observe') {
      const count = this.world.decisions.filter(d => d.agentId === id).length;
      spot = { ...(HOUSE_ROOMS.find(room => room.id === safe.room) ?? HOUSE_ROOMS[count % HOUSE_ROOMS.length]).center };
    }
    if (safe.action === 'talk') {
      const target = this.agent(safe.targetAgentId!); const candidates: Point[] = [];
      for (let x = 0; x < ROOM_SIZE; x++) for (let y = 0; y < ROOM_HEIGHT; y++) if (isWalkable({x,y}) && distance({x,y}, target.position) <= 1.8 && distance({x,y}, target.position) >= 1 && canSee({x,y},target.position)) candidates.push({x,y});
      candidates.sort((p,q) => distance(p,a.position)-distance(q,a.position)); spot = candidates[0] ?? a.position;
      r.pendingTalk = { targetId: target.id, say: safe.say!, expires: this.world.simTime + 18 };
    }
    r.path = findPath(a.position, spot) ?? []; a.activity = r.path.length ? 'walking' : this.activityFor(safe.action); a.thought = safe.reason;
    this.world.decisions.push({ id: randomUUID(), timestamp: Date.now(), agentId: id, action: safe.action, reason: safe.reason, source });
    const own = this.world.decisions.filter(d => d.agentId === id).slice(-60); this.world.decisions = [...this.world.decisions.filter(d => d.agentId !== id), ...own];
    this.event(id, safe.action === 'observe' ? 'discovery' : 'decision', safe.reason);
    if (source !== 'routine') { this.evolve(a, safe); if (safe.say && safe.action !== 'talk') this.addMessage(id, 'assistant', safe.say); }
    this.save(); this.emit();
  }
  async decide(id = this.primaryAgentId): Promise<void> {
    if (this.generation || !this.world.running || this.closed || this.attentive(id)) return;
    const a = this.agent(id); const provider = this.providers.get(id)!;
    if (a.ai.status !== 'ready') { this.applyDecision(id, this.routine(id), 'routine'); return; }
    const task: Generation = { controller: new AbortController(), kind: 'decision', agentId: id };
    this.generation = task; a.ai.status = 'thinking'; this.emit();
    try {
      const result = await provider.decide(this.context(id), AbortSignal.any([task.controller.signal, AbortSignal.timeout(180000)]));
      if (this.generation !== task || this.closed || !this.world.running) return;
      this.applyDecision(id, result, provider.name); a.ai.status = 'ready'; delete a.ai.error;
    } catch (error) { if (this.generation !== task || this.closed) return; this.setOffline(id, error); this.applyDecision(id, this.routine(id), 'routine'); }
    finally { if (this.generation === task) this.generation = undefined; if (!this.closed) this.emit(); }
  }
  async chat(text: string, respond: (message: ServerMessage) => void, id = this.primaryAgentId): Promise<void> {
    const a = this.world.agents.find(a => a.id === id);
    if (!a || !this.providers.has(id)) { respond({ type: 'error', message: 'Nieznany agent.' }); return; }
    if (!this.world.running) { respond({ type: 'error', message: 'Uruchom lub wznów świat, aby porozmawiać.' }); return; }
    if (distance(this.world.player.position, a.position) > INTERACTION_DISTANCE || !canSee(this.world.player.position,a.position)) { respond({ type: 'error', message: 'Podejdź bliżej postaci ' + a.name + ', aby porozmawiać.' }); return; }
    if (this.generation?.fromId === 'player') { respond({ type: 'error', message: 'Model jeszcze odpowiada. Poczekaj chwilę.' }); return; }
    if (this.generation) this.cancelGeneration();
    this.listenToPlayer(id);
    this.addMessage(id, 'user', text, id); this.world.player.activity = 'talking'; this.playerPath = [];
    this.event(id, 'conversation', 'Gracz: ' + text, 'player');
    await this.reply(id, respond, 'player');
  }
  private async reply(id: string, respond: (message: ServerMessage) => void, fromId: string): Promise<void> {
    if (this.generation || this.closed || !this.world.running) return;
    const a = this.agent(id); const provider = this.providers.get(id)!; const r = this.runtimes.get(id)!;
    a.activity = 'talking'; r.path = []; r.pendingTalk = undefined;
    const task: Generation = { controller: new AbortController(), kind: 'chat', agentId: id, fromId };
    this.generation = task; a.ai.status = 'thinking'; this.save(); this.emit();
    try {
      const incoming = this.world.messages.filter(m => fromId === 'player' ? m.role === 'user' && m.agentId === id : m.role === 'assistant' && m.agentId === fromId && m.targetAgentId === id).at(-1);
      const result = replySchema.parse(await provider.chat(this.context(id), AbortSignal.any([task.controller.signal, AbortSignal.timeout(240000)]), { fromId, text: incoming?.text ?? '' }));
      if (this.generation !== task || this.closed || !this.world.running) return;
      this.addMessage(id, 'assistant', result.reply, fromId); this.evolve(a, result);
      this.event(id, 'conversation', a.name + ': ' + result.reply, fromId);
      if (fromId !== 'player') this.event(fromId, 'conversation', a.name + ': ' + result.reply, id);
      a.ai = { provider: provider.name, model: provider.model, status: 'ready' }; this.save();
    } catch (error) { if (this.generation !== task || this.closed) return; this.setOffline(id, error); respond({ type: 'error', message: a.ai.error! }); }
    finally {
      if (this.generation === task) {
        this.generation = undefined; this.world.player.activity = 'idle'; r.talkUntil = this.world.simTime + 8; r.nextDecision = this.world.simTime + 15;
        if (fromId === 'player' && this.attention?.agentId === id) this.attention.until = this.world.simTime + 60;
      }
      if (!this.closed) { this.save(); this.emit(); }
    }
  }
  private evolve(a: Agent, update: ModelDecision | ModelReply): void {
    if (update.memory) this.remember(a.id, update.memory);
    if (update.plan && !a.profile.plans.some(p => p.text === update.plan)) { a.profile.plans.push({ id: randomUUID(), text: update.plan, progress: 0, status: 'active' }); a.profile.plans = a.profile.plans.slice(-12); this.event(a.id, 'project', 'Nowy fikcyjny projekt: ' + update.plan); }
    if (update.goal && !a.profile.goals.includes(update.goal)) { a.profile.goals.push(update.goal); a.profile.goals = a.profile.goals.slice(-8); this.event(a.id, 'goal', update.goal); }
    if (update.trait && !a.profile.traits.includes(update.trait)) { a.profile.traits.push(update.trait); a.profile.traits = a.profile.traits.slice(-10); this.event(a.id, 'personality', update.trait); }
    const rel = update.relationship;
    if (rel && rel.targetId !== a.id && (rel.targetId === 'player' || this.providers.has(rel.targetId))) {
      let stored = a.profile.relationships.find(r => r.targetId === rel.targetId);
      if (!stored) { stored = { targetId: rel.targetId, affinity: 0, note: '' }; a.profile.relationships.push(stored); }
      stored.affinity = Math.max(-100, Math.min(100, stored.affinity + rel.affinityChange)); stored.note = rel.note;
      this.event(a.id, 'relationship', rel.note, rel.targetId);
    }
  }
  private addMessage(id: string, role: 'user' | 'assistant', text: string, targetAgentId?: string): void {
    this.world.messages.push({ id: randomUUID(), timestamp: Date.now(), role, text, agentId: id, targetAgentId });
    const own = this.world.messages.filter(m => m.agentId === id).slice(-100); this.world.messages = [...this.world.messages.filter(m => m.agentId !== id), ...own].sort((a,b) => a.timestamp-b.timestamp);
  }
  private remember(id: string, text: string): void {
    if (this.world.memories.some(m => m.agentId === id && m.text === text)) return;
    this.world.memories.push({ id: randomUUID(), timestamp: Date.now(), text, agentId: id });
    const own = this.world.memories.filter(m => m.agentId === id).slice(-100); this.world.memories = [...this.world.memories.filter(m => m.agentId !== id), ...own];
  }
  private event(agentId: string, kind: AgentEvent['kind'], text: string, targetId?: string): void {
    this.world.events.push({ id: randomUUID(), timestamp: Date.now(), agentId, kind, text, targetId });
    const own = this.world.events.filter(e => e.agentId === agentId).slice(-100); this.world.events = [...this.world.events.filter(e => e.agentId !== agentId), ...own];
  }
  close(): void { this.closed = true; this.cancelGeneration(); this.save(); this.store.close(); }
}
