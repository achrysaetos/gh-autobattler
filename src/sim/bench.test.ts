import { describe, expect, it } from 'vitest';
import { step } from './index.ts';
import { MAX_ALIVE } from './stats.ts';
import { battleWorld, type Army } from './testkit.ts';

const BUDGET_MS = 6;

describe('benchmark', () => {
  it(`8 factions at the 2400 cap step in under ${BUDGET_MS} ms on average`, () => {
    const armies: Army[][] = Array.from({ length: 8 }, (_, f) =>
      Array.from({ length: 10 }, (_, p) => ({ infantry: 20, archers: 10 + (f % 3), cavalry: 10 - (f % 3), rank: p % 5 })),
    );
    const { world, inputs } = battleWorld(2024, armies);
    for (let t = 0; t < 600; t++) step(world, t === 0 ? inputs : []);

    const samples: number[] = [];
    let alive = 0;
    let attacks = 0;
    for (let t = 0; t < 1500; t++) {
      const start = performance.now();
      const ev = step(world, []);
      samples.push(performance.now() - start);
      alive += world.units.length;
      attacks += ev.attacks.length;
    }
    samples.sort((a, b) => a - b);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const p50 = samples[Math.floor(samples.length * 0.5)]!;
    const p99 = samples[Math.floor(samples.length * 0.99)]!;
    const meanAlive = alive / samples.length;
    // Vitest hides console output of passing tests; the numbers must always print.
    process.stdout.write(
      `bench: mean ${mean.toFixed(3)} ms, p50 ${p50.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, max ${samples[samples.length - 1]!.toFixed(3)} ms, ` +
        `mean alive ${meanAlive.toFixed(0)}, attacks/tick ${(attacks / samples.length).toFixed(1)}\n`,
    );
    expect(meanAlive).toBeGreaterThan(MAX_ALIVE * 0.95);
    expect(attacks / samples.length).toBeGreaterThan(20);
    expect(mean).toBeLessThan(BUDGET_MS);
  }, 60_000);
});
