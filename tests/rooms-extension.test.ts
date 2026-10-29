import test from 'node:test';
import assert from 'node:assert/strict';
import { findPath } from '../server/pathfinding.js';
import { canSee, HOUSE_ROOMS, isWalkable, isWall, ROOM_HEIGHT, ROOM_OBJECTS, ROOM_SIZE, roomAt, SPAWNS, SPOTS } from '../shared/room.js';

test('the new library and games room connect to all original rooms by walkable doorways', () => {
  assert.equal(ROOM_SIZE, 48);
  assert.equal(ROOM_HEIGHT, 20);
  assert.equal(HOUSE_ROOMS.length, 6);
  for (const from of HOUSE_ROOMS) for (const to of HOUSE_ROOMS) {
    const route = findPath(from.center, to.center);
    assert.ok(route, `${from.id} must connect to ${to.id}`);
    assert.ok(route.every(isWalkable));
    if (from.id !== to.id) assert.deepEqual(route.at(-1), to.center);
  }
  for (const y of [6,7]) for (const x of [29,30,31,32,33]) {
    assert.ok(isWalkable({x,y}), `the east-wing entrance must stay clear at ${x},${y}`);
  }
  for (const x of [39,40]) for (const y of [9,10]) assert.ok(isWalkable({x,y}));
  assert.ok(isWall({x:31,y:14}), 'the kitchen counter wall has no painted doorway');
});

test('the added wing keeps exterior walls, solid furniture and visibility boundaries', () => {
  for (let y=0; y<ROOM_HEIGHT; y++) assert.ok(isWall({x:47,y}));
  for (let x=0; x<ROOM_SIZE; x++) {
    assert.ok(isWall({x,y:0}));
    assert.ok(isWall({x,y:19}));
  }
  assert.equal(canSee({x:30,y:4},{x:33,y:4}), false);
  assert.equal(canSee({x:30,y:6},{x:33,y:6}), true);
  assert.equal(canSee({x:39,y:8},{x:39,y:11}), true);
  assert.equal(canSee({x:38,y:8},{x:38,y:11}), false);
  for (const object of ROOM_OBJECTS.filter(o=>o.x>=33)) {
    for (let x=object.x; x<object.x+object.width; x++) for(let y=object.y; y<object.y+object.height; y++) {
      assert.equal(isWalkable({x,y}), false, `${object.id} blocks ${x},${y}`);
    }
  }
  assert.equal(roomAt({x:39,y:6}), 'Biblioteka');
  assert.equal(roomAt({x:38,y:15}), 'Pokój gier');
});

test('extending the house preserves all original room centers, spawns and action destinations', () => {
  assert.deepEqual(HOUSE_ROOMS.slice(0,4).map(r=>r.center), [{x:11,y:6},{x:23,y:6},{x:10,y:14},{x:20,y:15}]);
  assert.deepEqual(SPAWNS.player, {x:10,y:14});
  assert.deepEqual(SPAWNS.edith_002, {x:11,y:6});
  assert.deepEqual(SPAWNS.ultron_001, {x:24,y:7});
  for (const point of [...Object.values(SPAWNS), ...Object.values(SPOTS)]) assert.ok(isWalkable(point));
});
