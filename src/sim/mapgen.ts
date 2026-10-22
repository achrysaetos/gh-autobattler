import { NEUTRAL, Terrain, type MapDef, type ObjectiveDef, type RoundParams } from './api.ts';
import { buildFlowField, cellAt, isPassable } from './flowfield.ts';
import { hexesInDisc } from './hex.ts';
import { MAX_ALIVE } from './stats.ts';

export const NAV_CELL = 16;
export const HEX_SIZE = 44;
const AREA_PER_UNIT = 1100;
const MIN_RADIUS = 700;
const BASE_RING = 0.82;
const MAX_ATTEMPTS = 12;

export function mapRadius(expectedUnits: number): number {
  const units = Math.min(MAX_ALIVE, Math.max(1, expectedUnits));
  return Math.max(MIN_RADIUS, Math.sqrt((units * AREA_PER_UNIT) / Math.PI));
}

export function generateMap(params: RoundParams): MapDef {
  const factions = Math.min(8, Math.max(1, Math.floor(params.factionCount)));
  const radius = mapRadius(params.expectedUnits);
  const objectives = placeObjectives(factions, radius, params.expectedUnits);
  const navCols = Math.ceil((radius * 2) / NAV_CELL) + 2;
  const base: Omit<MapDef, 'terrain'> = {
    radius,
    navCell: NAV_CELL,
    navCols,
    navRows: navCols,
    originX: -(navCols * NAV_CELL) / 2,
    originY: -(navCols * NAV_CELL) / 2,
    hexSize: HEX_SIZE,
    hexes: hexesInDisc(radius, HEX_SIZE),
    objectives,
  };
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const map = { ...base, terrain: paintTerrain(base, factions, mixSeed(params.seed, attempt), true) };
    if (allObjectivesReachable(map)) return map;
  }
  return { ...base, terrain: paintTerrain(base, factions, params.seed, false) };
}

function placeObjectives(factions: number, radius: number, expectedUnits: number): ObjectiveDef[] {
  const sector = (Math.PI * 2) / factions;
  const angle0 = -Math.PI / 2;
  const objectives: ObjectiveDef[] = [];
  const at = (a: number, r: number) => ({ x: Math.cos(a) * r * radius, y: Math.sin(a) * r * radius });
  const strongholdGarrison = Math.max(4, Math.round(expectedUnits / (8 * factions)));
  const citadelGarrison = Math.max(8, Math.round(expectedUnits / (3 * factions)));
  for (let f = 0; f < factions; f++) {
    objectives.push({
      id: objectives.length, kind: 'base', ...at(angle0 + f * sector, BASE_RING),
      radius: 80, pointsPerSecond: 0, homeFaction: f, garrison: 0,
    });
  }
  for (let f = 0; f < factions; f++) {
    objectives.push({
      id: objectives.length, kind: 'stronghold', ...at(angle0 + f * sector, 0.48),
      radius: 60, pointsPerSecond: 5, homeFaction: NEUTRAL, garrison: strongholdGarrison,
    });
    objectives.push({
      id: objectives.length, kind: 'stronghold', ...at(angle0 + (f + 0.5) * sector, 0.68),
      radius: 60, pointsPerSecond: 5, homeFaction: NEUTRAL, garrison: strongholdGarrison,
    });
  }
  objectives.push({
    id: objectives.length, kind: 'citadel', x: 0, y: 0,
    radius: 90, pointsPerSecond: 15, homeFaction: NEUTRAL, garrison: citadelGarrison,
  });
  return objectives;
}

function paintTerrain(map: Omit<MapDef, 'terrain'>, factions: number, seed: number, obstacles: boolean): Uint8Array {
  const { navCols: cols, navRows: rows, navCell, originX, originY, radius, objectives } = map;
  const terrain = new Uint8Array(cols * rows);
  const sector = (Math.PI * 2) / factions;
  const angle0 = -Math.PI / 2;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = originX + (cx + 0.5) * navCell;
      const y = originY + (cy + 0.5) * navCell;
      const i = cy * cols + cx;
      const r = Math.sqrt(x * x + y * y);
      if (r > radius) {
        terrain[i] = Terrain.Void;
        continue;
      }
      if (nearObjective(objectives, x, y)) continue;
      // Fold the angle into sector 0 so every sector samples the same noise.
      let a = (Math.atan2(y, x) - angle0) % sector;
      if (a < 0) a += sector;
      const sx = Math.cos(a) * r;
      const sy = Math.sin(a) * r;
      const edge = 1 - Math.max(0, (r - radius * 0.93) / (radius * 0.07));
      const blocker = fbm(seed, sx / 150, sy / 150) * edge;
      const wood = fbm(seed + 7919, sx / 110, sy / 110);
      if (obstacles && blocker > 0.66) {
        terrain[i] = fbm(seed + 104729, sx / 260, sy / 260) > 0.5 ? Terrain.Water : Terrain.Rock;
      } else if (wood > 0.6) {
        terrain[i] = Terrain.Forest;
      }
    }
  }
  return terrain;
}

function nearObjective(objectives: readonly ObjectiveDef[], x: number, y: number): boolean {
  for (const o of objectives) {
    const clear = o.radius + 48;
    const dx = x - o.x;
    const dy = y - o.y;
    if (dx * dx + dy * dy < clear * clear) return true;
  }
  return false;
}

function allObjectivesReachable(map: MapDef): boolean {
  const field = buildFlowField(map, cellAt(map, map.objectives[0]!.x, map.objectives[0]!.y));
  for (const o of map.objectives) {
    const c = cellAt(map, o.x, o.y);
    if (c < 0 || !isPassable(map.terrain[c]!) || field.cost[c] === -1) return false;
  }
  return true;
}

function mixSeed(seed: number, attempt: number): number {
  let h = Math.imul((seed | 0) + Math.imul(attempt, 0x27d4eb2d), 0x165667b1);
  h ^= h >>> 15;
  return Math.imul(h, 0x85ebca77) >>> 0;
}

function lattice(seed: number, ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed | 0, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(seed: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = lattice(seed, ix, iy);
  const b = lattice(seed, ix + 1, iy);
  const c = lattice(seed, ix, iy + 1);
  const d = lattice(seed, ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(seed: number, x: number, y: number): number {
  return (
    valueNoise(seed, x, y) * 0.57 +
    valueNoise(seed + 1, x * 2.03, y * 2.03) * 0.29 +
    valueNoise(seed + 2, x * 4.1, y * 4.1) * 0.14
  );
}
