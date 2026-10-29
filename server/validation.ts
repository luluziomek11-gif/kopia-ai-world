import { z } from 'zod';
import { HOUSE_ROOMS, ROOM_HEIGHT, ROOM_SIZE } from '../shared/room.js';

/** A narrow structural check: ordinary prose and braces are allowed, engine fields in a serialized object are not dialogue. */
export const hasDialogueMetadata = (text: string): boolean => /(?:\{|,)\s*["']?(?:relationship|affinityChange|targetId|targetAgentId|memory|trait|goal|plan|action|reason|reply|say)["']?\s*:/i.test(text);
const dialogue = (limit: number) => z.string().trim().max(limit).refine(text => !hasDialogueMetadata(text), 'Wypowiedź zawiera pola silnika zamiast samego dialogu.');

const evolution = {
  memory: z.string().trim().max(300).optional(),
  plan: z.string().trim().max(200).optional(),
  goal: z.string().trim().max(180).optional(),
  trait: z.string().trim().max(100).optional(),
  relationship: z.object({ targetId: z.string().max(64), affinityChange: z.number().int().min(-10).max(10), note: z.string().trim().min(1).max(200) }).strict().optional(),
};
export const decisionSchema = z.object({
  action: z.enum(['work', 'rest', 'sleep', 'plants', 'wander', 'observe', 'plan', 'project', 'talk']),
  reason: z.string().trim().min(1).max(240),
  say: dialogue(500).optional(), targetAgentId: z.string().max(64).optional(), ...evolution,
  room: z.enum(HOUSE_ROOMS.map(room => room.id)).optional(),
}).strict();
export const replySchema = z.object({
  reply: dialogue(420).refine(text => text.length > 0, 'Odpowiedź nie może być pusta.'),
  ...evolution,
}).strict();
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), target: z.object({ x: z.number().int().min(0).max(ROOM_SIZE - 1), y: z.number().int().min(0).max(ROOM_HEIGHT - 1) }).strict() }).strict(),
  z.object({ type: z.literal('control'), action: z.enum(['start', 'pause', 'resume', 'save']) }).strict(),
  z.object({ type: z.literal('chat'), text: z.string().trim().min(1).max(1000), agentId: z.string().min(1).max(64).optional() }).strict(),
  z.object({ type: z.literal('say'), text: z.string().trim().min(1).max(1000), agentId: z.string().min(1).max(64).optional() }).strict(),
  z.object({ type: z.literal('ping') }).strict(),
  z.object({ type: z.literal('conversation'), agentId: z.string().min(1).max(64).nullable() }).strict(),
]);
const evolutionJSON = { memory: { type: 'string', maxLength: 300 }, plan: { type: 'string', maxLength: 200 }, goal: { type: 'string', maxLength: 180 }, trait: { type: 'string', maxLength: 100 }, relationship: { type: 'object', properties: { targetId: { type: 'string' }, affinityChange: { type: 'integer', minimum: -10, maximum: 10 }, note: { type: 'string', maxLength: 200 } }, required: ['targetId', 'affinityChange', 'note'], additionalProperties: false } };
export const decisionJSONSchema = { type: 'object', properties: { action: { type: 'string', enum: ['work', 'rest', 'sleep', 'plants', 'wander', 'observe', 'plan', 'project', 'talk'] }, reason: { type: 'string', maxLength: 240 }, say: { type: 'string', maxLength: 500 }, targetAgentId: { type: 'string' }, room: { type: 'string', enum: HOUSE_ROOMS.map(room => room.id) }, ...evolutionJSON }, required: ['action', 'reason'], additionalProperties: false };
export const replyJSONSchema = { type: 'object', properties: { reply: { type: 'string', maxLength: 420 }, ...evolutionJSON }, required: ['reply'], additionalProperties: false };
