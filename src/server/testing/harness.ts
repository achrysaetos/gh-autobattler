import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerMessage } from '../../protocol.ts';
import { parseIsoDay } from '../../rules/days.ts';
import type { Contribution, ContributionKind } from '../../rules/types.ts';
import { Armory } from '../armory.ts';
import { openDb, Store } from '../db.ts';
import { Campaign, type CampaignConfig } from '../campaign.ts';
import { Ingest } from '../ingest.ts';
import { Scheduler } from '../scheduler.ts';
import { silentLogger } from '../log.ts';
import { createFakeSim, type FakeSim, type FakeSimOptions } from './fakeSim.ts';

export const T0 = Date.parse('2026-10-19T00:00:00Z');
export const HOUR = 3_600_000;

export interface Harness {
  store: Store;
  campaign: Campaign;
  scheduler: Scheduler;
  tick(now: number): void;
  ingest: Ingest;
  sim: FakeSim;
  sent: ServerMessage[];
  close(): void;
}

export function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'pushfront-')), 'test.db');
}

export interface HarnessOptions {
  path?: string;
  sim?: FakeSimOptions;
  config?: Partial<CampaignConfig>;
  seed?: number;
  onSend?: (msg: ServerMessage, store: Store) => void;
}

export function harness(opts: HarnessOptions = {}): Harness {
  const db = openDb(opts.path ?? ':memory:');
  const store = new Store(db);
  const armory = new Armory(store);
  const sim = createFakeSim(opts.sim);
  const sent: ServerMessage[] = [];
  const campaign = new Campaign({
    store,
    sim,
    armory,
    config: { roundMs: 168 * HOUR, intermissionMs: HOUR, ...opts.config },
    log: silentLogger,
    channel: {
      send: (m) => {
        opts.onSend?.(m, store);
        sent.push(m);
      },
      reset: () => {},
    },
    newSeed: () => opts.seed ?? 99,
  });
  const scheduler = new Scheduler([campaign], silentLogger);
  return { store, campaign, scheduler, ingest: new Ingest(store, armory, campaign), sim, sent, tick: (now) => scheduler.tick(now), close: () => db.close() };
}

export function addPlayer(store: Store, id: number, login: string, demo = false): void {
  store.upsertPlayer({ id, nodeId: `U_${id}`, login, avatarUrl: `https://avatars.example/${id}`, createdAtGithub: 0, enlistedAt: T0, demo });
}

export function contribution(kind: ContributionKind, day: string, count: number, repo = 'acme/rocket', sourceId?: string): Contribution {
  return {
    sourceId: sourceId ?? (kind === 'commits' ? `commits:${repo}:${day}` : `${kind}:${repo}:${day}:${count}`),
    kind,
    day: parseIsoDay(day),
    count,
    repo,
    url: `https://github.com/${repo}`,
    title: null,
    language: 'Rust',
  };
}
