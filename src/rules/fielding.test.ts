import { describe, expect, it } from 'vitest';
import { fieldArmies } from './fielding.ts';
import { mulberry32 } from './prng.ts';
import type { Fielded } from './types.ts';

function total(m: Map<number, Fielded>): number {
  let sum = 0;
  for (const f of m.values()) sum += f.infantry + f.archers + f.cavalry;
  return sum;
}

describe('fieldArmies', () => {
  it('fields everyone in full under the cap', () => {
    const armies = new Map([[1, { infantry: 10, archers: 2, cavalry: 0 }], [2, { infantry: 5, archers: 0, cavalry: 3 }]]);
    expect(fieldArmies(armies)).toEqual(armies);
  });

  it('scales proportionally above the cap', () => {
    const armies = new Map([[1, { infantry: 200, archers: 0, cavalry: 0 }], [2, { infantry: 100, archers: 100, cavalry: 0 }]]);
    const fielded = fieldArmies(armies, 200);
    expect(fielded.get(1)).toEqual({ infantry: 100, archers: 0, cavalry: 0 });
    expect(fielded.get(2)).toEqual({ infantry: 50, archers: 50, cavalry: 0 });
  });

  it('keeps at least one of every kind a player has', () => {
    const armies = new Map([[1, { infantry: 1000, archers: 0, cavalry: 0 }], [2, { infantry: 1, archers: 1, cavalry: 1 }]]);
    const fielded = fieldArmies(armies, 100);
    expect(fielded.get(2)).toEqual({ infantry: 1, archers: 1, cavalry: 1 });
    expect(total(fielded)).toBe(100);
  });

  it('is deterministic regardless of map insertion order', () => {
    const a = new Map([[1, { infantry: 7, archers: 3, cavalry: 1 }], [2, { infantry: 9, archers: 0, cavalry: 4 }]]);
    const b = new Map([...a].reverse());
    expect([...fieldArmies(a, 10)].sort()).toEqual([...fieldArmies(b, 10)].sort());
  });

  it('never exceeds the cap nor a player\'s own army over random rosters', () => {
    const rng = mulberry32(1234);
    for (let trial = 0; trial < 400; trial++) {
      const cap = 1 + Math.floor(rng() * 2400);
      const players = 1 + Math.floor(rng() * 300);
      const armies = new Map<number, Fielded>();
      for (let p = 0; p < players; p++) {
        const kind = () => (rng() < 0.3 ? 0 : Math.floor(rng() * 112));
        armies.set(p * 7 - 50, { infantry: kind(), archers: Math.min(84, kind()), cavalry: Math.min(84, kind()) });
      }
      const fielded = fieldArmies(armies, cap);
      const raw = [...armies.values()].reduce((s, a) => s + a.infantry + a.archers + a.cavalry, 0);
      expect(total(fielded)).toBeLessThanOrEqual(cap);
      expect(total(fielded)).toBe(Math.min(raw, cap));
      for (const [id, a] of armies) {
        const f = fielded.get(id)!;
        expect(f.infantry).toBeLessThanOrEqual(a.infantry);
        expect(f.archers).toBeLessThanOrEqual(a.archers);
        expect(f.cavalry).toBeLessThanOrEqual(a.cavalry);
      }
    }
  });
});
