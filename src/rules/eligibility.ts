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

const LOGIN = /^(?=.{1,39}$)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const BOT_SUFFIX = /\[bot\]$/i;

export function isGithubLogin(login: string): boolean {
  return LOGIN.test(login.replace(BOT_SUFFIX, ''));
}

export function isBotLogin(login: string): boolean {
  return BOT_SUFFIX.test(login);
}
