import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createGithubClient } from './github.ts';
import { Poller } from './poller.ts';
import { silentLogger } from './log.ts';
import { addPlayer, contribution, harness, type Harness } from './testing/harness.ts';

const NOW = Date.parse('2026-10-22T12:00:00Z');
let h: Harness;
afterEach(() => h.close());

function rows(h: Harness) {
  const db = h.store.db;
  return {
    contributions: db.prepare('SELECT * FROM contributions ORDER BY player_id, source_id').all(),
    inputs: db.prepare('SELECT * FROM round_inputs ORDER BY seq').all(),
    feed: db.prepare('SELECT * FROM feed ORDER BY id').all(),
    roundPlayers: db.prepare('SELECT * FROM round_players ORDER BY player_id').all(),
  };
}

describe('ingest idempotency', () => {
  it('upserting the same poll twice changes nothing and emits no inputs or feed', () => {
    h = harness();
    addPlayer(h.store, 1, 'alice');
    h.engine.boot(NOW);
    const poll = [contribution('commits', '2026-10-22', 5), contribution('review', '2026-10-21', 1, 'acme/rocket', 'review:R1')];
    h.ingest.apply(1, poll, NOW);
    h.ingest.apply(1, poll, NOW + 1000);
    const before = rows(h);
    const sentBefore = h.sent.length;

    const second = h.ingest.apply(1, poll, NOW + 2000);
    expect(second.added).toEqual([]);
    expect(second.feed).toBeNull();
    expect(rows(h)).toEqual(before);
    expect(h.sent.slice(sentBefore)).toEqual([]);
  });

  it('a growing commit count reinforces by the delta, in one grouped line', () => {
    h = harness();
    addPlayer(h.store, 1, 'alice');
    h.engine.boot(NOW);
    h.ingest.apply(1, [contribution('commits', '2026-10-22', 1)], NOW);
    const r = h.ingest.apply(1, [contribution('commits', '2026-10-22', 6), contribution('commits', '2026-10-22', 2, 'acme/docs')], NOW + 1000);
    expect(r.feed?.kind).toBe('reinforce');
    expect(r.feed?.message).toBe('@alice +3 infantry · 5 commits to acme/rocket, 2 commits to acme/docs');
    expect(r.feed?.units).toEqual({ infantry: 3, archers: 0, cavalry: 0 });
  });

  it('first enlistment emits a single enlist line for the whole history', () => {
    h = harness();
    addPlayer(h.store, 1, 'alice');
    h.engine.boot(NOW);
    const history = Array.from({ length: 10 }, (_, i) => contribution('commits', `2026-10-${String(10 + i).padStart(2, '0')}`, 1));
    h.ingest.apply(1, history, NOW);
    const feed = h.store.recentFeed(50).filter((f) => f.playerId === 1);
    expect(feed.map((f) => [f.kind, f.message])).toEqual([['enlist', '@alice enlists with 10 infantry']]);
  });

  it('contributions older than the window are stored but never announced', () => {
    h = harness();
    addPlayer(h.store, 1, 'alice');
    h.engine.boot(NOW);
    h.ingest.apply(1, [], NOW);
    const r = h.ingest.apply(1, [contribution('merged_pr', '2026-09-01', 1, 'acme/rocket', 'pr:OLD')], NOW + 1000);
    expect(r.added).toHaveLength(1);
    expect(r.feed).toBeNull();
  });
});

describe('end to end: GitHub response to muster input', () => {
  it('polls the fixture and logs a muster with the counted army', async () => {
    h = harness();
    addPlayer(h.store, 1001, 'alice');
    h.engine.boot(NOW);
    const fixture = readFileSync(new URL('./testing/github-fixture.json', import.meta.url), 'utf8');
    const github = createGithubClient('t', (async () => new Response(fixture)) as unknown as typeof fetch);
    const poller = new Poller({ store: h.store, github, ingest: h.ingest, log: silentLogger, clock: () => NOW });

    await poller.pollNow(1001);

    const musters = h.store
      .inputsFrom(1, 0)
      .filter((i) => i.input.kind === 'muster' && i.input.playerId === 1001)
      .map((i) => i.input);
    expect(musters.at(-1)).toEqual({ kind: 'muster', playerId: 1001, infantry: 6, archers: 1, cavalry: 1, rank: 0 });
    expect(h.store.player(1001)).toMatchObject({ lastPolledAt: NOW, pollError: null });
    expect(h.store.recentFeed(10).at(-1)?.message).toBe('@alice enlists with 6 infantry, 1 archer, 1 cavalry');
  });

  it('records a poll error and backs off without throwing', async () => {
    h = harness();
    addPlayer(h.store, 1001, 'alice');
    h.engine.boot(NOW);
    const github = createGithubClient('t', (async () => new Response('nope', { status: 502 })) as unknown as typeof fetch);
    const poller = new Poller({ store: h.store, github, ingest: h.ingest, log: silentLogger, clock: () => NOW });
    await poller.pollNow(1001);
    expect(h.store.player(1001)).toMatchObject({ lastPolledAt: null, pollError: 'GitHub GraphQL 502' });
    expect(poller.nextDue(NOW)).toBeNull();
    expect(poller.nextDue(NOW + 31_000)?.id).toBe(1001);
  });
});

describe('poller budget', () => {
  it('spreads polls over the period and stays under 60% of the hourly points', () => {
    h = harness();
    const poller = new Poller({ store: h.store, github: { fetchContributions: async () => { throw new Error('unused'); }, resolveLogin: async () => null }, ingest: h.ingest, log: silentLogger });
    expect(poller.gapMs(60)).toBe(10_000);
    (poller as unknown as { rate: object }).rate = { limit: 5000, remaining: 5000, resetAtMs: 0, cost: 1 };
    expect(poller.gapMs(10_000)).toBe(1200);
  });
});
