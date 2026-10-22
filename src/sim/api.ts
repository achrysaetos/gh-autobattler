// Public contract of the deterministic battle simulation. Shared verbatim by the
// authoritative server and by every spectator client, which re-simulates the
// world locally from a snapshot plus the same input stream (lockstep spectating).
//
// Determinism rules for everything under src/sim (except mapgen, whose output is
// shipped inside snapshots): only + - * / Math.sqrt Math.floor Math.abs Math.min
// Math.max on numbers, a seeded PRNG stored in World, and iteration over arrays in
// index order. No Math.sin/cos/atan2/pow/exp/log, Date, Math.random, or Set/Map
// iteration whose order depends on hashing.

export const TICK_MS = 100;
export const TICKS_PER_SECOND = 1000 / TICK_MS;

export const UnitKind = { Infantry: 0, Archer: 1, Cavalry: 2 } as const;
export type UnitKind = (typeof UnitKind)[keyof typeof UnitKind];
export const UNIT_KINDS: readonly UnitKind[] = [0, 1, 2];

export const NEUTRAL = -1;

export const Terrain = { Plain: 0, Forest: 1, Water: 2, Rock: 3, Void: 255 } as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

export interface RoundParams {
  seed: number;
  factionCount: number;
  expectedUnits: number;
}

export type ObjectiveKind = 'base' | 'stronghold' | 'citadel';

export interface ObjectiveDef {
  id: number;
  kind: ObjectiveKind;
  x: number;
  y: number;
  radius: number;
  pointsPerSecond: number;
  homeFaction: number;
  garrison: number;
}

export interface Hex {
  q: number;
  r: number;
  x: number;
  y: number;
}

export interface MapDef {
  radius: number;
  navCell: number;
  navCols: number;
  navRows: number;
  originX: number;
  originY: number;
  terrain: Uint8Array;
  hexSize: number;
  hexes: Hex[];
  objectives: ObjectiveDef[];
}

export type SimInput =
  | { kind: 'enlist'; playerId: number; faction: number }
  | {
      kind: 'muster';
      playerId: number;
      infantry: number;
      archers: number;
      cavalry: number;
      rank: number;
    };

export interface TimedInput {
  tick: number;
  seq: number;
  input: SimInput;
}

export interface Unit {
  id: number;
  playerId: number;
  faction: number;
  kind: UnitKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  targetUnitId: number;
  cooldown: number;
  bornTick: number;
}

export interface PlayerState {
  playerId: number;
  faction: number;
  target: [infantry: number, archers: number, cavalry: number];
  rank: number;
  respawnAt: [number, number, number];
  orderObjectiveId: number;
  kills: number;
  losses: number;
  captures: number;
}

export interface FactionState {
  id: number;
  score: number;
  hexesHeld: number;
  objectivesHeld: number;
}

export interface ObjectiveState {
  id: number;
  owner: number;
  capturer: number;
  progress: number;
}

export interface World {
  tick: number;
  params: RoundParams;
  map: MapDef;
  rng: number;
  nextUnitId: number;
  units: Unit[];
  players: PlayerState[];
  factions: FactionState[];
  objectives: ObjectiveState[];
  territory: Int8Array;
  dominationFaction: number;
  dominationSince: number;
  winner: number;
}

export interface TickEvents {
  attacks: { from: number; to: number; ranged: boolean }[];
  deaths: { unitId: number; x: number; y: number; faction: number; kind: UnitKind; playerId: number; killerPlayerId: number }[];
  spawns: { unitId: number; playerId: number; kind: UnitKind }[];
  captures: { objectiveId: number; faction: number; previous: number; playerIds: number[] }[];
}

export interface WorldSnapshot {
  version: 1;
  world: unknown;
}

export interface SimModule {
  generateMap(params: RoundParams): MapDef;
  createWorld(params: RoundParams, map: MapDef): World;
  step(world: World, inputs: readonly SimInput[]): TickEvents;
  snapshot(world: World): WorldSnapshot;
  restore(snapshot: WorldSnapshot): World;
  checksum(world: World): number;
}
