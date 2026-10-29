import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findPath } from '../server/pathfinding.js';
import { Simulation } from '../server/simulation.js';
import { WorldStore } from '../server/store.js';
import { clientMessageSchema, decisionSchema } from '../server/validation.js';
import { isWalkable, SPOTS } from '../shared/room.js';
import type { AIProvider, ModelReply } from '../server/providers.js';
import type { Point, ServerMessage } from '../shared/types.js';

function provider(overrides: Partial<AIProvider> = {}): AIProvider {
  return { name: 'ollama', model: 'test-only', health: async () => {}, decide: async () => ({ action: 'work', reason: 'Test decision' }), chat: async () => ({ reply: 'Test reply', memory: 'Test memory' }), ...overrides };
}
function setup(fake = provider(), filename = ':memory:') {
  const events: ServerMessage[] = [];
  const engine = new Simulation(new WorldStore(filename), fake, m => events.push(structuredClone(m)), 30);
  const send = (m: ServerMessage) => events.push(structuredClone(m));
  return { engine, events, send };
}

test('A* reaches every activity without crossing furniture; blocked and malicious targets rejected', () => {
  for (const point of Object.values(SPOTS)) {
    const route = findPath({ x: 6, y: 8 }, point);
    assert.ok(route?.length); assert.deepEqual(route.at(-1), point);
    for (let i = 0; i < route.length; i++) {
      assert.equal(isWalkable(route[i]), true);
      const previous: Point = i ? route[i - 1] : { x: 6, y: 8 };
      assert.equal(Math.abs(route[i].x - previous.x) + Math.abs(route[i].y - previous.y), 1);
    }
  }
  assert.equal(findPath({ x: 6, y: 8 }, { x: 1, y: 1 }), null);
  assert.equal(clientMessageSchema.safeParse({ type: 'move', target: { x: Infinity, y: 4 } }).success, false);
  assert.equal(clientMessageSchema.safeParse({ type: 'chat', text: 'x'.repeat(1001) }).success, false);
  assert.equal(decisionSchema.safeParse({ action: 'exec', reason: 'Run code' }).success, false);
  assert.equal(decisionSchema.safeParse({ action: 'work', reason: 'a', command: 'rm' }).success, false);
});

test('authoritative movement respects pause, resume and save without resetting world', () => {
  const { engine, send } = setup();
  engine.handle({ type: 'control', action: 'start' }, send);
  engine.world.player.position = { x: 6, y: 8 };
  engine.handle({ type: 'move', target: { x: 6, y: 7 } }, send);
  engine.tick(0.4); assert.deepEqual(engine.world.player.position, { x: 6, y: 7 });
  engine.handle({ type: 'control', action: 'pause' }, send);
  const time = engine.world.simTime; engine.tick(1); assert.equal(engine.world.simTime, time);
  engine.handle({ type: 'move', target: { x: 6, y: 6 } }, send); engine.tick(1);
  assert.deepEqual(engine.world.player.position, { x: 6, y: 7 });
  engine.handle({ type: 'control', action: 'resume' }, send); engine.tick(0.2);
  assert.ok(engine.world.simTime > time); engine.close();
});

test('SQLite restores positions, memory, decisions, conversation and simulation clock after reopen', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'ai-world-test-')); const filename = join(folder, 'world.sqlite');
  try {
    const first = setup(provider(), filename); await first.engine.checkHealth();
    first.engine.handle({ type: 'control', action: 'start' }, first.send);
    first.engine.world.player.position = { x: 11, y: 7 };
    await first.engine.chat('Zapamiętaj to', first.send);
    await first.engine.decide(); first.engine.tick(0.5);
    const expected = structuredClone(first.engine.world); first.engine.close();
    const second = setup(provider(), filename);
    assert.deepEqual(second.engine.world.player.position, expected.player.position);
    assert.deepEqual(second.engine.world.memories, expected.memories);
    assert.deepEqual(second.engine.world.messages, expected.messages);
    assert.deepEqual(second.engine.world.decisions, expected.decisions);
    assert.equal(second.engine.world.simTime, expected.simTime);
    assert.equal(second.engine.store.history().messages.length, 2);
    second.engine.close();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('chat requires proximity; offline provider emits error and never a fabricated AI reply', async () => {
  const { engine, send, events } = setup(provider({ chat: async () => { throw new Error('offline'); }, health: async () => { throw new Error('offline'); } }));
  engine.handle({ type: 'control', action: 'start' }, send);
  await engine.chat('Hello', send); assert.equal(engine.world.messages.length, 0);
  assert.ok(events.some(e => e.type === 'error' && e.message.includes('bliżej')));
  engine.world.player.position = { x: 11, y: 7 }; await engine.chat('Hello', send);
  assert.equal(engine.world.messages.length, 1); assert.equal(engine.world.messages[0].role, 'user');
  assert.equal(engine.world.ai.status, 'offline');
  engine.handle({ type: 'conversation', agentId: null }, send);
  await engine.decide(); assert.equal(engine.world.decisions.at(-1)?.source, 'routine');
  engine.close();
});

test('invalid model decisions cannot mutate routes and are replaced by explicitly labelled routine', async () => {
  const { engine, send } = setup(provider({ decide: async () => ({ action: 'teleport', reason: 'bad' } as never) }));
  await engine.checkHealth(); engine.handle({ type: 'control', action: 'start' }, send);
  await engine.decide();
  assert.equal(engine.world.decisions.length, 1); assert.equal(engine.world.decisions[0].source, 'routine');
  assert.equal(engine.world.ai.status, 'offline'); engine.close();
});

test('pause cancels pending decision; stale response cannot change state after resume', async () => {
  let resolveDecision!: (value: { action: 'work'; reason: string }) => void;
  const { engine, send } = setup(provider({ decide: () => new Promise(resolve => { resolveDecision = resolve; }) }));
  await engine.checkHealth(); engine.handle({ type: 'control', action: 'start' }, send);
  const pending = engine.decide(); engine.handle({ type: 'control', action: 'pause' }, send);
  engine.handle({ type: 'control', action: 'resume' }, send);
  resolveDecision({ action: 'work', reason: 'stale' }); await pending;
  assert.equal(engine.world.decisions.length, 0); engine.close();
});

test('only one chat generation runs; important memory is persisted once', async () => {
  let finish!: (value: ModelReply) => void; let calls = 0;
  const { engine, send, events } = setup(provider({ chat: () => { calls++; return new Promise(resolve => { finish = resolve; }); } }));
  engine.handle({ type: 'control', action: 'start' }, send); engine.world.player.position = { x: 11, y: 7 };
  const pending = engine.chat('One', send); await engine.chat('Two', send);
  assert.equal(calls, 1); assert.ok(events.some(e => e.type === 'error' && e.message.includes('jeszcze')));
  finish({ reply: 'Done', memory: 'Remember this' }); await pending;
  assert.equal(engine.world.messages.length, 2); assert.equal(engine.world.memories.at(-1)?.text, 'Remember this');
  engine.close();
});

test('offline routine keeps varying after the bounded decision history fills', async () => {
  const { engine, send } = setup(provider({ health: async () => { throw new Error('offline'); } }));
  await engine.checkHealth(); engine.handle({ type: 'control', action: 'start' }, send);
  for (let i = 0; i < 65; i++) await engine.decide();
  assert.equal(engine.world.decisions.length, 60);
  assert.equal(new Set(engine.world.decisions.slice(-4).map(d => d.action)).size, 4);
  engine.close();
});

