import type { FeedItem } from '../protocol.ts';
import { inWindow } from '../rules/army.ts';
import { isoDay } from '../rules/days.ts';
import type { Army, Contribution, ContributionKind, Fielded } from '../rules/types.ts';
import type { Armory } from './armory.ts';
import type { ContributionDelta, Store } from './db.ts';
import type { Engine } from './engine.ts';

export interface IngestResult {
  firstMuster: boolean;
  added: ContributionDelta[];
  army: Army;
  feed: FeedItem | null;
}

const KIND_ORDER: Record<ContributionKind, number> = { merged_pr: 0, review: 1, commits: 2 };

export class Ingest {
  constructor(
    private readonly store: Store,
    private readonly armory: Armory,
    private readonly engine: Engine,
  ) {}

  apply(playerId: number, contributions: readonly Contribution[], now: number): IngestResult {
    const player = this.store.player(playerId);
    if (!player) throw new Error(`unknown player ${playerId}`);
    const today = isoDay(now);
    const firstMuster = player.lastPolledAt === null;
    const before = this.armory.get(playerId, today).army;
    const added = this.store.transaction(() => {
      const deltas = this.store.upsertContributions(playerId, contributions, now);
      this.store.markPolled(playerId, now, null);
      return deltas;
    });
    const army = added.length > 0 ? this.armory.refresh(playerId, today).army : before;

    let feed: FeedItem | null = null;
    const faction = this.engine.factionOf(playerId);
    if (firstMuster) {
      feed = this.engine.feed({
        at: now,
        kind: 'enlist',
        playerId,
        faction,
        message: enlistLine(player.login, army),
        url: null,
        units: { infantry: army.infantry, archers: army.archers, cavalry: army.cavalry },
      });
    } else {
      const fresh = added.filter((d) => inWindow(d.contribution.day, today));
      if (fresh.length > 0) {
        const gained = gain(before, army);
        feed = this.engine.feed({
          at: now,
          kind: 'reinforce',
          playerId,
          faction,
          message: reinforceLine(player.login, gained, fresh),
          url: fresh.find((d) => d.contribution.kind !== 'commits')?.contribution.url ?? fresh[0]!.contribution.url,
          units: gained,
        });
      }
    }

    const mustered = this.engine.remuster(now);
    if (added.length > 0 && !mustered.includes(playerId)) {
      const meta = this.engine.playerMeta(playerId, now);
      if (meta) this.engine.broadcastPlayer(meta);
    }
    return { firstMuster, added, army, feed };
  }
}

function gain(before: Fielded, after: Fielded): Fielded {
  return {
    infantry: Math.max(0, after.infantry - before.infantry),
    archers: Math.max(0, after.archers - before.archers),
    cavalry: Math.max(0, after.cavalry - before.cavalry),
  };
}

export function unitsPhrase(units: Fielded): string[] {
  const parts: string[] = [];
  if (units.infantry > 0) parts.push(`${units.infantry} infantry`);
  if (units.archers > 0) parts.push(`${units.archers} ${units.archers === 1 ? 'archer' : 'archers'}`);
  if (units.cavalry > 0) parts.push(`${units.cavalry} cavalry`);
  return parts;
}

export function enlistLine(login: string, army: Army): string {
  const parts = unitsPhrase(army);
  return parts.length === 0 ? `@${login} enlists, awaiting their first orders` : `@${login} enlists with ${parts.join(', ')}`;
}

export function reinforceLine(login: string, gained: Fielded, fresh: readonly ContributionDelta[]): string {
  const groups = new Map<string, { kind: ContributionKind; repo: string; n: number }>();
  for (const d of fresh) {
    const key = `${d.contribution.kind}\u0000${d.contribution.repo}`;
    const g = groups.get(key) ?? { kind: d.contribution.kind, repo: d.contribution.repo, n: 0 };
    g.n += d.added;
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.n - a.n || (a.repo < b.repo ? -1 : 1));
  const described = sorted.slice(0, 2).map(describe);
  if (sorted.length > 2) described.push(`${sorted.length - 2} more`);
  const units = unitsPhrase(gained).map((p) => `+${p}`);
  return `@${login}${units.length ? ` ${units.join(', ')}` : ''} · ${described.join(', ')}`;
}

function describe(g: { kind: ContributionKind; repo: string; n: number }): string {
  if (g.kind === 'commits') return `${g.n} ${g.n === 1 ? 'commit' : 'commits'} to ${g.repo}`;
  if (g.kind === 'merged_pr') return `${g.n === 1 ? 'PR' : `${g.n} PRs`} merged into ${g.repo}`;
  return `${g.n} ${g.n === 1 ? 'review' : 'reviews'} on ${g.repo}`;
}
