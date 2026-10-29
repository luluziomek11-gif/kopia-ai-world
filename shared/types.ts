export type Point = { x: number; y: number };
export type Activity = 'idle' | 'walking' | 'working' | 'resting' | 'talking';
export type AgentAction = 'work' | 'rest' | 'sleep' | 'plants' | 'wander' | 'observe' | 'plan' | 'project' | 'talk';
export interface AIState { provider: 'ollama' | 'gemini'; model: string; status: 'checking' | 'ready' | 'offline' | 'thinking'; error?: string }
export interface AgentProfile {
  id: string; name: string; universe: string; role: string; traits: string[]; goals: string[];
  plans: { id: string; text: string; progress: number; status: 'active' | 'complete' }[];
  relationships: { targetId: string; affinity: number; note: string }[];
  skin: 'mika' | 'ultron' | 'edith'; provider: 'ollama' | 'gemini'; model: string;
}
export interface Character { id: string; name: string; position: Point; activity: Activity }
export interface Agent extends Character { energy: number; mood: string; thought: string; profile: AgentProfile; ai: AIState }
export interface Decision { id: string; timestamp: number; agentId: string; action: AgentAction; reason: string; source: 'ollama' | 'gemini' | 'routine' }
export interface ChatMessage { id: string; timestamp: number; role: 'user' | 'assistant'; agentId: string; text: string; targetAgentId?: string }
export interface Memory { id: string; timestamp: number; text: string; agentId: string }
export interface AgentEvent { id: string; timestamp: number; agentId: string; kind: 'arrival' | 'decision' | 'conversation' | 'relationship' | 'project' | 'discovery' | 'goal' | 'personality'; text: string; targetId?: string }
export interface WorldState {
  version: 1; running: boolean; started: boolean; simTime: number;
  mapVersion: 2;
  playerSpeech?: { id: string; text: string; timestamp: number; expiresAt: number; heardBy: string[]; targetAgentId?: string };
  player: Character; agents: Agent[]; decisions: Decision[]; messages: ChatMessage[]; memories: Memory[];
  archivedAgents?: Agent[];
  ai: AIState; events: AgentEvent[];
  savedAt: number | null;
}
export type ClientMessage =
  | { type: 'move'; target: Point }
  | { type: 'control'; action: 'start' | 'pause' | 'resume' | 'save' }
  | { type: 'chat'; text: string; agentId?: string }
  | { type: 'say'; text: string; agentId?: string }
  | { type: 'conversation'; agentId: string | null }
  | { type: 'ping' };
export type ServerMessage =
  | { type: 'state'; world: WorldState }
  | { type: 'error'; message: string }
  | { type: 'saved'; timestamp: number }
  | { type: 'pong' };
