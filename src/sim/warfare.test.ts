import { describe, expect, it } from 'vitest';
import { runWarfare, type WarfareCase } from './warfare.ts';

const MIN_HOLD_SPACING = 12;

// Unit counts per player, one array per faction: 2 to 6 players, 20 to 60 units.
const CASES: WarfareCase[] = [
  { name: 'F2 balanced 3x40', factions: [[40, 40, 40], [40, 40, 40]] },
  { name: 'F2 uneven 165 vs 110', factions: [[60, 55, 50], [20, 25, 30, 35]] },
  { name: 'F3 balanced 4x30', factions: [[30, 30, 30, 30], [30, 30, 30, 30], [30, 30, 30, 30]] },
  { name: 'F3 uneven', factions: [[60, 60], [35, 40, 30, 35], [20, 20, 25, 20, 30, 20]] },
  { name: 'F5 balanced 5x40', factions: Array.from({ length: 5 }, () => [40, 40, 40, 40, 40]) },
  { name: 'F5 uneven', factions: [[20, 22, 24, 20, 25, 20], [60, 55], [45, 40, 50, 45], [30, 35, 25], [25, 30, 20, 25, 30]] },
  { name: 'F8 balanced 2x20', factions: Array.from({ length: 8 }, () => [20, 20]) },
  {
    name: 'F8 uneven',
    factions: [[60, 50], [20, 25, 20, 30, 20, 25], [40, 45, 35], [25, 20], [55, 60, 50, 45], [30, 30, 30, 30, 30], [20, 60], [35, 25, 45]],
  },
];

function report(name: string, r: object): void {
  process.stdout.write(`warfare ${name}: ${JSON.stringify(r)}\n`);
}

describe('warfare matrix', () => {
  for (const [i, c] of CASES.entries()) {
    it(`${c.name}: fights, captures, takes the citadel, and keeps territory moving`, () => {
      const r = runWarfare(c, 9001 + i * 31);
      report(c.name, r);
      expect(r.deathsFirst10).toBeGreaterThan(0);
      expect(r.capturesFirst10).toBeGreaterThan(0);
      expect(r.citadelTakenTick).toBeGreaterThan(0);
      expect(r.capturesLast10).toBeGreaterThanOrEqual(3);
      expect(r.idleAtHomeSamples).toBe(0);
      expect(r.idleWarbandSamples).toBe(0);
      expect(r.holdSpacing).toBeGreaterThan(MIN_HOLD_SPACING);
    }, 120_000);
  }

  it('a 6:1 two-faction rout ends in conquest, with the underdog still fighting', () => {
    const r = runWarfare({ name: 'F2 rout', factions: [[60, 55, 50, 45, 40, 35], [20, 25]] }, 9032);
    report('F2 rout 285 vs 45', r);
    expect(r.dominationFaction).toBe(0);
    expect(r.citadelTakenTick).toBeGreaterThan(0);
    expect(r.deathsLast10).toBeGreaterThan(100);
    expect(r.idleWarbandSamples).toBe(0);
  }, 120_000);
});
