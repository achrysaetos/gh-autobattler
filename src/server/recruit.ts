import { z } from 'zod';
import { ROOM_MAX_FIGHTERS, ROOM_MIN_FIGHTERS, type CreateRoomResponse, type FighterRejection } from '../protocol.ts';
import { computeArmy, soldiers } from '../rules/army.ts';
import { isoDay } from '../rules/days.ts';
import { eligibility, isBotLogin, isGithubLogin } from '../rules/eligibility.ts';
import type { Contribution } from '../rules/types.ts';
import type { Armory } from './armory.ts';
import type { PlayerRow, Store } from './db.ts';
import type { GithubAccount, GithubClient } from './github.ts';
import type { Ingest } from './ingest.ts';
import { errorMessage, type Logger } from './log.ts';
import type { Fighter, Rooms } from './rooms.ts';

export const CONTRIBUTION_CACHE_MS = 10 * 60_000;
export const CREATE_LIMIT = 6;
export const CREATE_WINDOW_MS = 10 * 60_000;

const CreateRoomBody = z.object({ logins: z.array(z.string().trim()).min(ROOM_MIN_FIGHTERS).max(ROOM_MAX_FIGHTERS) });

export interface RecruitDeps {
  store: Store;
  armory: Armory;
  ingest: Ingest;
  rooms: Rooms;
  github: GithubClient | null;
  log: Logger;
  clock: () => number;
}

export interface Outcome {
  status: number;
  body: CreateRoomResponse;
}

type Resolved =
  | { kind: 'stored'; player: PlayerRow }
  | { kind: 'fetched'; account: GithubAccount; contributions: Contribution[] };

type Verdict = { ok: true; resolved: Resolved } | { ok: false; reason: FighterRejection };

class GithubUnavailable extends Error {}

export class Recruiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly deps: RecruitDeps) {}

  async create(body: unknown, client: string): Promise<Outcome> {
    const parsed = CreateRoomBody.safeParse(body);
    if (!parsed.success) {
      return invalid(`send {"logins": [...]} with ${ROOM_MIN_FIGHTERS} to ${ROOM_MAX_FIGHTERS} GitHub usernames`);
    }
    const logins = parsed.data.logins;
    const malformed = logins.find((l) => !isGithubLogin(l));
    if (malformed !== undefined) return invalid(`"${malformed}" is not a GitHub username`);
    if (this.deps.rooms.full()) return roomsFull();
    if (!this.admit(client, this.deps.clock())) {
      return { status: 429, body: { ok: false, error: 'rate_limited', message: `at most ${CREATE_LIMIT} rooms per ${CREATE_WINDOW_MS / 60_000} minutes` } };
    }
    if (!this.deps.github) return unavailable();

    const now = this.deps.clock();
    const firstIndex = new Map<string, number>();
    logins.forEach((l, i) => firstIndex.set(l.toLowerCase(), firstIndex.get(l.toLowerCase()) ?? i));
    let verdicts: Verdict[];
    try {
      verdicts = await Promise.all(
        logins.map((login, i): Promise<Verdict> | Verdict =>
          firstIndex.get(login.toLowerCase()) !== i ? { ok: false, reason: 'duplicate' } : this.judge(login, now),
        ),
      );
    } catch (err) {
      if (!(err instanceof GithubUnavailable)) throw err;
      this.deps.log.warn('room creation hit a GitHub failure', { error: err.message });
      return unavailable();
    }

    const seen = new Set<number>();
    const accepted: Resolved[] = [];
    const rejected = verdicts.flatMap((v, i) => {
      if (!v.ok) return [{ login: logins[i]!, reason: v.reason }];
      const id = idOf(v.resolved);
      if (seen.has(id)) return [{ login: logins[i]!, reason: 'duplicate' as const }];
      seen.add(id);
      accepted.push(v.resolved);
      return [];
    });
    if (rejected.length > 0) return { status: 422, body: { ok: false, error: 'rejected_fighters', rejected } };
    if (this.deps.rooms.full()) return roomsFull();

    const slug = this.deps.rooms.open(accepted.map((r) => this.enroll(r, now)), now);
    return { status: 201, body: { ok: true, slug } };
  }

  private admit(client: string, now: number): boolean {
    for (const [key, times] of this.hits) {
      const fresh = times.filter((t) => now - t < CREATE_WINDOW_MS);
      if (fresh.length === 0) this.hits.delete(key);
      else this.hits.set(key, fresh);
    }
    const times = this.hits.get(client) ?? [];
    if (times.length >= CREATE_LIMIT) return false;
    this.hits.set(client, [...times, now]);
    return true;
  }

  private async judge(login: string, now: number): Promise<Verdict> {
    if (isBotLogin(login)) return { ok: false, reason: 'bot' };
    const stored = this.deps.store.playerByLogin(login);
    if (stored?.lastPolledAt != null && now - stored.lastPolledAt < CONTRIBUTION_CACHE_MS) {
      const army = this.deps.armory.get(stored.id, isoDay(now)).army;
      return soldiers(army) > 0 ? { ok: true, resolved: { kind: 'stored', player: stored } } : { ok: false, reason: 'no_public_activity' };
    }
    let result;
    try {
      result = await this.deps.github!.fetchContributionsByLogin(login, now);
    } catch (err) {
      throw new GithubUnavailable(errorMessage(err));
    }
    if ('notFound' in result) return { ok: false, reason: 'not_found' };
    const verdict = eligibility(result.account, now);
    if (!verdict.ok) return { ok: false, reason: verdict.reason };
    if (soldiers(computeArmy(result.contributions, isoDay(now))) === 0) return { ok: false, reason: 'no_public_activity' };
    return { ok: true, resolved: { kind: 'fetched', account: result.account, contributions: result.contributions } };
  }

  private enroll(resolved: Resolved, now: number): Fighter {
    const { store, armory, ingest } = this.deps;
    if (resolved.kind === 'fetched') {
      const a = resolved.account;
      store.upsertPlayer({ id: a.databaseId, nodeId: a.nodeId, login: a.login, avatarUrl: a.avatarUrl, createdAtGithub: a.createdAtMs, enlistedAt: null, demo: false });
      if (store.player(a.databaseId)!.enlistedAt !== null) ingest.apply(a.databaseId, resolved.contributions, now);
      else ingest.record(a.databaseId, resolved.contributions, now);
    }
    const player = store.player(idOf(resolved))!;
    const muscle = armory.get(player.id, isoDay(now));
    return { playerId: player.id, login: player.login, army: muscle.army, language: muscle.language };
  }
}

function idOf(r: Resolved): number {
  return r.kind === 'stored' ? r.player.id : r.account.databaseId;
}

function invalid(message: string): Outcome {
  return { status: 400, body: { ok: false, error: 'invalid_request', message } };
}

function roomsFull(): Outcome {
  return { status: 503, body: { ok: false, error: 'rooms_full', message: 'every room slot is taken, try again in a few minutes' } };
}

function unavailable(): Outcome {
  return { status: 503, body: { ok: false, error: 'github_unavailable', message: 'GitHub could not be reached, try again shortly' } };
}
