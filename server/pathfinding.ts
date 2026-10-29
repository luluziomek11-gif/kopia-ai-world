import { isWalkable } from '../shared/room.js';
import type { Point } from '../shared/types.js';

const key = (p: Point) => `${p.x},${p.y}`;
const heuristic = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
/** Small deterministic A*: clients request a destination, never teleport a character. */
export function findPath(start: Point, target: Point): Point[] | null {
  if (!isWalkable(start) || !isWalkable(target)) return null;
  const open: Point[] = [start];
  const score = new Map([[key(start), 0]]);
  const previous = new Map<string, Point>();
  while (open.length) {
    open.sort((a, b) => score.get(key(a))! + heuristic(a, target) - score.get(key(b))! - heuristic(b, target));
    const current = open.shift()!;
    if (key(current) === key(target)) {
      const route: Point[] = [];
      let node = current;
      while (key(node) !== key(start)) { route.unshift(node); node = previous.get(key(node))!; }
      return route;
    }
    for (const next of [{ x: current.x + 1, y: current.y }, { x: current.x - 1, y: current.y }, { x: current.x, y: current.y + 1 }, { x: current.x, y: current.y - 1 }]) {
      if (!isWalkable(next)) continue;
      const cost = score.get(key(current))! + 1;
      if (cost >= (score.get(key(next)) ?? Infinity)) continue;
      previous.set(key(next), current); score.set(key(next), cost);
      if (!open.some(p => key(p) === key(next))) open.push(next);
    }
  }
  return null;
}
