import { DAY_MS } from './days.ts';

export const MIN_ACCOUNT_AGE_DAYS = 30;

export interface Recruitable {
  login: string;
  type: string;
  createdAtMs: number;
}

export type Eligibility = { ok: true } | { ok: false; reason: 'too_new' | 'bot' };

export function eligibility(account: Recruitable, nowMs: number): Eligibility {
  if (account.type === 'Bot' || account.login.toLowerCase().endsWith('[bot]')) return { ok: false, reason: 'bot' };
  if (nowMs - account.createdAtMs < MIN_ACCOUNT_AGE_DAYS * DAY_MS) return { ok: false, reason: 'too_new' };
  return { ok: true };
}
