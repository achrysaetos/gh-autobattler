import { describe, expect, it } from 'vitest';
import { Terrain, type MapDef } from './api.ts';
import { buildFlowField, cellAt, cellCenterX, cellCenterY, isPassable } from './flowfield.ts';
import { buildHexLookup, hexIndexAt } from './hex.ts';
import { generateMap, mapRadius } from './mapgen.ts';

const FACTIONS = [1, 2, 3, 4, 5, 6, 7, 8];

function rotate(x: number, y: number, a: number): [number, number] {
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
}

function terrainSymmetry(map: MapDef, folds: number): number {
  let same = 0;
  let total = 0;
  for (let c = 0; c < map.terrain.length; c++) {
    if (map.terrain[c] === Terrain.Void) continue;
    const [rx, ry] = rotate(cellCenterX(map, c), cellCenterY(map, c), (Math.PI * 2) / folds);
    const rc = cellAt(map, rx, ry);
    total++;
    if (rc >= 0 && map.terrain[rc] === map.terrain[c]) same++;
  }
  return same / total;
}

describe('mapgen', () => {
  it('sizes the disc at 1100 square units per expected unit with a 700 floor', () => {
    expect(mapRadius(10)).toBe(700);
    expect(mapRadius(2400)).toBeCloseTo(Math.sqrt((2400 * 1100) / Math.PI), 6);
    expect(generateMap({ seed: 1, factionCount: 8, expectedUnits: 2400, dominationTicks: 216000 }).radius).toBeCloseTo(916.7, 1);
  });

  it('is seed-deterministic', () => {
    const a = generateMap({ seed: 99, factionCount: 5, expectedUnits: 900, dominationTicks: 216000 });
    const b = generateMap({ seed: 99, factionCount: 5, expectedUnits: 900, dominationTicks: 216000 });
    const c = generateMap({ seed: 100, factionCount: 5, expectedUnits: 900, dominationTicks: 216000 });
    expect(a).toEqual(b);
    expect(a.terrain).not.toEqual(c.terrain);
  });

  for (const f of FACTIONS) {
    it(`F=${f}: symmetric objectives and terrain, every objective reachable from every base`, () => {
      const map = generateMap({ seed: 1234 + f, factionCount: f, expectedUnits: 120 * f, dominationTicks: 216000 });
      const kinds = map.objectives.map((o) => o.kind);
      expect(kinds.filter((k) => k === 'base')).toHaveLength(f);
      expect(kinds.filter((k) => k === 'stronghold')).toHaveLength(2 * f);
      expect(kinds.filter((k) => k === 'citadel')).toHaveLength(1);
      map.objectives.forEach((o, i) => expect(o.id).toBe(i));

      for (const o of map.objectives.filter((o) => o.kind === 'base')) {
        expect(Math.sqrt(o.x * o.x + o.y * o.y)).toBeCloseTo(map.radius * 0.82, 6);
      }
      for (const o of map.objectives) {
        const [rx, ry] = rotate(o.x, o.y, (Math.PI * 2) / f);
        const twin = map.objectives.find((p) => p.kind === o.kind && Math.abs(p.x - rx) < 1e-6 && Math.abs(p.y - ry) < 1e-6);
        expect(twin, `${o.kind} ${o.id} has a rotated twin`).toBeDefined();
        if (o.kind !== 'base') expect(o.garrison).toBeGreaterThan(0);
      }
      if (f > 1) expect(terrainSymmetry(map, f)).toBeGreaterThan(0.93);

      for (const base of map.objectives.filter((o) => o.kind === 'base')) {
        const field = buildFlowField(map, cellAt(map, base.x, base.y));
        for (const o of map.objectives) {
          const c = cellAt(map, o.x, o.y);
          expect(isPassable(map.terrain[c]!)).toBe(true);
          expect(field.cost[c], `objective ${o.id} reachable from base ${base.id}`).toBeGreaterThanOrEqual(0);
        }
      }

      const lookup = buildHexLookup(map.hexes, map.hexSize);
      let covered = 0;
      let passable = 0;
      for (let c = 0; c < map.terrain.length; c++) {
        if (!isPassable(map.terrain[c]!)) continue;
        passable++;
        if (hexIndexAt(lookup, cellCenterX(map, c), cellCenterY(map, c)) >= 0) covered++;
      }
      expect(covered / passable).toBeGreaterThan(0.97);
      expect(map.hexSize).toBe(44);
    });
  }

  it('paints forests and impassable terrain from noise', () => {
    const counts = [0, 0, 0, 0];
    for (const f of FACTIONS) {
      const map = generateMap({ seed: 77 + f, factionCount: f, expectedUnits: 300 * f, dominationTicks: 216000 });
      for (const t of map.terrain) if (t !== Terrain.Void) counts[t]!++;
    }
    const total = counts.reduce((a, b) => a + b, 0);
    expect(counts[Terrain.Forest]! / total).toBeGreaterThan(0.04);
    expect((counts[Terrain.Water]! + counts[Terrain.Rock]!) / total).toBeGreaterThan(0.02);
    expect(counts[Terrain.Plain]! / total).toBeGreaterThan(0.6);
  });

  it('scales garrisons with the expected army', () => {
    const small = generateMap({ seed: 1, factionCount: 4, expectedUnits: 200, dominationTicks: 216000 });
    const large = generateMap({ seed: 1, factionCount: 4, expectedUnits: 2000, dominationTicks: 216000 });
    const citadel = (m: MapDef) => m.objectives.find((o) => o.kind === 'citadel')!.garrison;
    expect(citadel(large)).toBeGreaterThan(citadel(small) * 5);
  });
});
