import { afterEach, describe, expect, it } from 'vitest';
import { PALETTE } from '../rules/factions.ts';
import { addDays } from '../rules/days.ts';
import type { IsoDay } from '../rules/types.ts';
import { TICK_MS, type World } from '../sim/api.ts';
import { SNAPSHOT_EVERY_TICKS } from './battle.ts';
import { silentLogger } from './log.ts';
import { Poller } from './poller.ts';
import { CREATE_LIMIT } from './recruit.ts';
import { ROOM_DOMINATION_TICKS, ROOM_FIELDED_CAP } from './rooms.ts';
import type { FakeUser } from './testing/fakeGithub.ts';
import { addPlayer, contribution, harness, HOUR, T0, tempDbPath, type Harness, type HarnessOptions } from './testing/harness.ts';

const NOW = T0 + HOUR;
const MINUTE = 60_000;
const DAY = 24 * HOUR;
const at = (tick: number) => NOW + tick * TICK_MS;

const maxed = (id: number): FakeUser => ({
  id,
  login: `vet${id}`,
  contributions: Array.from({ length: 28 }, (_, i) => {
    const day = addDays('2026-10-19' as IsoDay, -i);
    return [
      contribution('commits', day, 8, `acme/r${id}`),
      ...[1, 2, 3].map((n) => contribution('review', day, 1, 'acme/x', `review:${id}:${day}:${n}`)),
      ...[1, 2, 3].map((n) => contribution('merged_pr', day, 1, 'acme/x', `pr:${id}:${day}:${n}`)),
    ];
  }).flat(),
});

const USERS: FakeUser[] = [
  { id: 1, login: 'alice', contributions: [contribution('commits', '2026-10-18', 1), contribution('review', '2026-10-17', 1, 'acme/x', 'review:a1')] },
  { id: 2, login: 'bob', contributions: [contribution('commits', '2026-10-18', 8), contribution('commits', '2026-10-17', 2)] },
  { id: 3, login: 'carol', contributions: Array.from({ length: 10 }, (_, i) => contribution('commits', addDays('2026-10-19' as IsoDay, -i), 8)) },
  { id: 4, login: 'newbie', createdAtMs: NOW - 5 * DAY, contributions: [contribution('commits', '2026-10-18', 3)] },
  { id: 5, login: 'robo', type: 'Bot', contributions: [contribution('commits', '2026-10-18', 3)] },
  { id: 6, login: 'idle', contributions: [contribution('commits', '2026-08-01', 3)] },
  ...[101, 102, 103, 104, 105, 106, 107, 108].map(maxed),
];

const open: Harness[] = [];
function make(opts: HarnessOptions = {}): Harness {
  const h = harness({ users: USERS, now: NOW, ...opts });
  open.push(h);
  return h;
}
function crash(h: Harness): void {
  h.close();
  open.splice(open.indexOf(h), 1);
}
afterEach(() => {
  for (const h of open.splice(0)) h.close();
});

async function room(h: Harness, logins: string[], client = 'client-a'): Promise<string> {
  const r = await h.recruiter.create({ logins }, client);
  if (!r.body.ok) throw new Error(`room rejected: ${JSON.stringify(r.body)}`);
  return r.body.slug;
}

function runTo(h: Harness, now: number): void {
  while ([...h.campaign.battles(), ...h.rooms.battles()].some((b) => b.behind(now))) h.tick(now);
  h.scheduler.reconcile(now);
}

const liveWorld = (h: Harness, slug: string): World => h.rooms.battles().find((b) => b.round.roomSlug === slug)!.world;

describe('room creation', () => {
  it('reports every rejected fighter in one response and writes nothing', async () => {
    const h = make();
    const r = await h.recruiter.create({ logins: ['alice', 'ghost', 'robo', 'newbie', 'idle', 'ALICE', 'dependabot[bot]'] }, 'c');
    expect(r).toEqual({
      status: 422,
      body: {
        ok: false,
        error: 'rejected_fighters',
        rejected: [
          { login: 'ghost', reason: 'not_found' },
          { login: 'robo', reason: 'bot' },
          { login: 'newbie', reason: 'too_new' },
          { login: 'idle', reason: 'no_public_activity' },
          { login: 'ALICE', reason: 'duplicate' },
          { login: 'dependabot[bot]', reason: 'bot' },
        ],
      },
    });
    expect(h.github.calls).toEqual(['alice', 'ghost', 'robo', 'newbie', 'idle']);
    expect(h.rooms.battles()).toEqual([]);
    expect(h.store.players()).toEqual([]);
    expect(h.store.liveRooms()).toEqual([]);
  });

  it('refuses malformed requests before calling GitHub', async () => {
    const h = make();
    for (const body of [{ logins: ['alice'] }, { logins: Array.from({ length: 9 }, (_, i) => `u${i}`) }, { logins: ['alice', 'a--b'] }, { logins: 'alice,bob' }, null]) {
      const r = await h.recruiter.create(body, 'c');
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body).toMatchObject({ ok: false, error: 'invalid_request' });
    }
    expect(h.github.calls).toEqual([]);
  });

  it('answers github_unavailable when GitHub fails', async () => {
    const h = make();
    h.github.down = true;
    expect(await h.recruiter.create({ logins: ['alice', 'bob'] }, 'c')).toMatchObject({ status: 503, body: { ok: false, error: 'github_unavailable' } });
    expect(h.rooms.battles()).toEqual([]);
  });

  it('opens a room with one @login faction per fighter, armies mustered at tick 0, and its own feed', async () => {
    const h = make({ rooms: { roomMs: 10 * MINUTE } });
    const slug = await room(h, ['Alice', 'bob']);
    expect(slug).toMatch(/^[a-z2-7]{8}$/);
    const round = h.store.roomBySlug(slug)!;
    expect(round).toMatchObject({ name: '@alice vs @bob', status: 'active', startsAt: NOW, endsAt: NOW + 10 * MINUTE, roomSlug: slug });
    expect(h.store.factions(round.id)).toEqual([
      { faction: 0, name: '@alice', color: PALETTE[0], language: 'Rust' },
      { faction: 1, name: '@bob', color: PALETTE[1], language: 'Rust' },
    ]);
    expect(h.store.inputsFrom(round.id, 0).map((i) => [i.tick, i.input])).toEqual([
      [0, { kind: 'enlist', playerId: 1, faction: 0 }],
      [0, { kind: 'muster', playerId: 1, infantry: 1, archers: 1, cavalry: 0, rank: 0 }],
      [0, { kind: 'enlist', playerId: 2, faction: 1 }],
      [0, { kind: 'muster', playerId: 2, infantry: 6, archers: 0, cavalry: 0, rank: 0 }],
    ]);
    expect(liveWorld(h, slug).params).toEqual({ seed: 99, factionCount: 2, expectedUnits: 60, dominationTicks: ROOM_DOMINATION_TICKS });
    expect(ROOM_DOMINATION_TICKS * TICK_MS).toBe(MINUTE);
    expect(h.store.roundFeed(round.id, 10).map((f) => f.message)).toEqual(['@alice marches with 1 infantry, 1 archer', '@bob marches with 6 infantry']);
    expect(h.roomSent.filter((m) => m.slug !== slug)).toEqual([]);
  });

  it('fields at most 1200 units and sizes the map for what is fielded', async () => {
    const h = make();
    const slug = await room(h, USERS.filter((u) => u.id > 100).map((u) => u.login));
    const round = h.store.roomBySlug(slug)!;
    const fielded = h.store.roundPlayers(round.id).map((rp) => rp.lastFielded!.infantry + rp.lastFielded!.archers + rp.lastFielded!.cavalry);
    expect(fielded.reduce((a, b) => a + b, 0)).toBe(ROOM_FIELDED_CAP);
    expect(round.expectedUnits).toBe(ROOM_FIELDED_CAP);
  });

  it('reuses contributions fetched in the last 10 minutes instead of refetching', async () => {
    const h = make();
    await room(h, ['alice', 'bob']);
    expect(h.github.calls).toEqual(['alice', 'bob']);
    h.clock.now = NOW + 9 * MINUTE;
    await room(h, ['bob', 'carol']);
    expect(h.github.calls).toEqual(['alice', 'bob', 'carol']);
    h.clock.now = NOW + 11 * MINUTE;
    await room(h, ['alice', 'carol']);
    expect(h.github.calls).toEqual(['alice', 'bob', 'carol', 'alice']);
  });

  it('refuses new rooms past the live limit', async () => {
    const h = make({ rooms: { maxLive: 1 } });
    await room(h, ['alice', 'bob']);
    expect(await h.recruiter.create({ logins: ['carol', 'bob'] }, 'other')).toMatchObject({ status: 503, body: { ok: false, error: 'rooms_full' } });
  });

  it('rate limits each client to 6 creations per 10 minutes', async () => {
    const h = make();
    for (let i = 0; i < CREATE_LIMIT; i++) await room(h, ['alice', 'bob'], 'a');
    expect(await h.recruiter.create({ logins: ['alice', 'bob'] }, 'a')).toMatchObject({ status: 429, body: { ok: false, error: 'rate_limited' } });
    expect(h.rooms.battles()).toHaveLength(CREATE_LIMIT);
    await room(h, ['alice', 'bob'], 'b');
    h.clock.now = NOW + 10 * MINUTE;
    await room(h, ['alice', 'bob'], 'a');
  });
});

describe('the campaign ignores rooms', () => {
  it('never enlists, forms factions from, or polls room-only players, and keeps its feed apart', async () => {
    const h = make();
    await room(h, ['alice', 'bob']);
    addPlayer(h.store, 50, 'carl');
    h.store.upsertContributions(50, [contribution('commits', '2026-10-18', 2)], NOW);
    h.store.markPolled(50, NOW, null);
    h.campaign.boot(NOW);

    const campaignRound = h.campaign.status().round!;
    expect(campaignRound.roomSlug).toBeNull();
    expect(campaignRound.name).toMatch(/^Campaign I · /);
    expect(h.store.roundPlayers(campaignRound.id).map((rp) => rp.playerId)).toEqual([50]);
    expect(h.campaign.enlist(1, NOW + 1000)).toBeNull();
    expect(h.store.roundPlayers(campaignRound.id).map((rp) => rp.playerId)).toEqual([50]);
    expect(h.store.campaignFeed(50).map((f) => f.message).join('\n')).not.toContain('marches');
    expect(h.campaign.hello(null, NOW)!.feed.map((f) => f.message).join('\n')).not.toContain('marches');

    const poller = new Poller({ store: h.store, github: h.github, ingest: h.ingest, log: silentLogger });
    expect(poller.nextDue(NOW + 11 * MINUTE)?.id).toBe(50);
    await poller.pollNow(1);
    expect(h.github.calls).toEqual(['alice', 'bob']);
  });

  it('keeps its own round as current across a restart while a newer room is live', async () => {
    const path = tempDbPath();
    const first = make({ path });
    addPlayer(first.store, 50, 'carl');
    first.campaign.boot(NOW);
    const campaignId = first.campaign.status().round!.id;
    const slug = await room(first, ['alice', 'bob']);
    expect(first.store.roomBySlug(slug)!.id).toBeGreaterThan(campaignId);
    crash(first);

    const second = make({ path });
    second.campaign.boot(NOW + 1000);
    second.rooms.boot(NOW + 1000);
    expect(second.campaign.status().round).toMatchObject({ id: campaignId, roomSlug: null });
    expect(second.rooms.battles().map((b) => b.round.roomSlug)).toEqual([slug]);
  });
});

describe('room lifecycle', () => {
  it('ends at endsAt with the highest score winning, then stops stepping and never counts toward lifetime stats', async () => {
    const h = make({ rooms: { roomMs: MINUTE } });
    const slug = await room(h, ['alice', 'carol', 'bob']);
    runTo(h, at(300));
    const midway = liveWorld(h, slug).factions.map((f) => f.score);
    expect(midway[1]).toBeGreaterThan(midway[2]!);
    expect(midway[2]).toBeGreaterThan(midway[0]!);

    runTo(h, NOW + MINUTE + 5000);
    const round = h.store.roomBySlug(slug)!;
    expect(round).toMatchObject({ status: 'ended', winnerFaction: 1, winnerLogin: 'carol', finalized: false, intermissionEndsAt: null });
    expect(h.store.latestSnapshot(round.id)!.tick).toBe(600);
    expect(h.rooms.battles()).toEqual([]);
    expect(h.roomSent.filter((m) => m.msg.type === 'round').map((m) => m.msg.type === 'round' && m.msg.round)).toEqual([
      expect.objectContaining({ roomSlug: slug, status: 'ended', winnerFaction: 1 }),
    ]);

    const applied = h.sim.applied.length;
    const sentCount = h.roomSent.length;
    for (let i = 0; i < 5; i++) h.tick(NOW + 2 * MINUTE + i * 1000);
    h.scheduler.reconcile(NOW + 3 * MINUTE);
    expect(h.sim.applied.length).toBe(applied);
    expect(h.roomSent.length).toBe(sentCount);
    expect(h.store.latestSnapshot(round.id)!.tick).toBe(600);
    expect(h.store.lifetime(3)).toMatchObject({ roundsPlayed: 0, roundsWon: 0 });
    expect(h.store.history(3)).toEqual([]);
  });

  it('ends early when a fighter dominates', async () => {
    const h = make({ rooms: { roomMs: 10 * MINUTE }, sim: { winAt: { tick: 120, faction: 1 } } });
    const slug = await room(h, ['carol', 'alice']);
    runTo(h, at(200));
    const round = h.store.roomBySlug(slug)!;
    expect(round).toMatchObject({ status: 'ended', winnerFaction: 1, winnerLogin: 'alice' });
    expect(h.store.latestSnapshot(round.id)!.tick).toBe(120);
    expect(h.rooms.battles()).toEqual([]);
    expect(h.store.roundFeed(round.id, 50).map((f) => f.message)).toContain('@alice wins by domination.');
  });

  it('recovers mid-room to the same world as an uninterrupted run', async () => {
    const path = tempDbPath();
    const crashTick = SNAPSHOT_EVERY_TICKS + 230;
    const later = crashTick + 300;
    const config = { rooms: { roomMs: 3 * MINUTE }, sim: { captureEvery: 97 } };

    const control = make(config);
    const controlSlug = await room(control, ['alice', 'bob', 'carol']);
    for (let t = 1; t <= later; t++) control.tick(at(t));

    const first = make({ path, ...config });
    const slug = await room(first, ['alice', 'bob', 'carol']);
    for (let t = 1; t <= crashTick; t++) first.tick(at(t));
    crash(first);

    const second = make({ path, ...config });
    second.rooms.boot(at(later));
    const a = liveWorld(control, controlSlug);
    const b = liveWorld(second, slug);
    expect(b.tick).toBe(later);
    expect(second.sim.checksum(b)).toBe(control.sim.checksum(a));
    expect(b.players).toEqual(a.players);
    const captures = second.store.roundFeed(second.store.roomBySlug(slug)!.id, 500).filter((f) => f.kind === 'capture');
    expect(captures).toHaveLength(Math.floor(later / 97));
  });

  it('fast-forwards a room whose end passed during downtime and ends it normally', async () => {
    const path = tempDbPath();
    const first = make({ path, rooms: { roomMs: MINUTE } });
    const slug = await room(first, ['alice', 'carol']);
    for (let t = 1; t <= 300; t++) first.tick(at(t));
    crash(first);

    const second = make({ path, rooms: { roomMs: MINUTE } });
    second.rooms.boot(NOW + 30 * MINUTE);
    const round = second.store.roomBySlug(slug)!;
    expect(round).toMatchObject({ status: 'ended', winnerFaction: 1, winnerLogin: 'carol' });
    expect(second.store.latestSnapshot(round.id)!.tick).toBe(600);
    expect(second.rooms.battles()).toEqual([]);
  });

  it('greets a spectator of an ended room with the final snapshot, no inputs, and the result', async () => {
    const h = make({ rooms: { roomMs: MINUTE } });
    const slug = await room(h, ['alice', 'carol']);
    runTo(h, NOW + MINUTE);
    const hello = h.rooms.hello(slug, null, NOW + 5 * MINUTE)!;
    expect(hello.round).toMatchObject({ roomSlug: slug, status: 'ended', winnerFaction: 1, name: '@alice vs @carol' });
    expect((hello.snapshot.world as World).tick).toBe(600);
    expect(hello.inputs).toEqual([]);
    expect(hello.players.map((p) => [p.login, p.faction])).toEqual([['alice', 0], ['carol', 1]]);
    expect(hello.factions.map((f) => f.name)).toEqual(['@alice', '@carol']);
    expect(hello.feed.map((f) => f.message)).toEqual(['@alice marches with 1 infantry, 1 archer', '@carol marches with 40 infantry', '@carol wins @alice vs @carol.']);
    expect(h.rooms.hello('zzzzzzzz', null, NOW)).toBeNull();
  });
});

describe('room listing', () => {
  it('lists live rooms with current scores and the 20 most recently ended with final scores and winner', async () => {
    const h = make({ rooms: { roomMs: MINUTE, maxLive: 30 } });
    const slugs: string[] = [];
    for (let i = 0; i < 21; i++) {
      h.clock.now = NOW + i * 1000;
      slugs.push(await room(h, i % 2 === 0 ? ['alice', 'carol'] : ['carol', 'bob'], `c${i}`));
      runTo(h, NOW + i * 1000);
    }
    runTo(h, NOW + 2 * MINUTE);
    h.clock.now = NOW + 2 * MINUTE;
    const live = await room(h, ['bob', 'alice'], 'live');
    runTo(h, NOW + 2 * MINUTE + 10_000);

    const { live: liveRooms, recent } = h.rooms.summaries();
    const world = liveWorld(h, live);
    expect(liveRooms).toEqual([{
      slug: live, name: '@bob vs @alice', status: 'active', startsAt: NOW + 2 * MINUTE, endsAt: NOW + 3 * MINUTE, winnerLogin: null,
      fighters: [
        { login: 'bob', avatarUrl: 'https://avatars.example/2', faction: 0, color: PALETTE[0], soldiers: 6, score: world.factions[0]!.score },
        { login: 'alice', avatarUrl: 'https://avatars.example/1', faction: 1, color: PALETTE[1], soldiers: 2, score: world.factions[1]!.score },
      ],
    }]);
    expect(world.factions[0]!.score).toBeGreaterThan(0);

    expect(recent).toHaveLength(20);
    expect(recent.map((r) => r.slug)).toEqual(slugs.slice(1).reverse());
    const newest = recent[0]!;
    const finalWorld = JSON.parse(h.store.latestSnapshot(h.store.roomBySlug(newest.slug)!.id)!.json).world as World;
    expect(newest).toMatchObject({ status: 'ended', winnerLogin: 'carol', name: '@alice vs @carol' });
    expect(newest.fighters.map((f) => [f.login, f.score])).toEqual([['alice', finalWorld.factions[0]!.score], ['carol', finalWorld.factions[1]!.score]]);
  });
});
