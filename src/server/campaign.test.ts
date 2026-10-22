import { afterEach, describe, expect, it } from 'vitest';
import { TICK_MS } from '../sim/api.ts';
import { CHECK_EVERY_TICKS, INPUT_LEAD_TICKS, MAX_STEPS_PER_LOOP, SNAPSHOT_EVERY_TICKS } from './battle.ts';
import { addPlayer, contribution, harness, HOUR, T0, tempDbPath, type Harness } from './testing/harness.ts';

const open: Harness[] = [];
function make(...args: Parameters<typeof harness>): Harness {
  const h = harness(...args);
  open.push(h);
  return h;
}
afterEach(() => {
  for (const h of open.splice(0)) h.close();
});

function seedPlayers(h: Harness, n: number): void {
  for (let i = 1; i <= n; i++) {
    addPlayer(h.store, i, `p${i}`);
    h.store.upsertContributions(i, [contribution('commits', '2026-10-18', i), contribution('review', '2026-10-17', 1, 'acme/x', `review:${i}`)], T0);
    h.store.markPolled(i, T0, null);
  }
}

const at = (tick: number) => T0 + tick * TICK_MS;

describe('round start', () => {
  it('creates one round, forms factions, and logs enlist plus muster for everyone at tick 0', () => {
    const h = make();
    seedPlayers(h, 5);
    h.campaign.boot(T0);
    const round = h.store.latestCampaignRound()!;
    expect(round).toMatchObject({ id: 1, status: 'active', factionCount: 2, startsAt: T0, endsAt: T0 + 168 * HOUR });
    expect(round.name).toMatch(/^Campaign I · /);
    expect(h.store.factions(1)).toHaveLength(2);
    const inputs = h.store.inputsFrom(1, 0);
    expect(inputs.every((i) => i.tick === 0)).toBe(true);
    expect(inputs.filter((i) => i.input.kind === 'enlist')).toHaveLength(5);
    expect(inputs.find((i) => i.input.kind === 'muster' && i.input.playerId === 4)?.input).toEqual({
      kind: 'muster', playerId: 4, infantry: 3, archers: 1, cavalry: 0, rank: 0,
    });
    h.campaign.reconcile(T0 + 1000);
    expect(h.store.latestCampaignRound()!.id).toBe(1);
  });
});

describe('tick loop', () => {
  it('catches up at most 50 steps per call toward the wall clock', () => {
    const h = make();
    h.campaign.boot(T0);
    h.tick(at(500));
    expect(h.campaign.world()!.tick).toBe(MAX_STEPS_PER_LOOP);
    for (let i = 0; i < 20; i++) h.tick(at(500));
    expect(h.campaign.world()!.tick).toBe(500);
  });

  it('broadcasts a checksum every 50 ticks and keeps the last 3 snapshots', () => {
    const h = make();
    h.campaign.boot(T0);
    for (let t = 50; t <= 4 * SNAPSHOT_EVERY_TICKS; t += 50) h.tick(at(t));
    const checks = h.sent.filter((m) => m.type === 'check');
    expect(checks.map((m) => m.type === 'check' && m.tick)).toEqual(
      Array.from({ length: (4 * SNAPSHOT_EVERY_TICKS) / CHECK_EVERY_TICKS }, (_, i) => (i + 1) * CHECK_EVERY_TICKS),
    );
    expect(h.store.snapshotCount(1)).toBe(3);
    expect(h.store.latestSnapshot(1)!.tick).toBe(4 * SNAPSHOT_EVERY_TICKS);
  });

  it('stamps inputs 10 ticks ahead of the wall clock and logs them before broadcasting', () => {
    const loggedAtBroadcast: number[] = [];
    const h = make({
      onSend: (m, store) => {
        if (m.type === 'inputs') loggedAtBroadcast.push(...m.inputs.filter((i) => store.inputsFrom(1, 0).some((x) => x.seq === i.seq)).map((i) => i.seq));
      },
    });
    addPlayer(h.store, 1, 'alice');
    h.campaign.boot(T0);
    h.tick(at(40));
    h.ingest.apply(1, [contribution('commits', '2026-10-19', 8)], at(42));
    const sent = h.sent.flatMap((m) => (m.type === 'inputs' ? m.inputs : []));
    expect(sent.map((i) => [i.tick, i.input])).toEqual([[42 + INPUT_LEAD_TICKS, { kind: 'muster', playerId: 1, infantry: 4, archers: 0, cavalry: 0, rank: 0 }]]);
    expect(loggedAtBroadcast).toEqual(sent.map((i) => i.seq));
    const roundPlayer = h.store.roundPlayers(1)[0]!;
    expect(roundPlayer.lastFielded).toEqual({ infantry: 4, archers: 0, cavalry: 0, rank: 0 });
  });

  it('applies each input at its stamped tick', () => {
    const h = make();
    addPlayer(h.store, 1, 'alice');
    h.campaign.boot(T0);
    h.tick(at(20));
    h.ingest.apply(1, [contribution('commits', '2026-10-19', 2)], at(20));
    for (let t = 21; t <= 40; t++) h.tick(at(t));
    const muster = h.sim.applied.filter((a) => a.input.kind === 'muster' && a.input.infantry === 2);
    expect(muster.map((a) => a.tick)).toEqual([30]);
  });

  it('enlists a mid-round recruit into the weakest faction', () => {
    const h = make();
    seedPlayers(h, 4);
    h.campaign.boot(T0);
    const strength = [0, 0];
    for (const rp of h.store.roundPlayers(1)) strength[rp.faction]! += rp.lastFielded!.infantry + rp.lastFielded!.archers;
    const weakest = strength[0]! <= strength[1]! ? 0 : 1;
    addPlayer(h.store, 50, 'newbie');
    expect(h.campaign.enlist(50, at(5))).toBe(weakest);
    expect(h.campaign.enlist(50, at(6))).toBeNull();
    expect(h.store.inputsFrom(1, 0).filter((i) => i.input.kind === 'enlist' && i.input.playerId === 50)).toHaveLength(1);
  });
});

describe('restart recovery', () => {
  it('replays snapshot plus logged inputs to the same world as an uninterrupted run', () => {
    const path = tempDbPath();
    const crashTick = SNAPSHOT_EVERY_TICKS + 230;

    const run = (h: Harness, until: number) => {
      for (let t = 1; t <= until; t++) {
        if (t === 100) h.ingest.apply(1, [contribution('commits', '2026-10-19', 3)], at(t));
        if (t === SNAPSHOT_EVERY_TICKS - INPUT_LEAD_TICKS) h.ingest.apply(2, [contribution('commits', '2026-10-19', 5)], at(t));
        if (t === SNAPSHOT_EVERY_TICKS + 100) h.ingest.apply(1, [contribution('review', '2026-10-19', 1, 'acme/x', 'review:A')], at(t));
        if (t === SNAPSHOT_EVERY_TICKS + 225) h.ingest.apply(2, [contribution('merged_pr', '2026-10-19', 1, 'acme/x', 'pr:B')], at(t));
        h.tick(at(t));
      }
    };

    const control = make({ sim: { captureEvery: 97 } });
    seedPlayers(control, 2);
    control.campaign.boot(T0);
    run(control, crashTick + 300);

    const first = make({ path, sim: { captureEvery: 97 } });
    seedPlayers(first, 2);
    first.campaign.boot(T0);
    run(first, crashTick);
    const feedBeforeCrash = first.store.campaignFeed(500).filter((f) => f.kind === 'capture').length;
    first.close();
    open.splice(open.indexOf(first), 1);

    const second = make({ path, sim: { captureEvery: 97 } });
    second.campaign.boot(at(crashTick + 300));

    const a = control.campaign.world()!;
    const b = second.campaign.world()!;
    expect(b.tick).toBe(crashTick + 300);
    expect(second.sim.checksum(b)).toBe(control.sim.checksum(a));
    expect(b.players).toEqual(a.players);

    const captures = second.store.campaignFeed(500).filter((f) => f.kind === 'capture');
    expect(captures.length).toBe(Math.floor((crashTick + 300) / 97));
    expect(captures.length).toBeGreaterThan(feedBeforeCrash);
    expect(new Set(captures.map((f) => f.at)).size).toBe(captures.length);
  });
});

describe('round lifecycle', () => {
  const short = { roundMs: 60_000, intermissionMs: 30_000 };

  it('ends at endsAt, finalizes once, and starts the next round after intermission', () => {
    const h = make({ config: short });
    seedPlayers(h, 3);
    h.campaign.boot(T0);
    h.campaign.reconcile(T0 + 60_000);
    const ended = h.store.round(1)!;
    expect(ended).toMatchObject({ status: 'ended', finalized: true, intermissionEndsAt: T0 + 90_000 });
    expect(h.campaign.world()!.tick).toBe(600);
    expect(ended.winnerFaction).not.toBeNull();

    h.campaign.reconcile(T0 + 70_000);
    expect(h.store.lifetime(1).roundsPlayed).toBe(1);
    expect(h.store.latestCampaignRound()!.id).toBe(1);

    h.campaign.reconcile(T0 + 90_000);
    const next = h.store.latestCampaignRound()!;
    expect(next).toMatchObject({ id: 2, status: 'active', startsAt: T0 + 90_000 });
    expect(next.name).toMatch(/^Campaign II · /);
    expect(h.store.roundPlayers(2)).toHaveLength(3);
  });

  it('ends early on a domination winner', () => {
    const h = make({ sim: { winAt: { tick: 120, faction: 1 } } });
    seedPlayers(h, 3);
    h.campaign.boot(T0);
    for (let t = 50; t <= 200; t += 50) h.tick(at(t));
    expect(h.campaign.world()!.tick).toBe(120);
    h.campaign.reconcile(at(200));
    expect(h.store.round(1)).toMatchObject({ status: 'ended', winnerFaction: 1 });
    const winners = h.store.roundPlayers(1).filter((rp) => rp.faction === 1).map((rp) => rp.playerId);
    for (const id of winners) expect(h.store.lifetime(id)).toMatchObject({ roundsPlayed: 1, roundsWon: 1 });
  });

  it('finalizes exactly once when the process dies between ending and finalizing', () => {
    const path = tempDbPath();
    const first = make({ path, config: short });
    seedPlayers(first, 3);
    first.campaign.boot(T0);
    first.tick(at(300));
    first.campaign.snapshot();
    first.store.endRound(1, { winnerFaction: 0, winnerLogin: null, intermissionEndsAt: T0 + 90_000, endedAt: T0 + 30_000, finalScores: [] });
    first.close();
    open.splice(open.indexOf(first), 1);

    const second = make({ path, config: short });
    second.campaign.boot(T0 + 61_000);
    second.campaign.reconcile(T0 + 62_000);
    const third = make({ path, config: short });
    third.campaign.boot(T0 + 63_000);
    third.campaign.reconcile(T0 + 64_000);

    for (let id = 1; id <= 3; id++) expect(third.store.lifetime(id).roundsPlayed).toBe(1);
    expect(third.store.round(1)).toMatchObject({ status: 'ended', finalized: true });
  });

  it('lets only one writer claim finalization of an ended round', () => {
    const h = make({ config: short });
    h.campaign.boot(T0);
    expect(h.store.claimFinalize(1)).toBe(false);
    h.store.endRound(1, { winnerFaction: 0, winnerLogin: null, intermissionEndsAt: T0, endedAt: T0, finalScores: [] });
    expect(h.store.claimFinalize(1)).toBe(true);
    expect(h.store.claimFinalize(1)).toBe(false);
  });
});

describe('hello', () => {
  it('carries the live snapshot, the inputs not yet applied, and the viewer', () => {
    const h = make();
    seedPlayers(h, 2);
    h.campaign.boot(T0);
    h.tick(at(10));
    h.ingest.apply(1, [contribution('commits', '2026-10-19', 9)], at(10));
    const hello = h.campaign.hello(1, at(10))!;
    expect(hello.viewerPlayerId).toBe(1);
    expect((hello.snapshot.world as { tick: number }).tick).toBe(10);
    expect(hello.inputs.map((i) => i.tick)).toEqual([20]);
    expect(hello.players.map((p) => p.login)).toEqual(['p1', 'p2']);
    expect(hello.roundStartMs).toBe(T0);
  });
});
