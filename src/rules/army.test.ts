import { describe, expect, it } from 'vitest';
import { computeArmy, infantryForCommits } from './army.ts';
import { addDays, parseIsoDay } from './days.ts';
import type { Contribution, ContributionKind, IsoDay } from './types.ts';

const today = parseIsoDay('2026-10-22');

function c(kind: ContributionKind, day: IsoDay, count: number, id = `${kind}:${day}:${count}`): Contribution {
  return { sourceId: id, kind, day, count, repo: 'acme/widgets', url: null, title: null, language: 'TypeScript' };
}

describe('infantryForCommits', () => {
  it.each([
    [0, 0], [1, 1], [2, 2], [3, 2], [4, 3], [7, 3], [8, 4], [9, 4], [1000, 4],
  ])('%i commits raise %i infantry', (commits, infantry) => {
    expect(infantryForCommits(commits)).toBe(infantry);
  });
});

describe('computeArmy', () => {
  it('has exactly 28 day ledgers, oldest first, ending today', () => {
    const army = computeArmy([], today);
    expect(army.days).toHaveLength(28);
    expect(army.days[0]!.day).toBe('2026-09-25');
    expect(army.days[27]!.day).toBe(today);
    expect(army).toMatchObject({ infantry: 0, archers: 0, cavalry: 0, rank: 0, activeDays: 0, streak: 0 });
  });

  it('sums commits across repos on the same day before applying the daily curve', () => {
    const army = computeArmy([c('commits', today, 1, 'a'), c('commits', today, 2, 'b')], today);
    expect(army.infantry).toBe(2);
    expect(army.days[27]).toMatchObject({ commits: 3, infantry: 2 });
  });

  it('caps reviews and merged PRs at 3 per day', () => {
    const army = computeArmy([c('review', today, 5), c('merged_pr', today, 4)], today);
    expect(army.archers).toBe(3);
    expect(army.cavalry).toBe(3);
  });

  it('counts day 28 (27 days ago) but not day 29', () => {
    const day28 = addDays(today, -27);
    const day29 = addDays(today, -28);
    expect(computeArmy([c('commits', day28, 1)], today).infantry).toBe(1);
    expect(computeArmy([c('commits', day29, 1)], today).infantry).toBe(0);
  });

  it('ignores contributions dated after today', () => {
    expect(computeArmy([c('commits', addDays(today, 1), 5)], today).infantry).toBe(0);
  });

  it('fields exactly 112 infantry from 500 commits a day for 28 days', () => {
    const spam = Array.from({ length: 28 }, (_, i) => c('commits', addDays(today, -i), 500));
    const army = computeArmy(spam, today);
    expect(army.infantry).toBe(112);
    expect(army.rank).toBe(4);
    expect(army.streak).toBe(28);
  });

  it('reaches the 280 soldier ceiling only with daily varied work', () => {
    const all = Array.from({ length: 28 }, (_, i) => {
      const d = addDays(today, -i);
      return [c('commits', d, 8), c('review', d, 3), c('merged_pr', d, 3)];
    }).flat();
    const army = computeArmy(all, today);
    expect(army.infantry + army.archers + army.cavalry).toBe(280);
  });

  it.each([
    [6, 0], [7, 1], [13, 1], [14, 2], [21, 3], [28, 4],
  ])('%i active days earn rank %i', (active, rank) => {
    const contributions = Array.from({ length: active }, (_, i) => c('review', addDays(today, -i), 1));
    expect(computeArmy(contributions, today).rank).toBe(rank);
  });

  it('keeps a streak alive while today is still empty and breaks it on a gap', () => {
    const yesterday = addDays(today, -1);
    const streakOf3 = [c('commits', yesterday, 1), c('commits', addDays(today, -2), 1), c('commits', addDays(today, -3), 1)];
    expect(computeArmy(streakOf3, today).streak).toBe(3);
    const gapped = [c('commits', today, 1), c('commits', addDays(today, -2), 1)];
    expect(computeArmy(gapped, today).streak).toBe(1);
  });

  it('is a pure function of its inputs', () => {
    const input = [c('commits', today, 3), c('review', addDays(today, -5), 2)];
    expect(computeArmy(input, today)).toEqual(computeArmy([...input].reverse(), today));
  });
});
