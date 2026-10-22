import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'pf_session';
export const SESSION_MAX_AGE_S = 30 * 24 * 3600;

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function issueSession(playerId: number, issuedAtMs: number, secret: string): string {
  const payload = `${playerId}.${issuedAtMs}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function readSession(cookie: string | undefined, secret: string, nowMs: number): number | null {
  if (!cookie) return null;
  const match = /^(-?\d+)\.(\d+)\.([\w-]+)$/.exec(cookie);
  if (!match) return null;
  const [, id, issued, sig] = match as unknown as [string, string, string, string];
  const expected = Buffer.from(sign(`${id}.${issued}`, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (nowMs - Number(issued) > SESSION_MAX_AGE_S * 1000) return null;
  return Number(id);
}
