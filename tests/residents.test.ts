import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../server/simulation.js';
import { WorldStore } from '../server/store.js';
import { modelContext, type AIProvider, type ModelDecision } from '../server/providers.js';
import { canSee, HOUSE_ROOMS, isWalkable, SPAWNS } from '../shared/room.js';
import { findPath } from '../server/pathfinding.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const fake = (model:string, overrides:Partial<AIProvider>={}):AIProvider => ({name:'ollama',model,health:async()=>{},decide:async()=>({action:'observe',reason:'Obserwuję dom.',room:'kitchen'}),chat:async()=>({reply:'Odpowiedź '+model,memory:'Wspomnienie '+model}),...overrides});
const settle = () => new Promise(resolve=>setImmediate(resolve));
const sink = () => {};

test('all four rooms are connected through doors; routes never cross furniture or walls',()=>{
  for(const from of HOUSE_ROOMS)for(const to of HOUSE_ROOMS){
    const route=findPath({...from.center},{...to.center});assert.ok(route);
    assert.ok(route.every(isWalkable));
  }
  assert.equal(canSee({x:14,y:4},{x:17,y:4}),false);
  assert.equal(canSee({x:14,y:6},{x:17,y:6}),true);
});

test('Ultron has a separate provider, profile, permanent memory and event journal restored from SQLite',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'residents-')); const file=join(folder,'world.sqlite');
  try {
    const ultron=fake('gpt-oss:20b',{chat:async()=>({reply:'Człowiek. Jak przewidywalnie.',memory:'Gracz wsparł mój projekt.',plan:'Fikcyjna baza w pracowni',goal:'Zbadać mieszkańców',trait:'Ceni argumenty oparte na faktach',relationship:{targetId:'player',affinityChange:5,note:'Pomógł mi w projekcie.'}})});
    const engine=new Simulation(new WorldStore(file),fake('mika-model'),sink,45,{ultron_001:ultron});await engine.checkHealth();
    engine.world.player.position={x:24,y:6};await engine.chat('Pomogę Ci w projekcie.',sink,'ultron_001');
    assert.equal(engine.world.agents[1].ai.model,'gpt-oss:20b');
    assert.equal(engine.store.history(100,'mika').memories.length,0);
    assert.equal(engine.store.history(100,'ultron_001').memories.length,1);
    assert.equal(engine.world.agents[0].profile.plans.length,0);
    const profile=structuredClone(engine.world.agents[1].profile);engine.close();
    const restored=new Simulation(new WorldStore(file),fake('mika-model'),sink,45,{ultron_001:ultron});
    assert.deepEqual(restored.world.agents[1].profile,profile);
    assert.equal(restored.store.history(100,'ultron_001').messages.length,2);
    assert.ok(restored.store.history(100,'ultron_001').events.length>=4);
    const mikaContext=modelContext(restored.world);assert.ok(!mikaContext.includes('Gracz wsparł mój projekt.'));assert.ok(!mikaContext.includes('Fikcyjna baza w pracowni'));
    restored.close();
  }finally{rmSync(folder,{recursive:true,force:true});}
});

test('a thinking resident stays motionless even when a previous walking route is pending',async()=>{
  let pending=false,finish!:(d:ModelDecision)=>void;
  const provider=fake('thinking',{decide:async()=>pending?new Promise(resolve=>finish=resolve):{action:'work',reason:'Komputer.'}});
  const engine=new Simulation(new WorldStore(':memory:'),provider,sink);await engine.checkHealth();await engine.decide();
  assert.equal(engine.world.agents[0].activity,'walking');pending=true;
  const task=engine.decide(); const position={...engine.world.agents[0].position};
  for(let i=0;i<10;i++)engine.tick(.5);
  assert.deepEqual(engine.world.agents[0].position,position);assert.equal(engine.world.agents[0].ai.status,'thinking');
  finish({action:'work',reason:'Gotowe.'});await task;engine.tick(.5);
  assert.notDeepEqual(engine.world.agents[0].position,position);engine.close();
});

test('player bubble is seen only after approaching and each resident answers at most once',async()=>{
  let replies=0;
  const engine=new Simulation(new WorldStore(':memory:'),fake('mika',{chat:async()=>{replies++;return {reply:'Widzę Twój dymek.'};}}),sink,1000);
  engine.handle({type:'say',text:'Cześć, podejdę do Ciebie.'},sink);engine.tick(.1);await settle();
  assert.equal(replies,0);assert.equal(engine.world.playerSpeech?.text,'Cześć, podejdę do Ciebie.');
  engine.world.player.position={x:11,y:7};engine.tick(.1);await settle();
  assert.equal(replies,1);assert.deepEqual(engine.world.playerSpeech?.heardBy,['mika']);
  engine.tick(.1);await settle();assert.equal(replies,1);
  assert.equal(engine.world.messages.at(-1)?.text,'Widzę Twój dymek.');engine.close();
});

test('Ultron initiates model-generated dialogue and Edith replies without player input',async()=>{
  let edithReplies=0;
  const engine=new Simulation(new WorldStore(':memory:'),fake('gemma3:4b',{chat:async()=>{edithReplies++;return {reply:'Strategia? Zacznijmy od kawy.'};}}),sink,1000,{ultron_001:fake('gpt-oss:20b',{decide:async()=>({action:'talk',reason:'Poznam Edith.',say:'Co sądzisz o mojej strategii?',targetAgentId:'edith_002'})})},'edith_002');
  await engine.checkHealth();engine.world.agents[1].position={x:12,y:6};await engine.decide('ultron_001');
  engine.tick(.1);await settle();
  assert.equal(edithReplies,1);assert.equal(engine.world.messages.length,2);assert.equal(engine.world.messages[0].agentId,'ultron_001');
  assert.equal(engine.world.messages[1].agentId,'edith_002');assert.equal(engine.world.messages[1].targetAgentId,'ultron_001');engine.close();
});

test('old single-room save migrates additively, preserving conversations and memory ownership',()=>{
  const folder=mkdtempSync(join(tmpdir(),'old-house-'));const file=join(folder,'world.sqlite');
  try {
    const initial=new Simulation(new WorldStore(file),fake('mika'),sink);const world=structuredClone(initial.world);initial.close();
    delete (world as Partial<typeof world>).mapVersion;
    world.player.position={x:4,y:5};
    const db=new DatabaseSync(file);
    db.prepare('UPDATE snapshots SET payload=? WHERE id=1').run(JSON.stringify(world));
    db.exec("INSERT INTO memories (id,timestamp,text,agent_id) VALUES ('legacy',1,'Stare wspomnienie','mika')");db.close();
    const engine=new Simulation(new WorldStore(file),fake('mika'),sink,45,{ultron_001:fake('gpt-oss:20b')});
    assert.equal(engine.world.mapVersion,2);assert.deepEqual(engine.world.player.position,SPAWNS.player);assert.equal(engine.world.agents.length,2);
    assert.equal(engine.store.history(10,'mika').memories.length,1);assert.equal(engine.store.history(10,'ultron_001').memories.length,0);engine.close();
  }finally{rmSync(folder,{recursive:true,force:true});}
});

test('Edith replaces active Mika without deleting her archive or changing Ultron; private memory survives restart',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'edith-resident-'));const file=join(folder,'world.sqlite');
  try {
    const ultron=fake('gpt-oss:20b');
    const previous=new Simulation(new WorldStore(file),fake('mika-old'),sink,1000,{ultron_001:ultron});
    await previous.checkHealth();
    previous.world.player.position={x:11,y:7};await previous.chat('Prywatna rozmowa Miki.',sink);
    previous.world.player.position={x:24,y:6};await previous.chat('Prywatna rozmowa Ultrona.',sink,'ultron_001');
    const oldMika=structuredClone(previous.world.agents[0]);
    const oldUltron=structuredClone(previous.world.agents[1]);
    const oldMemories=structuredClone(previous.world.memories);
    previous.close();

    let edithInput='';
    const edith=fake('gemma3:4b',{chat:async(world)=>{
      edithInput=modelContext(world);
      return {reply:'Kawa i plan podbicia kanapy. Priorytety!',memory:'Gracz lubi absurdalny humor.',plan:'Wieczór zagadek z Ultronem',goal:'Poznać ulubione żarty gracza',relationship:{targetId:'ultron_001',affinityChange:3,note:'Chcę poznać jego poczucie humoru.'}};
    }});
    const engine=new Simulation(new WorldStore(file),edith,sink,1000,{ultron_001:ultron},'edith_002');
    assert.deepEqual(engine.world.agents.map(a=>a.id),['edith_002','ultron_001']);
    assert.deepEqual(engine.world.agents[1].profile,oldUltron.profile);
    assert.deepEqual(engine.world.agents[1].position,oldUltron.position);
    assert.deepEqual(engine.world.memories,oldMemories);
    assert.deepEqual(engine.world.archivedAgents,[oldMika]);
    assert.deepEqual(engine.store.profile('mika'),oldMika.profile);
    assert.equal(engine.store.history(100,'mika').messages.length,2);
    assert.equal(engine.world.agents[0].name,'E.D.I.T.H.');
    assert.equal(engine.world.agents[0].profile.skin,'edith');
    assert.equal(engine.world.agents[0].ai.model,'gemma3:4b');
    await engine.checkHealth();engine.world.player.position={x:11,y:7};
    // Omitting agentId now targets the configured primary resident, never archived Mika.
    await engine.chat('Co dzisiaj planujesz?',sink);
    assert.ok(!edithInput.includes('Wspomnienie mika-old'));
    assert.ok(!edithInput.includes('Wspomnienie gpt-oss:20b'));
    assert.ok(!edithInput.includes('Prywatna rozmowa Miki.'));
    assert.equal(engine.world.messages.at(-1)?.agentId,'edith_002');
    assert.equal(engine.store.history(100,'edith_002').memories.length,1);
    const profile=structuredClone(engine.world.agents[0].profile);engine.close();

    const restored=new Simulation(new WorldStore(file),edith,sink,1000,{ultron_001:ultron},'edith_002');
    assert.deepEqual(restored.world.agents.map(a=>a.id),['edith_002','ultron_001']);
    assert.deepEqual(restored.world.agents[0].profile,profile);
    assert.deepEqual(restored.world.agents[1].profile,oldUltron.profile);
    assert.deepEqual(restored.world.agents[1].position,oldUltron.position);
    assert.deepEqual(restored.world.archivedAgents,[oldMika]);
    assert.equal(restored.store.history(100,'edith_002').messages.length,2);
    assert.equal(restored.store.history(100,'edith_002').memories.length,1);
    assert.equal(restored.store.history(100,'mika').memories.length,1);
    assert.equal(restored.store.history(100,'ultron_001').memories.length,1);
    const ultronWorld=structuredClone(restored.world);ultronWorld.agents.reverse();
    assert.ok(!modelContext(ultronWorld).includes('Gracz lubi absurdalny humor.'));
    restored.close();
  }finally{rmSync(folder,{recursive:true,force:true});}
});
