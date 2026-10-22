import type { PlayerRow, Store } from './db.ts';
import type { GithubClient, RateLimit } from './github.ts';
import type { Ingest } from './ingest.ts';
import { errorMessage, type Logger } from './log.ts';

export const POLL_PERIOD_MS = 10 * 60_000;
export const BUDGET_FRACTION = 0.6;
const HOUR_MS = 3_600_000;
const MIN_GAP_MS = 1000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = HOUR_MS;

export interface PollerDeps {
  store: Store;
  github: GithubClient;
  ingest: Ingest;
  log: Logger;
  clock?: () => number;
}

// Spends at most BUDGET_FRACTION of the token's hourly GraphQL points, polls the
// stalest player first, and never polls one player twice within POLL_PERIOD_MS.
export class Poller {
  private rate: RateLimit | null = null;
  private failures = new Map<number, { count: number; until: number }>();
  private inFlight = new Set<number>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private readonly clock: () => number;

  constructor(private readonly deps: PollerDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  start(): void {
    this.stopped = false;
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  gapMs(players: number): number {
    const spread = POLL_PERIOD_MS / Math.max(1, players);
    if (!this.rate) return Math.max(MIN_GAP_MS, spread);
    const pollsPerHour = (this.rate.limit * BUDGET_FRACTION) / Math.max(1, this.rate.cost);
    return Math.max(MIN_GAP_MS, spread, HOUR_MS / pollsPerHour);
  }

  nextDue(now: number): PlayerRow | null {
    const due = this.deps.store
      .players()
      .filter((p) => !p.demo && !this.inFlight.has(p.id))
      .filter((p) => p.lastPolledAt === null || now - p.lastPolledAt >= POLL_PERIOD_MS)
      .filter((p) => (this.failures.get(p.id)?.until ?? 0) <= now)
      .sort((a, b) => (a.lastPolledAt ?? -1) - (b.lastPolledAt ?? -1) || a.id - b.id);
    return due[0] ?? null;
  }

  async pollNow(playerId: number): Promise<void> {
    const player = this.deps.store.player(playerId);
    if (player && !player.demo) await this.poll(player);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.loop(), delay);
  }

  private async loop(): Promise<void> {
    let delay = MIN_GAP_MS;
    try {
      const now = this.clock();
      const reserve = this.rate ? this.rate.limit * (1 - BUDGET_FRACTION) : 0;
      if (this.rate && this.rate.remaining <= reserve && now < this.rate.resetAtMs) {
        delay = this.rate.resetAtMs - now + MIN_GAP_MS;
        this.deps.log.warn('poller pausing for rate limit reset', { resumeInMs: delay });
      } else {
        const player = this.nextDue(now);
        if (player) {
          await this.poll(player);
          delay = this.gapMs(this.deps.store.players().filter((p) => !p.demo).length);
        }
      }
    } catch (err) {
      this.deps.log.error('poller loop failed', { error: errorMessage(err) });
    }
    this.schedule(delay);
  }

  private async poll(player: PlayerRow): Promise<void> {
    if (this.inFlight.has(player.id)) return;
    this.inFlight.add(player.id);
    try {
      const result = await this.deps.github.fetchContributions(player.nodeId, this.clock());
      this.rate = result.rateLimit;
      if ('notFound' in result) throw new Error('GitHub user not found');
      if (result.account.databaseId !== player.id) throw new Error('node id resolved to a different account');
      this.deps.store.refreshIdentity(player.id, result.account.login, result.account.avatarUrl);
      this.deps.ingest.apply(player.id, result.contributions, this.clock());
      this.failures.delete(player.id);
    } catch (err) {
      const count = (this.failures.get(player.id)?.count ?? 0) + 1;
      const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (count - 1));
      this.failures.set(player.id, { count, until: this.clock() + backoff });
      this.deps.store.markPollError(player.id, errorMessage(err));
      this.deps.log.warn('poll failed', { player: player.id, login: player.login, error: errorMessage(err), backoffMs: backoff });
    } finally {
      this.inFlight.delete(player.id);
    }
  }
}
