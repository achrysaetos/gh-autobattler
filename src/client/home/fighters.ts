import { ROOM_MAX_FIGHTERS, ROOM_MIN_FIGHTERS, type FighterRejection } from '../../protocol.ts';

export type ChipIssue = 'syntax' | FighterRejection;

export interface Chip {
  login: string;
  issue: ChipIssue | null;
}

export type Skip = { token: string; why: 'duplicate' | 'full' };

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export const ISSUE_TEXT: Record<ChipIssue, string> = {
  syntax: 'Not a valid GitHub username',
  not_found: 'No such GitHub user',
  bot: 'Bot accounts cannot fight',
  too_new: 'Account is younger than 30 days',
  no_public_activity: 'No public activity in the last 28 days',
  duplicate: 'Same account as another fighter',
};

export function isLogin(login: string): boolean {
  return LOGIN.test(login);
}

export function normalizeToken(token: string): string {
  return token
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '');
}

export function splitTokens(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map(normalizeToken)
    .filter((t) => t.length > 0);
}

export function addTokens(chips: readonly Chip[], text: string): { chips: Chip[]; skipped: Skip[] } {
  const next = chips.slice();
  const skipped: Skip[] = [];
  for (const token of splitTokens(text)) {
    if (next.some((c) => c.login.toLowerCase() === token.toLowerCase())) skipped.push({ token, why: 'duplicate' });
    else if (next.length >= ROOM_MAX_FIGHTERS) skipped.push({ token, why: 'full' });
    else next.push({ login: token, issue: /\[bot\]$/i.test(token) ? 'bot' : isLogin(token) ? null : 'syntax' });
  }
  return { chips: next, skipped };
}

export function markRejected(chips: readonly Chip[], rejected: readonly { login: string; reason: FighterRejection }[]): Chip[] {
  const byLogin = new Map(rejected.map((r) => [r.login.toLowerCase(), r.reason]));
  return chips.map((c) => {
    const reason = byLogin.get(c.login.toLowerCase());
    return reason ? { ...c, issue: reason } : c;
  });
}

export function rosterProblem(chips: readonly Chip[]): string | null {
  const bad = chips.filter((c) => c.issue !== null).length;
  if (bad > 0) return bad === 1 ? 'Remove the marked fighter to continue' : `Remove the ${bad} marked fighters to continue`;
  if (chips.length < ROOM_MIN_FIGHTERS) return `Add at least ${ROOM_MIN_FIGHTERS - chips.length} more`;
  return null;
}
