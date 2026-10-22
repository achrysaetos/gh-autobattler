export type IsoDay = string & { readonly __brand: 'IsoDay' };

export type ContributionKind = 'commits' | 'merged_pr' | 'review';

export interface Contribution {
  sourceId: string;
  kind: ContributionKind;
  day: IsoDay;
  count: number;
  repo: string;
  url: string | null;
  title: string | null;
  language: string | null;
}

export interface DayLedger {
  day: IsoDay;
  commits: number;
  mergedPrs: number;
  reviews: number;
  infantry: number;
  archers: number;
  cavalry: number;
}

export interface Army {
  infantry: number;
  archers: number;
  cavalry: number;
  rank: number;
  activeDays: number;
  streak: number;
  days: DayLedger[];
}

export interface Fielded {
  infantry: number;
  archers: number;
  cavalry: number;
}

export interface Medal {
  id: string;
  name: string;
  description: string;
}

export interface LifetimeStats {
  roundsPlayed: number;
  roundsWon: number;
  kills: number;
  losses: number;
  captures: number;
  peakSoldiers: number;
}
