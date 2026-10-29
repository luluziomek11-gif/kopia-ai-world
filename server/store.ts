import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentProfile, WorldState } from '../shared/types.js';

/** One atomic snapshot is authoritative; normalized append-only tables retain the full journal. */
export class WorldStore {
  private db: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, payload TEXT NOT NULL, saved_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, role TEXT NOT NULL, agent_id TEXT NOT NULL, text TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, agent_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, source TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, text TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_profiles (agent_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_events (id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, agent_id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, target_id TEXT);`);
    // Additive migration preserves all existing Mika saves and journals.
    const columns = this.db.prepare('PRAGMA table_info(memories)').all() as { name: string }[];
    if (!columns.some(c => c.name === 'agent_id')) this.db.exec("ALTER TABLE memories ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'mika'");
    const messageColumns = this.db.prepare('PRAGMA table_info(messages)').all() as { name: string }[];
    if (!messageColumns.some(c => c.name === 'target_agent_id')) this.db.exec('ALTER TABLE messages ADD COLUMN target_agent_id TEXT');
    this.db.exec('CREATE INDEX IF NOT EXISTS memories_by_agent ON memories(agent_id,timestamp); CREATE INDEX IF NOT EXISTS events_by_agent ON agent_events(agent_id,timestamp); CREATE INDEX IF NOT EXISTS messages_by_agent ON messages(agent_id,timestamp);');
  }
  load(): WorldState | null {
    const row = this.db.prepare('SELECT payload, version FROM snapshots WHERE id=1').get() as { payload: string; version: number } | undefined;
    if (!row) return null;
    if (row.version !== 1) throw new Error('Nieobsługiwana wersja zapisu świata. Zachowaj kopię bazy danych.');
    return JSON.parse(row.payload) as WorldState;
  }
  save(world: WorldState): number {
    const savedAt = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const messages = this.db.prepare('INSERT OR IGNORE INTO messages (id,timestamp,role,agent_id,text,target_agent_id) VALUES (?,?,?,?,?,?)');
      for (const m of world.messages) messages.run(m.id, m.timestamp, m.role, m.agentId, m.text, m.targetAgentId ?? null);
      const decisions = this.db.prepare('INSERT OR IGNORE INTO decisions VALUES (?,?,?,?,?,?)');
      for (const d of world.decisions) decisions.run(d.id, d.timestamp, d.agentId, d.action, d.reason, d.source);
      const memories = this.db.prepare('INSERT OR IGNORE INTO memories (id,timestamp,text,agent_id) VALUES (?,?,?,?)');
      for (const m of world.memories) memories.run(m.id, m.timestamp, m.text, m.agentId);
      const profiles = this.db.prepare('INSERT INTO agent_profiles VALUES (?,?,?) ON CONFLICT(agent_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at');
      for (const a of world.agents) profiles.run(a.id, JSON.stringify(a.profile), savedAt);
      const events = this.db.prepare('INSERT OR IGNORE INTO agent_events VALUES (?,?,?,?,?,?)');
      for (const e of world.events) events.run(e.id, e.timestamp, e.agentId, e.kind, e.text, e.targetId ?? null);
      this.db.prepare('INSERT INTO snapshots VALUES (1,1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,saved_at=excluded.saved_at').run(JSON.stringify({ ...world, savedAt }), savedAt);
      this.db.exec('COMMIT');
      world.savedAt = savedAt;
      return savedAt;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  profile(agentId: string): AgentProfile | undefined {
    const row = this.db.prepare('SELECT payload FROM agent_profiles WHERE agent_id=?').get(agentId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : undefined;
  }
  history(limit = 200, agentId?: string): { messages: unknown[]; decisions: unknown[]; memories: unknown[]; events: unknown[] } {
    const count = Math.max(1, Math.min(500, Math.floor(limit)));
    if (agentId) return {
      messages: this.db.prepare('SELECT * FROM messages WHERE agent_id=? OR target_agent_id=? ORDER BY timestamp DESC LIMIT ?').all(agentId, agentId, count),
      decisions: this.db.prepare('SELECT * FROM decisions WHERE agent_id=? ORDER BY timestamp DESC LIMIT ?').all(agentId, count),
      memories: this.db.prepare('SELECT * FROM memories WHERE agent_id=? ORDER BY timestamp DESC LIMIT ?').all(agentId, count),
      events: this.db.prepare('SELECT * FROM agent_events WHERE agent_id=? ORDER BY timestamp DESC LIMIT ?').all(agentId, count),
    };
    return {
      messages: this.db.prepare('SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?').all(count),
      decisions: this.db.prepare('SELECT * FROM decisions ORDER BY timestamp DESC LIMIT ?').all(count),
      memories: this.db.prepare('SELECT * FROM memories ORDER BY timestamp DESC LIMIT ?').all(count),
      events: this.db.prepare('SELECT * FROM agent_events ORDER BY timestamp DESC LIMIT ?').all(count),
    };
  }
  close(): void { this.db.close(); }
}
