import { addDays } from './days.ts';
import type { Army, Contribution, ContributionKind, DayLedger, IsoDay } from './types.ts';

export const ARTICLES = {
  tourDays: 28,
  infantryPerDayCap: 4,
  archersPerDayCap: 3,
  cavalryPerDayCap: 3,
  daysPerRank: 7,
  maxRank: 4,
  rankBonus: 0.08,
} as const;

export function infantryForCommits(commits: number): number {
  if (commits <= 0) return 0;
  const log2 = 31 - Math.clz32(commits);
  return Math.min(ARTICLES.infantryPerDayCap, 1 + log2);
}

export function noGainReason(day: DayLedger | undefined, kinds: readonly ContributionKind[]): string {
  if (!day) return 'outside the 28-day tour';
  if (!kinds.includes('commits')) return 'daily cap reached';
  if (day.infantry >= ARTICLES.infantryPerDayCap) return 'daily infantry cap reached';
  return `next infantry at ${2 ** day.infantry} commits today`;
}

export function windowDays(today: IsoDay): IsoDay[] {
  const days: IsoDay[] = [];
  for (let i = ARTICLES.tourDays - 1; i >= 0; i--) days.push(addDays(today, -i));
  return days;
}

export function inWindow(day: IsoDay, today: IsoDay): boolean {
  return day <= today && day > addDays(today, -ARTICLES.tourDays);
}

export function computeArmy(contributions: readonly Contribution[], today: IsoDay): Army {
  const ledgers = new Map<IsoDay, DayLedger>();
  for (const day of windowDays(today)) {
    ledgers.set(day, { day, commits: 0, mergedPrs: 0, reviews: 0, infantry: 0, archers: 0, cavalry: 0 });
  }
  for (const c of contributions) {
    const ledger = ledgers.get(c.day);
    if (!ledger || c.count <= 0) continue;
    if (c.kind === 'commits') ledger.commits += c.count;
    else if (c.kind === 'merged_pr') ledger.mergedPrs += c.count;
    else ledger.reviews += c.count;
  }

  const days = [...ledgers.values()];
  let infantry = 0;
  let archers = 0;
  let cavalry = 0;
  let activeDays = 0;
  for (const d of days) {
    d.infantry = infantryForCommits(d.commits);
    d.archers = Math.min(ARTICLES.archersPerDayCap, d.reviews);
    d.cavalry = Math.min(ARTICLES.cavalryPerDayCap, d.mergedPrs);
    infantry += d.infantry;
    archers += d.archers;
    cavalry += d.cavalry;
    if (isActive(d)) activeDays++;
  }

  return {
    infantry,
    archers,
    cavalry,
    rank: Math.min(ARTICLES.maxRank, Math.floor(activeDays / ARTICLES.daysPerRank)),
    activeDays,
    streak: streak(days),
    days,
  };
}

export function soldiers(army: { infantry: number; archers: number; cavalry: number }): number {
  return army.infantry + army.archers + army.cavalry;
}

function isActive(d: DayLedger): boolean {
  return d.infantry + d.archers + d.cavalry > 0;
}

function streak(days: readonly DayLedger[]): number {
  let i = days.length - 1;
  const today = days[i];
  if (today && !isActive(today)) i--;
  let n = 0;
  for (; i >= 0; i--) {
    const d = days[i];
    if (!d || !isActive(d)) break;
    n++;
  }
  return n;
}
