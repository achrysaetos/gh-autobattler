import { NEUTRAL, type PlayerState, type TickEvents, type World } from '../sim/api.ts';
import type { FactionMeta, FeedItem, PlayerMeta, RoundMeta } from '../protocol.ts';
import { INITIAL_CONN, type ConnState } from './net/connection.ts';
import { objectiveName } from './names.ts';

export type Trend = -1 | 0 | 1;

export interface FactionStanding {
  id: number;
  name: string;
  color: number;
  score: number;
  territory: number;
  objectivesHeld: number;
  holdsCitadel: boolean;
  trend: Trend;
  players: number;
  alive: number;
}

export interface BattleLine {
  id: string;
  at: number;
  faction: number;
  message: string;
}

export interface Toast {
  id: number;
  at: number;
  faction: number;
  title: string;
  subtitle: string;
}

export interface HudSnapshot {
  conn: ConnState;
  round: RoundMeta | null;
  factions: readonly FactionMeta[];
  players: ReadonlyMap<number, PlayerMeta>;
  feed: readonly FeedItem[];
  battle: readonly BattleLine[];
  toasts: readonly Toast[];
  standings: readonly FactionStanding[];
  warStates: ReadonlyMap<number, PlayerState>;
  alive: ReadonlyMap<number, readonly [number, number, number]>;
  tick: number;
  serverNow: number;
  hasWorld: boolean;
  winner: number;
  viewerPlayerId: number | null;
  selectedPlayerId: number | null;
  following: boolean;
}

const HUD_INTERVAL_MS = 250;
const TREND_WINDOW = 40;
const SKIRMISH_WINDOW_MS = 12_000;
const TOAST_MS = 4200;

export class Store {
  world: World | null = null;
  conn: ConnState = INITIAL_CONN;
  round: RoundMeta | null = null;
  factions: FactionMeta[] = [];
  players = new Map<number, PlayerMeta>();
  feed: FeedItem[] = [];
  viewerPlayerId: number | null = null;
  selectedPlayerId: number | null = null;
  following = false;
  serverNow = () => Date.now();

  private battle: BattleLine[] = [];
  private toasts: Toast[] = [];
  private toastId = 0;
  private hexHistory: number[][] = [];
  private deathsNear = new Map<number, { count: number; factions: Map<number, number> }>();
  private skirmishWindowStart = Date.now();
  private listeners = new Set<() => void>();
  private snap: HudSnapshot = this.build();

  constructor() {
    setInterval(() => this.publish(), HUD_INTERVAL_MS);
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): HudSnapshot => this.snap;

  publish(): void {
    this.snap = this.build();
    for (const fn of this.listeners) fn();
  }

  select(playerId: number | null, follow = playerId !== null): void {
    this.selectedPlayerId = playerId;
    this.following = follow;
    this.publish();
  }

  setFollowing(following: boolean): void {
    if (this.following === following) return;
    this.following = following;
    this.publish();
  }

  resetDerived(): void {
    this.hexHistory = [];
    this.deathsNear.clear();
  }

  addFeed(item: FeedItem): void {
    if (this.feed.some((f) => f.id === item.id)) return;
    this.feed.push(item);
    if (this.feed.length > 120) this.feed.shift();
  }

  factionName(id: number): string {
    return this.factions[id]?.name ?? 'Neutral garrison';
  }

  ingest(events: TickEvents, world: World): void {
    const defs = world.map.objectives;
    for (const d of events.deaths) {
      let nearest = 0;
      let best = Infinity;
      for (const o of defs) {
        const dd = (o.x - d.x) * (o.x - d.x) + (o.y - d.y) * (o.y - d.y);
        if (dd < best) {
          best = dd;
          nearest = o.id;
        }
      }
      let entry = this.deathsNear.get(nearest);
      if (!entry) this.deathsNear.set(nearest, (entry = { count: 0, factions: new Map() }));
      entry.count++;
      entry.factions.set(d.faction, (entry.factions.get(d.faction) ?? 0) + 1);
    }
    for (const c of events.captures) {
      const def = defs[c.objectiveId]!;
      const where = objectiveName(def);
      this.toasts.push({
        id: ++this.toastId,
        at: Date.now(),
        faction: c.faction,
        title: `${where} falls`,
        subtitle: c.previous === NEUTRAL ? `${this.factionName(c.faction)} broke the garrison` : `${this.factionName(c.faction)} took it from the ${this.factionName(c.previous)}`,
      });
    }
  }

  private flushSkirmishes(now: number): void {
    if (now - this.skirmishWindowStart < SKIRMISH_WINDOW_MS || !this.world) return;
    this.skirmishWindowStart = now;
    let hottest = -1;
    let count = 0;
    for (const [id, e] of this.deathsNear) {
      if (e.count > count) {
        count = e.count;
        hottest = id;
      }
    }
    if (hottest >= 0 && count >= 10) {
      const e = this.deathsNear.get(hottest)!;
      const sides = [...e.factions.entries()].sort((a, b) => b[1] - a[1]);
      const heaviest = sides[0]![0];
      const where = objectiveName(this.world.map.objectives[hottest]!, this.factions[this.world.map.objectives[hottest]!.homeFaction]?.name);
      this.battle.push({
        id: `b${now}`,
        at: now,
        faction: heaviest,
        message: `Fierce fighting near ${where} · ${count} fallen, the ${this.factionName(heaviest)} bleeding worst`,
      });
      if (this.battle.length > 40) this.battle.shift();
    }
    this.deathsNear.clear();
  }

  private build(): HudSnapshot {
    const now = Date.now();
    this.toasts = this.toasts.filter((t) => now - t.at < TOAST_MS);
    this.flushSkirmishes(now);
    const world = this.world;
    const alive = new Map<number, [number, number, number]>();
    const aliveByFaction = new Map<number, number>();
    const warStates = new Map<number, PlayerState>();
    let standings: FactionStanding[] = [];
    if (world) {
      for (const u of world.units) {
        let a = alive.get(u.playerId);
        if (!a) alive.set(u.playerId, (a = [0, 0, 0]));
        a[u.kind]++;
        aliveByFaction.set(u.faction, (aliveByFaction.get(u.faction) ?? 0) + 1);
      }
      for (const p of world.players) warStates.set(p.playerId, { ...p });
      const held = world.factions.map((f) => f.hexesHeld);
      this.hexHistory.push(held);
      if (this.hexHistory.length > TREND_WINDOW) this.hexHistory.shift();
      const past = this.hexHistory[0]!;
      const totalHexes = Math.max(1, world.map.hexes.length);
      const citadel = world.map.objectives.find((o) => o.kind === 'citadel');
      const playerCounts = new Map<number, number>();
      for (const p of this.players.values()) playerCounts.set(p.faction, (playerCounts.get(p.faction) ?? 0) + 1);
      standings = world.factions.map((f) => {
        const meta = this.factions[f.id];
        const delta = f.hexesHeld - (past[f.id] ?? f.hexesHeld);
        return {
          id: f.id,
          name: meta?.name ?? `Faction ${f.id + 1}`,
          color: meta?.color ?? 0x999999,
          score: f.score,
          territory: f.hexesHeld / totalHexes,
          objectivesHeld: f.objectivesHeld,
          holdsCitadel: citadel !== undefined && world.objectives[citadel.id]?.owner === f.id,
          trend: delta > 2 ? 1 : delta < -2 ? -1 : 0,
          players: playerCounts.get(f.id) ?? 0,
          alive: aliveByFaction.get(f.id) ?? 0,
        };
      });
    }
    return {
      conn: this.conn,
      round: this.round,
      factions: this.factions,
      players: new Map(this.players),
      feed: this.feed.slice(),
      battle: this.battle.slice(),
      toasts: this.toasts.slice(),
      standings,
      warStates,
      alive,
      tick: world?.tick ?? 0,
      serverNow: this.serverNow(),
      hasWorld: world !== null,
      winner: world?.winner ?? NEUTRAL,
      viewerPlayerId: this.viewerPlayerId,
      selectedPlayerId: this.selectedPlayerId,
      following: this.following,
    };
  }
}
