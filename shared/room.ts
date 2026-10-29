import type { AgentAction, Point } from './types.js';

export const ROOM_SIZE = 48;
export const ROOM_HEIGHT = 20;
export const TILE_SIZE = 48;
export const INTERACTION_DISTANCE = 2.6;
export const HOUSE_ROOMS = [
  { id: 'living', name: 'Salon', x: 1, y: 1, width: 14, height: 8, center: { x: 11, y: 6 } },
  { id: 'study', name: 'Pracownia', x: 17, y: 1, width: 14, height: 8, center: { x: 23, y: 6 } },
  { id: 'bedroom', name: 'Sypialnia', x: 1, y: 11, width: 14, height: 8, center: { x: 10, y: 14 } },
  { id: 'kitchen', name: 'Kuchnia i ogród', x: 17, y: 11, width: 14, height: 8, center: { x: 20, y: 15 } },
  { id: 'library', name: 'Biblioteka', x: 33, y: 1, width: 14, height: 8, center: { x: 39, y: 6 } },
  { id: 'arcade', name: 'Pokój gier', x: 33, y: 11, width: 14, height: 8, center: { x: 38, y: 15 } },
] as const;
export const ROOM_OBJECTS = [
  { id:'sofa', x:1,y:3,width:4,height:6 },
  { id:'tv-books', x:5,y:1,width:10,height:3 },
  { id:'coffee-table',x:7,y:5,width:3,height:3 },
  { id:'living-plant',x:1,y:1,width:3,height:2 },
  { id:'desk',x:17,y:1,width:12,height:4 },
  { id:'study-shelves',x:29,y:1,width:2,height:4 },
  { id:'bed',x:2,y:12,width:6,height:6 },
  { id:'wardrobe',x:13,y:15,width:2,height:4 },
  { id:'bedroom-plant',x:1,y:11,width:3,height:2 },
  { id:'bedroom-shelf',x:13,y:11,width:2,height:2 },
  { id:'kitchen',x:28,y:11,width:3,height:8 },
  { id:'dining-table',x:22,y:12,width:4,height:3 },
  { id:'planter',x:17,y:17,width:5,height:2 },
  { id:'kitchen-bottom',x:26,y:18,width:2,height:1 },
  { id:'library-shelves',x:33,y:1,width:14,height:2 },
  { id:'reading-table',x:34,y:5,width:5,height:3 },
  { id:'library-plant',x:45,y:4,width:2,height:5 },
  { id:'arcade-machines',x:34,y:11,width:6,height:3 },
  { id:'arcade-sofa',x:43,y:14,width:4,height:5 },
  { id:'arcade-coffee-table',x:40,y:15,width:3,height:3 },
] as const;
export const SPOTS: Record<AgentAction, Point> = {
  work:{x:19,y:5}, project:{x:26,y:5}, rest:{x:5,y:6}, sleep:{x:8,y:15},
  plants:{x:20,y:16}, wander:{x:11,y:7}, observe:{x:20,y:12}, plan:{x:24,y:7}, talk:{x:11,y:6},
};
export const SPAWNS = { player:{x:10,y:14}, mika:{x:11,y:6}, edith_002:{x:11,y:6}, ultron_001:{x:24,y:7} };
export function isWall(p: Point): boolean {
  if (p.x <= 0 || p.x >= ROOM_SIZE - 1 || p.y <= 0 || p.y >= ROOM_HEIGHT - 1) return true;
  if ([15,16].includes(p.x) && ![6,7,14].includes(p.y)) return true;
  if ([31,32].includes(p.x) && ![6,7].includes(p.y)) return true;
  if ((p.y === 9 || p.y === 10) && ![8,9,22,23,39,40].includes(p.x)) return true;
  return false;
}
export function isWalkable(p: Point): boolean {
  return Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < ROOM_SIZE && p.y < ROOM_HEIGHT && !isWall(p) &&
    !ROOM_OBJECTS.some(o => p.x >= o.x && p.x < o.x+o.width && p.y >= o.y && p.y < o.y+o.height);
}
export function distance(a: Point,b: Point): number { return Math.hypot(a.x-b.x,a.y-b.y); }
export function canSee(a: Point,b: Point): boolean {
  const steps = Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y))*3;
  for(let i=1;i<steps;i++) if(isWall({x:Math.round(a.x+(b.x-a.x)*i/steps),y:Math.round(a.y+(b.y-a.y)*i/steps)})) return false;
  return true;
}
export function roomAt(p: Point): string { return HOUSE_ROOMS.find(r => p.x>=r.x && p.x<r.x+r.width && p.y>=r.y && p.y<r.y+r.height)?.name ?? 'Przejście'; }
