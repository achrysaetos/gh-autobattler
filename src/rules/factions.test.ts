import { describe, expect, it } from 'vitest';
import { parseIsoDay } from './days.ts';
import { dominantLanguage, factionCount, formFactions, PALETTE, weakestFaction, type Recruit } from './factions.ts';
import { mulberry32 } from './prng.ts';
import type { Contribution } from './types.ts';

describe('factionCount', () => {
  it.each([
    [0, 1], [1, 1], [2, 2], [3, 2], [6, 2], [7, 3], [16, 4], [49, 7], [64, 8], [10_000, 8],
  ])('%i players form %i factions', (n, f) => {
    expect(factionCount(n)).toBe(f);
  });
});

describe('formFactions', () => {
  const recruits = (n: number, seed: number): Recruit[] => {
    const rng = mulberry32(seed);
    const langs = ['TypeScript', 'Rust', 'Go', null];
    return Array.from({ length: n }, (_, i) => ({
      playerId: i + 1,
      soldiers: Math.floor(rng() * 280),
      language: langs[Math.floor(rng() * langs.length)]!,
    }));
  };

  it('assigns every player to exactly one faction and fills every faction', () => {
    const r = recruits(37, 9);
    const plan = formFactions(r, factionCount(r.length), 1);
    const members = plan.flatMap((f) => f.members).sort((a, b) => a - b);
    expect(members).toEqual(r.map((x) => x.playerId));
    expect(plan.every((f) => f.members.length > 0)).toBe(true);
  });

  it('balances soldiers within the largest single army', () => {
    const r = recruits(64, 3);
    const plan = formFactions(r, 8, 1);
    const sizes = plan.map((f) => f.soldiers);
    const biggest = Math.max(...r.map((x) => x.soldiers));
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(biggest);
  });

  it('prefers a language match when factions are within 10%', () => {
    const plan = formFactions(
      [
        { playerId: 1, soldiers: 100, language: 'Rust' },
        { playerId: 2, soldiers: 95, language: 'Go' },
        { playerId: 3, soldiers: 50, language: 'Rust' },
      ],
      2,
      1,
    );
    expect(plan.find((f) => f.members.includes(3))!.members).toContain(1);
  });

  it('ignores language when the gap exceeds 10%', () => {
    const plan = formFactions(
      [
        { playerId: 1, soldiers: 100, language: 'Rust' },
        { playerId: 2, soldiers: 80, language: 'Go' },
        { playerId: 3, soldiers: 50, language: 'Rust' },
      ],
      2,
      1,
    );
    expect(plan.find((f) => f.members.includes(3))!.members).toContain(2);
  });

  it('names factions "{Language} {Epithet}" with unique, seed-stable names and palette colors', () => {
    const r = [
      { playerId: 1, soldiers: 10, language: 'Rust' },
      { playerId: 2, soldiers: 10, language: 'Rust' },
      { playerId: 3, soldiers: 10, language: null },
    ];
    const a = formFactions(r, 3, 42);
    expect(a.map((f) => f.name)).toEqual(formFactions(r, 3, 42).map((f) => f.name));
    expect(new Set(a.map((f) => f.name)).size).toBe(3);
    expect(a[0]!.name).toMatch(/^Rust \w+$/);
    expect(a[2]!.name).toMatch(/^Freelance \w+$/);
    expect(a.map((f) => f.color)).toEqual(PALETTE.slice(0, 3));
  });
});

describe('PALETTE', () => {
  it('has 8 distinct colors', () => {
    expect(new Set(PALETTE).size).toBe(8);
  });
});

describe('weakestFaction', () => {
  it('picks the fewest soldiers, then fewest members, then lowest id', () => {
    expect(weakestFaction([{ id: 0, soldiers: 50, members: 1 }, { id: 1, soldiers: 20, members: 4 }])).toBe(1);
    expect(weakestFaction([{ id: 0, soldiers: 20, members: 3 }, { id: 1, soldiers: 20, members: 2 }])).toBe(1);
    expect(weakestFaction([{ id: 0, soldiers: 20, members: 2 }, { id: 1, soldiers: 20, members: 2 }])).toBe(0);
  });
});

describe('dominantLanguage', () => {
  const today = parseIsoDay('2026-10-22');
  const c = (language: string | null, count: number, day = '2026-10-20'): Contribution => ({
    sourceId: `${language}${count}${day}`, kind: 'commits', day: parseIsoDay(day), count, repo: 'a/b', url: null, title: null, language,
  });

  it('weights by count inside the window only', () => {
    expect(dominantLanguage([c('Go', 3), c('Rust', 2), c('Rust', 50, '2026-08-01')], today)).toBe('Go');
    expect(dominantLanguage([c(null, 5)], today)).toBeNull();
  });
});

describe('faction language names', () => {
  it('never names two factions after the same language', () => {
    const recruits: Recruit[] = Array.from({ length: 16 }, (_, i) => ({
      playerId: i + 1,
      soldiers: 40,
      language: i % 4 === 0 ? 'Go' : 'Kotlin',
    }));
    const factions = formFactions(recruits, 4, 7);
    const named = factions.map((f) => f.language).filter((l) => l !== null);
    expect(new Set(named).size).toBe(named.length);
    expect(named.sort()).toEqual(['Go', 'Kotlin']);
  });
});
