import { NEUTRAL, type MapDef, type RoundParams, type SimInput, type SimModule, type TickEvents, type World, type WorldSnapshot } from '../../sim/api.ts';

export interface FakeSimOptions {
  captureEvery?: number;
  winAt?: { tick: number; faction: number };
}

export interface FakeSim extends SimModule {
  applied: { tick: number; input: SimInput }[];
}

// A tiny deterministic stand-in for the real sim: units are not simulated, but every
// input and every tick perturbs an rng and the per-player counters, so any replay that
// misses, reorders, or double-applies an input produces a different checksum.
export function createFakeSim(options: FakeSimOptions = {}): FakeSim {
  const captureEvery = options.captureEvery ?? 0;
  const applied: { tick: number; input: SimInput }[] = [];

  const generateMap = (params: RoundParams): MapDef => ({
    radius: 700,
    navCell: 10,
    navCols: 1,
    navRows: 1,
    originX: 0,
    originY: 0,
    terrain: new Uint8Array(1),
    hexSize: 10,
    hexes: [],
    objectives: [
      { id: 0, kind: 'citadel', x: 0, y: 0, radius: 40, pointsPerSecond: 15, homeFaction: NEUTRAL, garrison: params.expectedUnits },
    ],
  });

  const createWorld = (params: RoundParams, map: MapDef): World => ({
    tick: 0,
    params,
    map,
    rng: params.seed >>> 0,
    nextUnitId: 1,
    units: [],
    players: [],
    factions: Array.from({ length: params.factionCount }, (_, id) => ({ id, score: 0, hexesHeld: 0, objectivesHeld: 0 })),
    objectives: [{ id: 0, owner: NEUTRAL, capturer: NEUTRAL, progress: 0 }],
    territory: new Int8Array(0),
    dominationFaction: NEUTRAL,
    dominationSince: 0,
    winner: NEUTRAL,
  });

  const step = (world: World, inputs: readonly SimInput[]): TickEvents => {
    const events: TickEvents = { attacks: [], deaths: [], spawns: [], captures: [] };
    for (const input of inputs) {
      applied.push({ tick: world.tick, input });
      world.rng = mix(world.rng, input.playerId + (input.kind === 'muster' ? input.infantry * 3 + input.archers * 5 + input.cavalry * 7 + input.rank : input.faction));
      if (input.kind === 'enlist') {
        world.players.push({
          playerId: input.playerId, faction: input.faction, target: [0, 0, 0], rank: 0, respawnAt: [0, 0, 0],
          orderObjectiveId: 0, kills: 0, losses: 0, captures: 0,
        });
      } else {
        const pl = world.players.find((x) => x.playerId === input.playerId);
        if (pl) {
          pl.target = [input.infantry, input.archers, input.cavalry];
          pl.rank = input.rank;
        }
      }
    }
    for (const pl of world.players) {
      const strength = pl.target[0] + pl.target[1] + pl.target[2];
      world.rng = mix(world.rng, strength);
      if (strength > 0 && world.rng % 7 === 0) pl.kills++;
      if (world.rng % 11 === 0) pl.losses++;
      const f = world.factions[pl.faction];
      if (f) f.score += strength;
    }
    world.tick++;
    if (captureEvery > 0 && world.tick % captureEvery === 0 && world.factions.length > 0) {
      const faction = (world.tick / captureEvery) % world.factions.length;
      const obj = world.objectives[0]!;
      const previous = obj.owner;
      obj.owner = faction;
      const playerIds = world.players.filter((pl) => pl.faction === faction).map((pl) => pl.playerId);
      for (const pl of world.players) if (pl.faction === faction) pl.captures++;
      events.captures.push({ objectiveId: 0, faction, previous, playerIds });
    }
    if (options.winAt && world.tick >= options.winAt.tick) world.winner = options.winAt.faction;
    return events;
  };

  const snapshot = (world: World): WorldSnapshot => ({
    version: 1,
    world: { ...world, map: { ...world.map, terrain: [...world.map.terrain] }, territory: [...world.territory] },
  });

  const restore = (snap: WorldSnapshot): World => {
    const w = structuredClone(snap.world) as World & { map: { terrain: number[] }; territory: number[] };
    return { ...w, map: { ...w.map, terrain: Uint8Array.from(w.map.terrain) }, territory: Int8Array.from(w.territory) };
  };

  const checksum = (world: World): number => {
    let h = mix(world.rng, world.tick);
    for (const pl of world.players) {
      h = mix(h, pl.playerId);
      h = mix(h, pl.faction);
      h = mix(h, pl.target[0] * 1_000_000 + pl.target[1] * 1000 + pl.target[2]);
      h = mix(h, pl.kills * 7919 + pl.losses * 31 + pl.captures);
    }
    for (const f of world.factions) h = mix(h, f.score);
    return h;
  };

  return { generateMap, createWorld, step, snapshot, restore, checksum, applied };
}

function mix(h: number, v: number): number {
  return Math.imul((h ^ (v | 0)) >>> 0, 0x01000193) >>> 0;
}
