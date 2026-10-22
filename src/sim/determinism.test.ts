import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checksum, restore, snapshot, step } from './index.ts';
import { battleWorld, run } from './testkit.ts';

const armies = [
  [{ infantry: 20, archers: 10, cavalry: 8, rank: 2 }, { infantry: 6, archers: 12, cavalry: 2 }],
  [{ infantry: 10, archers: 4, cavalry: 16, rank: 4 }],
  [{ infantry: 30, archers: 2, cavalry: 0 }, { infantry: 4, archers: 4, cavalry: 4, rank: 1 }],
];

describe('determinism', () => {
  it('two worlds from the same params and inputs agree on every checksum for 3000 ticks', () => {
    const a = battleWorld(7, armies);
    const b = battleWorld(7, armies);
    let deaths = 0;
    for (let t = 0; t < 3000; t++) {
      const ea = step(a.world, t === 0 ? a.inputs : []);
      step(b.world, t === 0 ? b.inputs : []);
      deaths += ea.deaths.length;
      if (t % 100 === 0) expect(checksum(a.world)).toBe(checksum(b.world));
    }
    expect(checksum(a.world)).toBe(checksum(b.world));
    expect(deaths).toBeGreaterThan(50);
  });

  it('snapshot at tick 1000, restored and continued, equals the uninterrupted run at 3000', () => {
    const straight = battleWorld(11, armies);
    run(straight.world, 3000, straight.inputs);

    const split = battleWorld(11, armies);
    run(split.world, 1000, split.inputs);
    const resumed = restore(snapshot(split.world));
    expect(checksum(resumed)).toBe(checksum(split.world));
    run(resumed, 2000);
    expect(resumed.tick).toBe(3000);
    expect(checksum(resumed)).toBe(checksum(straight.world));
  });

  it('JSON round trip of a snapshot preserves the checksum', () => {
    const { world, inputs } = battleWorld(3, armies);
    run(world, 800, inputs);
    const wire = JSON.parse(JSON.stringify(snapshot(world)));
    const restored = restore(wire);
    expect(checksum(restored)).toBe(checksum(world));
    expect(restored.map.terrain).toEqual(world.map.terrain);
    expect(restored.territory).toEqual(world.territory);
  });

  it('checksum changes when any unit moves by one ulp', () => {
    const { world, inputs } = battleWorld(5, armies);
    run(world, 50, inputs);
    const before = checksum(world);
    const u = world.units[world.units.length - 1]!;
    u.x = u.x + Math.abs(u.x) * Number.EPSILON;
    expect(checksum(world)).not.toBe(before);
  });
});

const ALLOWED_MATH = new Set(['sqrt', 'floor', 'abs', 'min', 'max', 'imul']);
const FORBIDDEN = [/\bDate\b/, /\bperformance\b/, /\*\*/, /\bcrypto\b/, /\bfor\s*\([^)]*\bin\b/, /\.(keys|values|entries)\(\)/, /\bnew Set\b/, /\.forEach\(/, /playerId\s*[<>]/];
const EXEMPT = new Set(['mapgen.ts', 'demo.ts']);

function scan(file: string, source: string): string[] {
  const hits: string[] = [];
  source.split('\n').forEach((line, n) => {
    const code = line.replace(/\/\/.*$/, '');
    for (const m of code.matchAll(/\bMath\.(\w+)/g)) {
      if (!ALLOWED_MATH.has(m[1]!)) hits.push(`${file}:${n + 1} Math.${m[1]}`);
    }
    for (const re of FORBIDDEN) if (re.test(code)) hits.push(`${file}:${n + 1} ${re.source}`);
  });
  return hits;
}

describe('forbidden-Math scan', () => {
  it('flags every forbidden construct in a sample', () => {
    const bad = ['Math.sin(a)', 'Math.random()', 'Math.round(x)', 'Date.now()', 'x ** 2', 'for (const k in o) {}', 'm.values()', 'u.playerId < 0'];
    expect(scan('bad.ts', bad.join('\n'))).toHaveLength(bad.length);
    expect(scan('ok.ts', 'Math.sqrt(Math.floor(Math.abs(Math.min(1, Math.max(2, Math.imul(3, 4))))))')).toEqual([]);
  });

  it('finds no forbidden math in any sim module outside mapgen', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !EXEMPT.has(f));
    expect(files).toContain('world.ts');
    expect(files.length).toBeGreaterThan(8);
    expect(files.flatMap((f) => scan(f, readFileSync(join(dir, f), 'utf8')))).toEqual([]);
  });
});
