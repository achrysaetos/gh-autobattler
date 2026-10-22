import { randomBytes, randomInt } from 'node:crypto';
import type { RoomFighter, RoomSummary, RoomsResponse } from '../protocol.ts';
import { soldiers } from '../rules/army.ts';
import { PALETTE } from '../rules/factions.ts';
import { fieldArmies } from '../rules/fielding.ts';
import { roomName } from '../rules/naming.ts';
import type { Army } from '../rules/types.ts';
import { TICKS_PER_SECOND, type SimModule, type WorldSnapshot } from '../sim/api.ts';
import type { Armory } from './armory.ts';
import { Battle, FEED_IN_HELLO, helloMessage, MIN_EXPECTED_UNITS, rosterMetas, type Channel, type Enrollment, type HelloMessage } from './battle.ts';
import type { RoundRow, Store } from './db.ts';
import { unitsPhrase } from './ingest.ts';
import type { Logger } from './log.ts';
import type { Lifecycle } from './scheduler.ts';

export const ROOM_DOMINATION_TICKS = 60 * TICKS_PER_SECOND;
export const ROOM_FIELDED_CAP = 1200;
export const RECENT_ROOMS = 20;
export const SLUG_PATTERN = /^[a-z2-7]{8}$/;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

export interface RoomsConfig {
  roomMs: number;
  maxLive: number;
}

export interface RoomsDeps {
  store: Store;
  sim: SimModule;
  armory: Armory;
  log: Logger;
  config: RoomsConfig;
  channelFor: (slug: string) => Channel;
  newSeed?: () => number;
}

export interface Fighter {
  playerId: number;
  login: string;
  army: Army;
  language: string | null;
}

export class Rooms implements Lifecycle {
  readonly name = 'rooms';
  private readonly live = new Map<string, Battle>();

  constructor(private readonly deps: RoomsDeps) {}

  boot(now: number): void {
    for (const round of this.deps.store.liveRooms()) {
      const slug = round.roomSlug!;
      this.live.set(slug, Battle.load(this.battleDeps(slug), round, now));
    }
    this.reconcile(now);
  }

  battles(): Battle[] {
    return [...this.live.values()];
  }

  reconcile(now: number): void {
    for (const [slug, battle] of this.live) {
      if (!battle.over(now)) continue;
      const fighters = this.deps.store.roomFighters(battle.round.id);
      battle.conclude(now, { intermissionEndsAt: null, winnerLogin: (f) => fighters.find((x) => x.faction === f)?.login ?? null });
      this.live.delete(slug);
    }
  }

  full(): boolean {
    return this.live.size >= this.deps.config.maxLive;
  }

  open(fighters: readonly Fighter[], now: number): string {
    const { store } = this.deps;
    const fielded = fieldArmies(new Map(fighters.map((f) => [f.playerId, f.army])), ROOM_FIELDED_CAP);
    const roster: Enrollment[] = fighters.map((f, faction) => ({
      playerId: f.playerId,
      faction,
      muster: { ...fielded.get(f.playerId)!, rank: f.army.rank },
      soldiers: soldiers(f.army),
    }));
    const totalFielded = roster.reduce((s, e) => s + soldiers(e.muster), 0);
    const slug = this.freeSlug();
    const battle = Battle.open(this.battleDeps(slug), {
      round: {
        name: roomName(fighters.map((f) => f.login)),
        seed: this.deps.newSeed?.() ?? randomInt(1, 2 ** 31),
        factionCount: fighters.length,
        expectedUnits: Math.max(MIN_EXPECTED_UNITS, totalFielded),
        dominationTicks: ROOM_DOMINATION_TICKS,
        startsAt: now,
        endsAt: now + this.deps.config.roomMs,
        roomSlug: slug,
      },
      factions: fighters.map((f, faction) => ({ faction, name: `@${f.login}`, color: PALETTE[faction % PALETTE.length]!, language: f.language })),
      roster,
    });
    this.live.set(slug, battle);
    for (const [faction, f] of fighters.entries()) {
      const units = roster[faction]!.muster;
      battle.feed({
        at: now,
        kind: 'enlist',
        playerId: f.playerId,
        faction,
        message: `@${f.login} marches with ${unitsPhrase(units).join(', ')}`,
        url: null,
        units: { infantry: units.infantry, archers: units.archers, cavalry: units.cavalry },
      });
    }
    this.deps.log.info('room opened', { room: slug, round: battle.round.id, fighters: fighters.map((f) => f.login), fielded: totalFielded });
    return slug;
  }

  has(slug: string): boolean {
    return this.live.has(slug) || this.deps.store.roomBySlug(slug) !== null;
  }

  hello(slug: string, viewerPlayerId: number | null, now: number): HelloMessage | null {
    const { store, armory } = this.deps;
    const live = this.live.get(slug);
    if (live) return live.hello(rosterMetas(store, armory, live.round.id, now), viewerPlayerId, now);
    const round = store.roomBySlug(slug);
    const snap = round?.status === 'ended' ? store.latestSnapshot(round.id) : null;
    if (!round || !snap) return null;
    return helloMessage({
      round,
      factions: store.factions(round.id),
      players: rosterMetas(store, armory, round.id, now),
      snapshot: JSON.parse(snap.json) as WorldSnapshot,
      inputs: [],
      feed: store.roundFeed(round.id, FEED_IN_HELLO),
      viewerPlayerId,
      now,
    });
  }

  summaries(): RoomsResponse {
    const live = [...this.live.values()]
      .map((b) => this.summary(b.round, (faction) => b.world.factions[faction]?.score ?? 0))
      .sort((a, b) => b.startsAt - a.startsAt);
    const recent = this.deps.store.recentRooms(RECENT_ROOMS).map((r) => this.summary(r, null));
    return { live, recent };
  }

  snapshotAll(): void {
    for (const b of this.live.values()) b.persistSnapshot();
  }

  private summary(round: RoundRow, liveScore: ((faction: number) => number) | null): RoomSummary {
    const fighters: RoomFighter[] = this.deps.store.roomFighters(round.id).map((f) => ({
      login: f.login,
      avatarUrl: f.avatarUrl,
      faction: f.faction,
      color: f.color,
      soldiers: f.lastFielded ? soldiers(f.lastFielded) : 0,
      score: liveScore ? liveScore(f.faction) : (f.finalScore ?? 0),
    }));
    return {
      slug: round.roomSlug!,
      name: round.name,
      status: round.status,
      startsAt: round.startsAt,
      endsAt: round.endsAt,
      winnerLogin: round.winnerLogin,
      fighters,
    };
  }

  private battleDeps(slug: string) {
    return { store: this.deps.store, sim: this.deps.sim, log: this.deps.log, channel: this.deps.channelFor(slug) };
  }

  private freeSlug(): string {
    for (;;) {
      const slug = newSlug();
      if (!this.deps.store.roomBySlug(slug)) return slug;
    }
  }
}

function newSlug(): string {
  let bits = 0n;
  for (const byte of randomBytes(5)) bits = (bits << 8n) | BigInt(byte);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out = BASE32[Number(bits & 31n)]! + out;
    bits >>= 5n;
  }
  return out;
}
