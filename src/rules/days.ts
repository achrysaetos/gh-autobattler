import type { IsoDay } from './types.ts';

export const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isoDay(ms: number): IsoDay {
  return new Date(ms).toISOString().slice(0, 10) as IsoDay;
}

export function parseIsoDay(s: string): IsoDay {
  if (!ISO_DAY.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new Error(`not an ISO day: ${s}`);
  return s as IsoDay;
}

export function dayStartMs(day: IsoDay): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function addDays(day: IsoDay, n: number): IsoDay {
  return isoDay(dayStartMs(day) + n * DAY_MS);
}
