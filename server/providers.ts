import type { WorldState } from '../shared/types.js';
import { decisionJSONSchema, decisionSchema, replyJSONSchema, replySchema } from './validation.js';
import type { z } from 'zod';
import { persona } from './profiles.js';
import { HOUSE_ROOMS, roomAt } from '../shared/room.js';

export type ModelDecision = z.infer<typeof decisionSchema>;
export type ModelReply = z.infer<typeof replySchema>;
export interface IncomingMessage { fromId: string; text: string }
export interface AIProvider {
  readonly name: 'ollama' | 'gemini'; readonly model: string;
  health(signal?: AbortSignal): Promise<void>;
  decide(world: WorldState, signal: AbortSignal): Promise<ModelDecision>;
  chat(world: WorldState, signal: AbortSignal, incoming?: IncomingMessage): Promise<ModelReply>;
}
export function modelContext(world: WorldState): string {
  const agent = world.agents[0];
  return JSON.stringify({ agent, currentRoom: roomAt(agent.position), house: HOUSE_ROOMS.map(r=>({id:r.id,name:r.name})), visibleResidents: world.agents.slice(1).map(a => ({ id: a.id, name: a.name, position: a.position, activity: a.activity })), player: world.player,
    recentDecisions: world.decisions.filter(d => d.agentId === agent.id).slice(-4),
    memories: world.memories.filter(m => m.agentId === agent.id).slice(-20),
    events: world.events.filter(e => e.agentId === agent.id).slice(-12),
    conversation: world.messages.filter(m => m.agentId === agent.id || m.targetAgentId === agent.id).slice(-12).map(m => ({ speaker: m.role === 'user' ? 'player' : m.agentId, target: m.targetAgentId, text: m.text })) });
}
const dialogueInstructions = ' Pole reply lub say zawiera wyłącznie naturalną wypowiedź po polsku, bez JSON, kodu, nazw pól, metadanych, statystyk i instrukcji dla silnika. Nie dopisuj do wypowiedzi obiektów ani fragmentów relationship, memory czy affinityChange. Zmiany pamięci i relacji podaj tylko jako osobne właściwości głównego obiektu JSON.';
const evolutionInstructions = ' Opcjonalnie dodaj najwyżej jedną aktualizację: memory (ważne wspomnienie do 180 znaków), plan (nowy fikcyjny projekt), goal (cel), trait (uzasadniona doświadczeniem zmiana cechy) albo relationship jako osobny obiekt z targetId, affinityChange (-10..10) i note. Nie powtarzaj istniejących wpisów. Nie zmieniaj wszystkiego naraz; aktualizacja wynika z wydarzeń.';
const repairInstructions = ' Poprzednia odpowiedź była niepoprawna. Zwróć jeden kompletny, poprawny obiekt JSON zgodny ze schematem. Bez dodatkowych pól takich jak activity. Na tę próbę pomiń opcjonalne aktualizacje pamięci i relacji. Wypowiedź ma być krótka i nie może zawierać pól JSON.';
function retryableResponseError(error: unknown): boolean {
  return error instanceof SyntaxError || (error instanceof Error && error.name === 'ZodError');
}
export abstract class JSONProvider implements AIProvider {
  abstract readonly name: 'ollama' | 'gemini';
  abstract readonly model: string;
  abstract health(signal?: AbortSignal): Promise<void>;
  protected abstract generate(system: string, input: string, schema: object, signal: AbortSignal): Promise<unknown>;
  async decide(world: WorldState, signal: AbortSignal): Promise<ModelDecision> {
    const peers = world.agents.slice(1).map(a => a.id);
    const schema = { ...decisionJSONSchema, properties: { ...decisionJSONSchema.properties, targetAgentId: { type: 'string', enum: peers.length ? peers : [''] } } };
    const prompt = persona(world.agents[0].profile) + ' Mieszkasz w domu z sześcioma pokojami. Żyj samodzielnie, odwiedzaj pokoje i zmieniaj zajęcia. Wybierz czynność: work (komputer), rest (kanapa), sleep (łóżko), plants (rośliny), wander (spacer do room), observe (obserwacja w room), plan (strategia), project (fikcyjny projekt), talk (rozmowa z innym mieszkańcem). Dozwolone pokoje room: '+HOUSE_ROOMS.map(r=>r.id).join(', ')+'. Dla talk podaj niepuste say i targetAgentId WYŁĄCZNIE z listy: '+JSON.stringify(peers)+'. Gracz nie jest prawidłowym targetAgentId tej czynności. Jeśli lista jest pusta, wybierz inną czynność. Uwzględnij energię i cele. reason: jedno zdanie do 120 znaków. Opcjonalne say: do 180 znaków. Nie zwracaj kodu, współrzędnych ani poleceń systemowych.' + dialogueInstructions + evolutionInstructions;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = decisionSchema.parse(await this.generate(prompt + (attempt ? repairInstructions + ' Jeśli nie jesteś pewien rozmówcy, wybierz work, observe lub wander.' : ''), modelContext(world), schema, signal));
        if (result.action !== 'talk' || (result.say && peers.includes(result.targetAgentId ?? ''))) return result;
        if (attempt === 1) throw new Error('Decyzja modelu: nieprawidłowy cel rozmowy.');
      } catch (error) {
        if (attempt === 1 || signal.aborted || !retryableResponseError(error)) throw error;
      }
    }
    throw new Error('Decyzja modelu: nieprawidłowy cel rozmowy.');
  }
  async chat(world: WorldState, signal: AbortSignal, incoming?: IncomingMessage): Promise<ModelReply> {
    const id = world.agents[0].id;
    const last = world.messages.filter(m => (m.role === 'user' && m.agentId === id) || (m.role === 'assistant' && m.agentId !== id && m.targetAgentId === id)).at(-1);
    const message = incoming ?? { fromId: last?.role === 'user' ? 'player' : last?.agentId ?? 'player', text: last?.text ?? '' };
    const context = JSON.parse(modelContext(world));
    // A social exchange is not the player's conversation. Keep the active pair in focus.
    context.conversation = context.conversation.filter((m: {speaker:string;target?:string}) => message.fromId === 'player'
      ? m.speaker === 'player' || (m.speaker === id && m.target === 'player')
      : (m.speaker === message.fromId && m.target === id) || (m.speaker === id && m.target === message.fromId));
    const input = JSON.stringify({ background: context, messageToAnswer: { speaker: message.fromId, recipient: id, text: message.text } });
    const prompt = persona(world.agents[0].profile) + ' Teraz prowadzisz rozmowę. Odpowiedz WYŁĄCZNIE na messageToAnswer.text, bezpośrednio osobie messageToAnswer.speaker. Najpierw odpowiedz na jej pytanie. Tło służy tylko jako pamięć, nie zastępuje aktualnej wiadomości. Na krótkie przywitanie odpowiedz jednym krótkim zdaniem, bez monologu, analiz i opowiadania o innych mieszkańcach. Na pytanie odpowiedz konkretnie w 1–3 krótkich zdaniach. Nie zaczynaj każdej odpowiedzi od cześć. Nie ogłaszaj odejścia do innej postaci ani nie zmieniaj rozmówcy. Zachowaj osobowość, ale nie używaj losowego żartu zamiast odpowiedzi. Preferuj do 220 znaków, bezwzględnie do 420 znaków.' + dialogueInstructions + evolutionInstructions;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return replySchema.parse(await this.generate(prompt + (attempt ? repairInstructions : ''), input, replyJSONSchema, signal));
      } catch (error) {
        if (attempt === 1 || signal.aborted || !retryableResponseError(error)) throw error;
      }
    }
    throw new Error('Odpowiedź modelu nie przeszła walidacji.');
  }
}
export class OllamaProvider extends JSONProvider {
  readonly name = 'ollama' as const;
  constructor(readonly model = 'llama3.2:3b', private baseUrl = 'http://127.0.0.1:11434') { super(); }
  async health(signal?: AbortSignal): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/tags`, { signal: signal ?? AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Ollama nie odpowiada.');
    const body = await response.json() as { models?: { name: string }[] };
    if (!body.models?.some(m => m.name === this.model || m.name === `${this.model}:latest`)) throw new Error(`Brak modelu ${this.model}. Uruchom: ollama pull ${this.model}`);
  }
  protected async generate(system: string, input: string, schema: object, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal,
      body: JSON.stringify({ model: this.model, stream: false, format: schema, ...(this.model.startsWith('gpt-oss') ? { think: 'low' } : {}), keep_alive: '10m', options: { temperature: 0.75, num_predict: this.model.startsWith('gpt-oss') ? 2400 : 1400, num_ctx: 8192 }, messages: [{ role: 'system', content: system }, { role: 'user', content: input }] }),
    });
    if (!response.ok) throw new Error(`Ollama: HTTP ${response.status}. Sprawdź uruchomiony model.`);
    const body = await response.json() as { message?: { content?: string } };
    if (!body.message?.content) throw new Error('Ollama zwróciła pustą odpowiedź.');
    return JSON.parse(body.message.content);
  }
}
export class GeminiProvider extends JSONProvider {
  readonly name = 'gemini' as const;
  constructor(readonly model = 'gemini-2.5-flash', private apiKey = '') { super(); }
  async health(signal?: AbortSignal): Promise<void> {
    if (!this.apiKey) throw new Error('Ustaw GEMINI_API_KEY w środowisku serwera.');
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}`, { headers: { 'x-goog-api-key': this.apiKey }, signal: signal ?? AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Gemini: HTTP ${response.status}. Sprawdź model i klucz serwera.`);
  }
  protected async generate(system: string, input: string, schema: object, signal: AbortSignal): Promise<unknown> {
    if (!this.apiKey) throw new Error('Brak klucza Gemini na serwerze.');
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey }, signal,
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: input }] }], generationConfig: { temperature: 0.65, maxOutputTokens: 1000, responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema } } } }),
    });
    if (!response.ok) throw new Error(`Gemini: HTTP ${response.status}. Sprawdź konfigurację serwera.`);
    const body = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('');
    if (!text) throw new Error('Gemini nie zwrócił odpowiedzi tekstowej.');
    return JSON.parse(text);
  }
}
export function createProvider(env: NodeJS.ProcessEnv = process.env): AIProvider {
  if (env.AI_PROVIDER && !['ollama', 'gemini'].includes(env.AI_PROVIDER)) throw new Error('AI_PROVIDER musi mieć wartość ollama lub gemini.');
  return env.AI_PROVIDER === 'gemini' ? new GeminiProvider(env.GEMINI_MODEL, env.GEMINI_API_KEY) : new OllamaProvider(env.OLLAMA_MODEL, env.OLLAMA_URL);
}
