import type { FactionMeta, FeedItem, PlayerMeta, RoundMeta, ServerMessage } from '../protocol.ts';
import { isoDay } from '../rules/days.ts';
import { objectiveName } from '../rules/names.ts';
import { NEUTRAL, TICK_MS, TICKS_PER_SECOND, type RoundParams, type SimInput, type SimModule, type TickEvents, type TimedInput, type World, type WorldSnapshot } from '../sim/api.ts';
import type { Armory } from './armory.ts';
import type { Muster, NewFeed, NewRound, RoundFactionRow, RoundRow, Store } from './db.ts';
import type { Logger } from './log.ts';

export const INPUT_LEAD_TICKS = 10;
export const CHECK_EVERY_TICKS = 50;
export const SNAPSHOT_EVERY_TICKS = 600;
export const MAX_STEPS_PER_LOOP = 50;
export const MIN_EXPECTED_UNITS = 60;
export const FEED_IN_HELLO = 50;

const EVENT_FEED_KINDS: readonly FeedItem['kind'][] = ['capture', 'domination'];

export interface Channel {
  send(msg: ServerMessage): void;
  reset(): void;
}

export interface BattleDeps {
  store: Store;
  sim: SimModule;
  log: Logger;
  channel: Channel;
}

export interface Enrollment {
  playerId: number;
  faction: number;
  muster: Muster;
  soldiers: number;
}

export interface Opening {
  round: NewRound;
  factions: RoundFactionRow[];
  roster: readonly Enrollment[];
}

export type HelloMessage = Extract<ServerMessage, { type: 'hello' }>;

export class Battle {
  private constructor(
    private readonly deps: BattleDeps,
    private current: RoundRow,
    readonly factions: readonly RoundFactionRow[],
    readonly world: World,
    private readonly pending: TimedInput[],
    private seq: number,
    private narratedThroughSimMs: number,
  ) {}

  static open(deps: BattleDeps, opening: Opening): Battle {
    const { store, sim } = deps;
    const inputs: TimedInput[] = [];
    for (const e of opening.roster) {
      inputs.push({ tick: 0, seq: inputs.length + 1, input: { kind: 'enlist', playerId: e.playerId, faction: e.faction } });
      inputs.push({ tick: 0, seq: inputs.length + 1, input: { kind: 'muster', playerId: e.playerId, ...e.muster } });
    }
    const id = store.transaction(() => {
      const id = store.insertRound(opening.round);
      store.insertFactions(id, opening.factions);
      for (const e of opening.roster) {
        store.insertRoundPlayer(id, e.playerId, e.faction);
        store.setLastFielded(id, e.playerId, e.muster, e.soldiers);
      }
      store.appendInputs(id, inputs);
      return id;
    });
    const round = store.round(id)!;
    const params = roundParams(round);
    const battle = new Battle(deps, round, opening.factions, sim.createWorld(params, sim.generateMap(params)), inputs, inputs.length, Number.NEGATIVE_INFINITY);
    battle.persistSnapshot();
    return battle;
  }

  static load(deps: BattleDeps, round: RoundRow, now: number): Battle {
    const { store, sim } = deps;
    const started = performance.now();
    const snap = store.latestSnapshot(round.id);
    const params = roundParams(round);
    const world = snap ? sim.restore(JSON.parse(snap.json) as WorldSnapshot) : sim.createWorld(params, sim.generateMap(params));
    const pending = round.status === 'active' ? store.inputsFrom(round.id, world.tick) : [];
    const battle = new Battle(deps, round, store.factions(round.id), world, pending, store.maxSeq(round.id), store.lastFeedAt(round.id, EVENT_FEED_KINDS));
    if (round.status === 'ended') return battle;
    const fromTick = world.tick;
    const logged = pending.length;
    battle.catchUp(now);
    deps.log.info('round recovered', {
      round: round.id,
      room: round.roomSlug,
      fromTick,
      toTick: world.tick,
      replayedInputs: logged - pending.length,
      ms: Math.round(performance.now() - started),
    });
    return battle;
  }

  get round(): RoundRow {
    return this.current;
  }

  behind(now: number): boolean {
    return this.current.status === 'active' && this.world.winner === NEUTRAL && this.world.tick < this.targetTick(now);
  }

  over(now: number): boolean {
    return this.current.status === 'active' && (this.world.winner !== NEUTRAL || now >= this.current.endsAt);
  }

  catchUp(now: number): void {
    while (this.behind(now)) this.step();
  }

  step(): void {
    const { sim, channel } = this.deps;
    const w = this.world;
    const due: SimInput[] = [];
    while (this.pending.length > 0 && this.pending[0]!.tick <= w.tick) due.push(this.pending.shift()!.input);
    const dominatorBefore = w.dominationFaction;
    const events = sim.step(w, due);
    this.narrate(events, dominatorBefore);
    if (w.tick % CHECK_EVERY_TICKS === 0) channel.send({ type: 'check', tick: w.tick, checksum: sim.checksum(w) });
    if (w.tick % SNAPSHOT_EVERY_TICKS === 0) this.persistSnapshot();
  }

  submit(now: number, inputs: readonly SimInput[], alsoInTransaction: () => void): void {
    const { store, channel } = this.deps;
    const tick = Math.max(this.world.tick, this.wallTick(now)) + INPUT_LEAD_TICKS;
    const timed = inputs.map((input) => ({ tick, seq: ++this.seq, input }));
    store.transaction(() => {
      store.appendInputs(this.current.id, timed);
      alsoInTransaction();
    });
    this.pending.push(...timed);
    this.pending.sort((a, b) => a.tick - b.tick || a.seq - b.seq);
    channel.send({ type: 'inputs', inputs: timed });
  }

  conclude(now: number, end: { intermissionEndsAt: number | null; winnerLogin: (faction: number) => string | null }): number | null {
    this.catchUp(now);
    const w = this.world;
    const winner = w.winner !== NEUTRAL ? w.winner : leader(w);
    const { store } = this.deps;
    store.transaction(() => {
      store.flushCombat(this.current.id, combatStats(w));
      store.endRound(this.current.id, {
        winnerFaction: winner,
        winnerLogin: winner === null ? null : end.winnerLogin(winner),
        intermissionEndsAt: end.intermissionEndsAt,
        endedAt: now,
        finalScores: w.factions.map((f) => ({ faction: f.id, score: f.score })),
      });
    });
    this.persistSnapshot();
    this.current = store.round(this.current.id)!;
    this.deps.log.info('round ended', { round: this.current.id, room: this.current.roomSlug, winner, tick: w.tick });
    this.feed({ at: now, kind: 'round', playerId: null, faction: winner, message: `${winner === null ? 'No faction' : this.factionName(winner)} wins ${this.current.name}.`, url: null, units: null });
    this.deps.channel.send({ type: 'round', round: this.meta() });
    return winner;
  }

  markFinalized(): void {
    this.current = { ...this.current, finalized: true };
  }

  persistSnapshot(): void {
    const { store, sim } = this.deps;
    store.transaction(() => {
      store.saveSnapshot(this.current.id, this.world.tick, JSON.stringify(sim.snapshot(this.world)), sim.checksum(this.world));
      store.flushCombat(this.current.id, combatStats(this.world));
    });
  }

  feed(item: Omit<NewFeed, 'roundId'>): FeedItem {
    const saved = this.deps.store.addFeed({ ...item, roundId: this.current.id });
    this.deps.channel.send({ type: 'feed', item: saved });
    return saved;
  }

  meta(): RoundMeta {
    return roundMeta(this.current);
  }

  hello(players: PlayerMeta[], viewerPlayerId: number | null, now: number): HelloMessage {
    return helloMessage({
      round: this.current,
      factions: this.factions,
      players,
      snapshot: this.deps.sim.snapshot(this.world),
      inputs: this.pending.filter((i) => i.tick >= this.world.tick),
      feed: this.current.roomSlug === null ? this.deps.store.campaignFeed(FEED_IN_HELLO) : this.deps.store.roundFeed(this.current.id, FEED_IN_HELLO),
      viewerPlayerId,
      now,
    });
  }

  private targetTick(now: number): number {
    return Math.min(this.wallTick(now), Math.floor((this.current.endsAt - this.current.startsAt) / TICK_MS));
  }

  private wallTick(now: number): number {
    return Math.max(0, Math.floor((now - this.current.startsAt) / TICK_MS));
  }

  private factionName(f: number): string {
    return this.factions[f]?.name ?? `Faction ${f + 1}`;
  }

  private narrate(events: TickEvents, dominatorBefore: number): void {
    const w = this.world;
    const at = this.current.startsAt + w.tick * TICK_MS;
    if (at <= this.narratedThroughSimMs) return;
    for (const c of events.captures) {
      if (c.faction === NEUTRAL) continue;
      const objective = w.map.objectives.find((o) => o.id === c.objectiveId);
      const label = objective ? objectiveName(objective) : `objective ${c.objectiveId}`;
      this.feed({ at, kind: 'capture', playerId: c.playerIds[0] ?? null, faction: c.faction, message: `${this.factionName(c.faction)} took ${label}.`, url: null, units: null });
    }
    const dominator = w.dominationFaction;
    if (dominator !== NEUTRAL && dominator !== dominatorBefore) {
      this.feed({ at, kind: 'domination', playerId: null, faction: dominator, message: `${this.factionName(dominator)} holds every objective. ${durationPhrase(w.params.dominationTicks)} to victory.`, url: null, units: null });
    }
    if (w.winner !== NEUTRAL) {
      this.feed({ at, kind: 'domination', playerId: null, faction: w.winner, message: `${this.factionName(w.winner)} wins by domination.`, url: null, units: null });
    }
  }
}

export function roundParams(round: RoundRow): RoundParams {
  return { seed: round.seed, factionCount: round.factionCount, expectedUnits: round.expectedUnits, dominationTicks: round.dominationTicks };
}

export function roundMeta(r: RoundRow): RoundMeta {
  return {
    id: r.id,
    roomSlug: r.roomSlug,
    name: r.name,
    status: r.status,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    intermissionEndsAt: r.intermissionEndsAt,
    winnerFaction: r.winnerFaction,
  };
}

export function helloMessage(h: {
  round: RoundRow;
  factions: readonly RoundFactionRow[];
  players: PlayerMeta[];
  snapshot: WorldSnapshot;
  inputs: TimedInput[];
  feed: FeedItem[];
  viewerPlayerId: number | null;
  now: number;
}): HelloMessage {
  return {
    type: 'hello',
    round: roundMeta(h.round),
    factions: h.factions.map(factionMeta),
    players: h.players,
    snapshot: h.snapshot,
    inputs: h.inputs,
    feed: h.feed,
    serverNow: h.now,
    roundStartMs: h.round.startsAt,
    tickMs: TICK_MS,
    viewerPlayerId: h.viewerPlayerId,
  };
}

export function rosterMetas(store: Store, armory: Armory, roundId: number, now: number): PlayerMeta[] {
  const today = isoDay(now);
  return store.roundPlayers(roundId).flatMap((rp) => {
    const player = store.player(rp.playerId);
    if (!player) return [];
    const { infantry, archers, cavalry } = rp.lastFielded ?? { infantry: 0, archers: 0, cavalry: 0 };
    return [{
      playerId: rp.playerId,
      login: player.login,
      avatarUrl: player.avatarUrl,
      faction: rp.faction,
      army: armory.get(rp.playerId, today).army,
      fielded: { infantry, archers, cavalry },
      demo: player.demo,
    }];
  });
}

export function durationPhrase(ticks: number): string {
  const seconds = ticks / TICKS_PER_SECOND;
  const [n, unit] = seconds % 3600 === 0 ? [seconds / 3600, 'hour'] : seconds % 60 === 0 ? [seconds / 60, 'minute'] : [seconds, 'second'];
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function factionMeta(f: RoundFactionRow): FactionMeta {
  return { id: f.faction, name: f.name, color: f.color, language: f.language };
}

function leader(world: World): number | null {
  let best: { id: number; score: number } | null = null;
  for (const f of world.factions) if (!best || f.score > best.score) best = f;
  return best?.id ?? null;
}

function combatStats(world: World) {
  return world.players.map((pl) => ({ playerId: pl.playerId, kills: pl.kills, losses: pl.losses, captures: pl.captures }));
}
