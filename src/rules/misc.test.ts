import { describe, expect, it } from 'vitest';
import { DAY_MS } from './days.ts';
import { eligibility, isGithubLogin } from './eligibility.ts';
import { medalsFor } from './medals.ts';
import { campaignName, roman, roomName } from './naming.ts';
import type { LifetimeStats } from './types.ts';

const zero: LifetimeStats = { roundsPlayed: 0, roundsWon: 0, kills: 0, losses: 0, captures: 0, peakSoldiers: 0 };

describe('medalsFor', () => {
  it('awards nothing to a recruit', () => {
    expect(medalsFor(zero)).toEqual([]);
  });

  it('awards at the threshold, not below', () => {
    expect(medalsFor({ ...zero, kills: 999 }).map((m) => m.id)).toEqual(['first-blood']);
    expect(medalsFor({ ...zero, kills: 1000 }).map((m) => m.id)).toEqual(['first-blood', 'centurion']);
    expect(medalsFor({ ...zero, peakSoldiers: 100, captures: 25 }).map((m) => m.id)).toEqual(['standard-bearer', 'full-muster']);
  });

  it('awards all seven to a decorated veteran', () => {
    expect(medalsFor({ roundsPlayed: 10, roundsWon: 1, kills: 1000, losses: 0, captures: 25, peakSoldiers: 280 })).toHaveLength(7);
  });
});

describe('eligibility', () => {
  const now = Date.parse('2026-10-22T00:00:00Z');
  it('admits a 30-day-old user', () => {
    expect(eligibility({ login: 'alice', type: 'User', createdAtMs: now - 30 * DAY_MS }, now)).toEqual({ ok: true });
  });
  it('rejects a 29-day-old user', () => {
    expect(eligibility({ login: 'alice', type: 'User', createdAtMs: now - 29 * DAY_MS }, now)).toEqual({ ok: false, reason: 'too_new' });
  });
  it('rejects bots by type and by login suffix', () => {
    expect(eligibility({ login: 'robo', type: 'Bot', createdAtMs: 0 }, now)).toEqual({ ok: false, reason: 'bot' });
    expect(eligibility({ login: 'dependabot[bot]', type: 'User', createdAtMs: 0 }, now)).toEqual({ ok: false, reason: 'bot' });
  });
});

describe('isGithubLogin', () => {
  it('accepts GitHub login syntax, including a bot suffix so eligibility can name it', () => {
    for (const ok of ['a', 'torvalds', 'Some-User-1', 'x'.repeat(39), 'dependabot[bot]']) expect(isGithubLogin(ok), ok).toBe(true);
  });
  it('rejects leading, trailing, and doubled hyphens, other characters, and length over 39', () => {
    for (const bad of ['', '-a', 'a-', 'a--b', 'a_b', 'a b', 'a.b', 'x'.repeat(40), '[bot]']) expect(isGithubLogin(bad), bad).toBe(false);
  });
});

describe('roomName', () => {
  it('names a room after its fighters', () => {
    expect(roomName(['alice', 'Bob'])).toBe('@alice vs @Bob');
  });
});

describe('campaignName', () => {
  it('renders roman numerals', () => {
    expect([1, 4, 9, 12, 40, 2026].map(roman)).toEqual(['I', 'IV', 'IX', 'XII', 'XL', 'MMXXVI']);
  });
  it('is deterministic per seed', () => {
    expect(campaignName(12, 7)).toBe(campaignName(12, 7));
    expect(campaignName(12, 7)).toMatch(/^Campaign XII · The [A-Z][a-z]+( [a-z]+)? [A-Z][a-z]+$/);
  });
});
