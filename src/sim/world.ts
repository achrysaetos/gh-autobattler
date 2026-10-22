import {
  NEUTRAL,
  UNIT_KINDS,
  UnitKind,
  type MapDef,
  type PlayerState,
  type RoundParams,
  type SimInput,
  type TickEvents,
  type Unit,
  type World,
} from './api.ts';
import { updateCaptures, updateDomination } from './capture.ts';
import { baseOf, runCouncil } from './council.ts';
import { derived } from './derived.ts';
import { nextRandom, seedRng } from './rng.ts';
import { indexUnits, scratchFor, type Scratch } from './scratch.ts';
import { COUNCIL_PERIOD, MAX_ALIVE, RESPAWN_TICKS, STATS, rankFactor } from './stats.ts';
import { passableAt } from './steering.ts';
import { scoreSecond, updateTerritory } from './territory.ts';
import { updateUnits } from './units.ts';

const GARRISON_MIX: readonly UnitKind[] = [
  UnitKind.Infantry, UnitKind.Archer, UnitKind.Infantry, UnitKind.Cavalry, UnitKind.Archer,
];
const CAP_RETRY_TICKS = 10;

export function createWorld(params: RoundParams, map: MapDef): World {
  derived(map);
  const factionCount = map.objectives.filter((o) => o.kind === 'base').length;
  const world: World = {
    tick: 0,
    params,
    map,
    rng: seedRng(params.seed),
    nextUnitId: 1,
    units: [],
    players: [],
    factions: Array.from({ length: factionCount }, (_, id) => ({ id, score: 0, hexesHeld: 0, objectivesHeld: 0 })),
    objectives: map.objectives.map((o) => ({
      id: o.id,
      owner: o.kind === 'base' ? o.homeFaction : NEUTRAL,
      capturer: NEUTRAL,
      progress: 0,
    })),
    territory: new Int8Array(map.hexes.length).fill(NEUTRAL),
    dominationFaction: NEUTRAL,
    dominationSince: -1,
    winner: NEUTRAL,
  };
  const anchors = derived(map).hexAnchor;
  for (let h = 0; h < anchors.length; h++) {
    const a = anchors[h]!;
    if (a >= 0 && map.objectives[a]!.kind === 'base') world.territory[h] = map.objectives[a]!.homeFaction;
  }
  for (const o of map.objectives) {
    for (let g = 0; g < o.garrison; g++) {
      spawnNear(world, null, GARRISON_MIX[g % GARRISON_MIX.length]!, o.x, o.y, o.radius * 0.8, null);
    }
  }
  return world;
}

export function step(world: World, inputs: readonly SimInput[]): TickEvents {
  const ev: TickEvents = { attacks: [], deaths: [], spawns: [], captures: [] };
  const s = scratchFor(world);
  for (const input of inputs) applyInput(world, s, input, ev);
  indexUnits(world, s);
  updateCaptures(world, s, ev);
  updateDomination(world);
  if (world.tick % 10 === 0) {
    updateTerritory(world);
    scoreSecond(world);
  }
  const factions = world.factions.length;
  const stagger = Math.max(1, Math.floor(COUNCIL_PERIOD / factions));
  for (let f = 0; f < factions; f++) {
    if (world.tick % COUNCIL_PERIOD === (f * stagger) % COUNCIL_PERIOD) runCouncil(world, s, f);
  }
  updateUnits(world, s, ev);
  resolveDeaths(world, s, ev);
  respawn(world, s, ev);
  world.tick++;
  return ev;
}

function applyInput(world: World, s: Scratch, input: SimInput, ev: TickEvents): void {
  if (input.kind === 'enlist') {
    if (s.playerIndex.has(input.playerId)) return;
    if (input.faction < 0 || input.faction >= world.factions.length) return;
    s.playerIndex.set(input.playerId, world.players.length);
    world.players.push({
      playerId: input.playerId,
      faction: input.faction,
      target: [0, 0, 0],
      rank: 0,
      respawnAt: [-1, -1, -1],
      orderObjectiveId: baseOf(world, input.faction),
      kills: 0,
      losses: 0,
      captures: 0,
      retreating: false,
    });
    return;
  }
  const p = s.playerIndex.get(input.playerId);
  if (p === undefined) return;
  const player = world.players[p]!;
  player.target = [Math.max(0, input.infantry), Math.max(0, input.archers), Math.max(0, input.cavalry)];
  player.rank = Math.max(0, input.rank);
  const alive = [0, 0, 0];
  for (const u of world.units) if (u.playerId === player.playerId) alive[u.kind]!++;
  for (const kind of UNIT_KINDS) {
    reinforce(world, player, kind, player.target[kind] - alive[kind]!, ev);
  }
}

function reinforce(world: World, player: PlayerState, kind: UnitKind, missing: number, ev: TickEvents): void {
  const base = world.map.objectives[baseOf(world, player.faction)]!;
  let spawned = 0;
  while (spawned < missing && world.units.length < MAX_ALIVE) {
    spawnNear(world, player, kind, base.x, base.y, base.radius * 0.7, ev);
    spawned++;
  }
  player.respawnAt[kind] = spawned < missing ? world.tick + CAP_RETRY_TICKS : -1;
}

function spawnNear(
  world: World,
  player: PlayerState | null,
  kind: UnitKind,
  cx: number,
  cy: number,
  radius: number,
  ev: TickEvents | null,
): void {
  if (world.units.length >= MAX_ALIVE) return;
  let x = cx;
  let y = cy;
  for (let tries = 0; tries < 8; tries++) {
    const px = cx + (nextRandom(world) * 2 - 1) * radius;
    const py = cy + (nextRandom(world) * 2 - 1) * radius;
    const dx = px - cx;
    const dy = py - cy;
    if (dx * dx + dy * dy <= radius * radius && passableAt(world.map, px, py)) {
      x = px;
      y = py;
      break;
    }
  }
  const maxHp = STATS[kind]!.hp * rankFactor(player ? player.rank : 0);
  const unit: Unit = {
    id: world.nextUnitId++,
    playerId: player ? player.playerId : NEUTRAL,
    faction: player ? player.faction : NEUTRAL,
    kind,
    x,
    y,
    hp: maxHp,
    maxHp,
    targetUnitId: -1,
    cooldown: 0,
    bornTick: world.tick,
  };
  world.units.push(unit);
  ev?.spawns.push({ unitId: unit.id, playerId: unit.playerId, kind });
}

function resolveDeaths(world: World, s: Scratch, ev: TickEvents): void {
  const { units, players } = world;
  let w = 0;
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    u.x = s.nx[i]!;
    u.y = s.ny[i]!;
    u.hp -= s.damage[i]!;
    if (u.hp > 0) {
      units[w++] = u;
      continue;
    }
    const killerPlayerId = s.killer[i]!;
    ev.deaths.push({ unitId: u.id, x: u.x, y: u.y, faction: u.faction, kind: u.kind, playerId: u.playerId, killerPlayerId });
    const killer = s.playerIndex.get(killerPlayerId);
    if (killer !== undefined) players[killer]!.kills++;
    const p = s.unitPlayer[i]!;
    if (p >= 0) {
      const victim = players[p]!;
      victim.losses++;
      if (victim.respawnAt[u.kind]! < 0) victim.respawnAt[u.kind] = world.tick + RESPAWN_TICKS;
    }
  }
  units.length = w;
}

function respawn(world: World, s: Scratch, ev: TickEvents): void {
  const { players, units, tick } = world;
  const isDue = (p: PlayerState) => p.respawnAt.some((at) => at >= 0 && at <= tick);
  if (!players.some(isDue)) return;
  const alive = new Int32Array(players.length * 3);
  for (const u of units) {
    const p = u.playerId < 0 ? undefined : s.playerIndex.get(u.playerId);
    if (p !== undefined) alive[p * 3 + u.kind]!++;
  }
  for (let p = 0; p < players.length; p++) {
    const player = players[p]!;
    for (const kind of UNIT_KINDS) {
      const at = player.respawnAt[kind];
      if (at < 0 || at > tick) continue;
      reinforce(world, player, kind, player.target[kind] - alive[p * 3 + kind]!, ev);
    }
  }
}
