import type { CreateRoomResponse, FighterRejection, RoomFighter, RoomSummary, RoomsResponse } from '../../protocol.ts';
import { PALETTE } from '../../rules/factions.ts';
import { avatarFor, HANDLES } from './mockServer.ts';

const ROOM_MS = 10 * 60_000;
const DEMO_LOGINS = ['kestrel', 'mirela', 'oakhaven'];

const REJECTION_BY_PREFIX: [string, FighterRejection][] = [
  ['ghost', 'not_found'],
  ['fresh', 'too_new'],
  ['idle', 'no_public_activity'],
  ['alias', 'duplicate'],
];

const FAILURE_BY_LOGIN: Record<string, Extract<CreateRoomResponse, { message: string }>> = {
  ratelimit: { ok: false, error: 'rate_limited', message: 'You have started several battles in a short time. Wait a minute before starting another.' },
  fullhouse: { ok: false, error: 'rooms_full', message: 'Every field is in use. A room frees up when a battle ends.' },
  outage: { ok: false, error: 'github_unavailable', message: 'GitHub is not answering right now, so armies cannot be mustered. Try again shortly.' },
};

export interface MockRoomsOptions {
  empty: boolean;
}

export function mockRooms(opts: MockRoomsOptions) {
  const created = new Map<string, string[]>();
  const origin = Date.now();
  const sample = (slug: string, offset: number, size: number, startedAgoMs: number, ended: boolean): RoomSummary => {
    const startsAt = origin - startedAgoMs;
    const fighters: RoomFighter[] = Array.from({ length: size }, (_, i) => {
      const login = HANDLES[(offset + i * 5) % HANDLES.length]!;
      return { login, avatarUrl: avatarFor(login, PALETTE[i]!), faction: i, color: PALETTE[i]!, soldiers: 40 + ((offset * 37 + i * 53) % 180), score: 0 };
    });
    return { slug, name: `Skirmish ${slug}`, status: ended ? 'ended' : 'active', startsAt, endsAt: startsAt + ROOM_MS, winnerLogin: null, fighters };
  };
  const live = opts.empty
    ? []
    : [
        sample('demo', 0, 3, 45_000, false),
        sample('amber-pike', 3, 2, 4 * 60_000, false),
        sample('north-ford', 9, 5, 7.5 * 60_000, false),
        sample('salt-road', 14, 8, 1.5 * 60_000, false),
      ];
  const recent = opts.empty ? [] : [sample('iron-gate', 20, 4, 14 * 60_000, true), sample('low-marsh', 26, 2, 31 * 60_000, true), sample('ash-hollow', 31, 6, 58 * 60_000, true)];

  const scored = (room: RoomSummary, now: number): RoomSummary => {
    const elapsed = Math.max(0, Math.min(now, room.endsAt) - room.startsAt) / 1000;
    const fighters = room.fighters.map((f, i) => ({ ...f, score: Math.floor(elapsed * (0.6 + ((f.soldiers + i * 17) % 23) / 10)) }));
    const top = [...fighters].sort((a, b) => b.score - a.score)[0];
    return { ...room, fighters, winnerLogin: room.status === 'ended' ? (top?.login ?? null) : null };
  };

  return {
    rooms(): RoomsResponse {
      const now = Date.now();
      return { live: live.filter((r) => r.endsAt > now).map((r) => scored(r, now)), recent: recent.map((r) => scored(r, now)) };
    },
    createRoom(logins: string[]): CreateRoomResponse {
      const failure = logins.map((l) => FAILURE_BY_LOGIN[l.toLowerCase()]).find((f) => f !== undefined);
      if (failure) return failure;
      const rejected: { login: string; reason: FighterRejection }[] = [];
      for (const login of logins) {
        const lower = login.toLowerCase();
        const byPrefix = REJECTION_BY_PREFIX.find(([prefix]) => lower.startsWith(prefix));
        if (lower.endsWith('-bot')) rejected.push({ login, reason: 'bot' });
        else if (byPrefix) rejected.push({ login, reason: byPrefix[1] });
      }
      if (rejected.length) return { ok: false, error: 'rejected_fighters', rejected };
      const slug = `demo-${created.size + 1}`;
      created.set(slug, logins);
      return { ok: true, slug };
    },
    loginsFor(slug: string): string[] {
      return created.get(slug) ?? DEMO_LOGINS;
    },
  };
}
