import { randomInt } from 'node:crypto';
import type { FactionMeta, FeedItem, PlayerMeta, RoundMeta, ServerMessage } from '../protocol.ts';
import { soldiers } from '../rules/army.ts';
import { isoDay } from '../rules/days.ts';
import { factionCount, formFactions, weakestFaction } from '../rules/factions.ts';
import { fieldArmies } from '../rules/fielding.ts';
import { campaignName } from '../rules/naming.ts';
import { NEUTRAL, TICK_MS, type RoundParams, type SimInput, type SimModule, type TickEvents, type TimedInput, type World, type WorldSnapshot } from '../sim/api.ts';
import type { Armory } from './armory.ts';
import type { Muster, NewFeed, RoundFactionRow, RoundRow, Store } from './db.ts';
import { errorMessage, type Logger } from './log.ts';
import { objectiveName } from '../rules/names.ts';

export const INPUT_LEAD_TICKS = 10;
export const CHECK_EVERY_TICKS = 50;
export const SNAPSHOT_EVERY_TICKS = 600;
export const MAX_STEPS_PER_LOOP = 50;
export const MIN_EXPECTED_UNITS = 60;
const RECONCILE_MS = 2000;

export interface EngineConfig {
  roundMs: number;
  intermissionMs: number;
}

export interface EngineDeps {
  store: Store;
  sim: SimModule;
  armory: Armory;
  config: EngineConfig;
  log: Logger;
  broadcast: (msg: ServerMessage) => void;
  onWorldReset?: () => void;
  newSeed?: () => number;
}

type Phase =
  | { kind: 'none' }
  | { kind: 'active'; round: RoundRow; factions: RoundFactionRow[]; world: World; pending: TimedInput[]; seq: number }
  | { kind: 'ended'; round: RoundRow; factions: RoundFactionRow[]; world: World };

const EVENT_FEED_KINDS: readonly FeedItem['kind'][] = ['capture', 'domination'];

export class Engine {
  private phase: Phase = { kind: 'none' };
  private feedWatermark = Number.NEGATIVE_INFINITY;
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly deps: EngineDeps) {}

  boot(now: number): void {
    const round = this.deps.store.latestRound();
    if (round) this.load(round, now);
    this.reconcile(now);
  }

  start(clock: () => number = Date.now): void {
    const guard = (what: string, fn: () => void) => () => {
      try {
        fn();
      } catch (err) {
        this.deps.log.error(`${what} failed`, { error: errorMessage(err) });
      }
    };
    this.timers.push(setInterval(guard('tick loop', () => this.advance(clock())), TICK_MS));
    this.timers.push(setInterval(guard('reconcile', () => this.reconcile(clock())), RECONCILE_MS));
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  reconcile(now: number): void {
    for (;;) {
      const p = this.phase;
      if (p.kind === 'none') {
        this.startRound(now);
      } else if (p.kind === 'active') {
        if (p.world.winner === NEUTRAL && now < p.round.endsAt) {
          this.remuster(now);
          return;
        }
        this.stepUntil(p, Math.min(wallTick(p.round, now), endTick(p.round)), Number.POSITIVE_INFINITY);
        this.endRound(p, now);
      } else if (!p.round.finalized) {
        this.finalize(p);
      } else if (p.round.intermissionEndsAt !== null && now >= p.round.intermissionEndsAt) {
        this.startRound(now);
      } else {
        return;
      }
    }
  }

  advance(now: number, maxSteps: number = MAX_STEPS_PER_LOOP): void {
    const p = this.phase;
    if (p.kind !== 'active') return;
    this.stepUntil(p, Math.min(wallTick(p.round, now), endTick(p.round)), maxSteps);
  }

  enlist(playerId: number, now: number): number | null {
    const p = this.phase;
    if (p.kind !== 'active') return null;
    if (this.deps.store.roundPlayers(p.round.id).some((rp) => rp.playerId === playerId)) return null;
    const today = isoDay(now);
    const strength = p.factions.map((f) => ({ id: f.faction, soldiers: 0, members: 0 }));
    for (const rp of this.deps.store.roundPlayers(p.round.id)) {
      const f = strength[rp.faction];
      if (!f) continue;
      f.soldiers += soldiers(this.deps.armory.get(rp.playerId, today).army);
      f.members++;
    }
    const faction = weakestFaction(strength);
    this.submit(p, now, [{ kind: 'enlist', playerId, faction }], () => {
      this.deps.store.insertRoundPlayer(p.round.id, playerId, faction);
    });
    return faction;
  }

  remuster(now: number): number[] {
    const p = this.phase;
    if (p.kind !== 'active') return [];
    const today = isoDay(now);
    const roster = this.deps.store.roundPlayers(p.round.id);
    const armies = new Map(roster.map((rp) => [rp.playerId, this.deps.armory.get(rp.playerId, today).army]));
    const fielded = fieldArmies(armies);
    const changed = roster.flatMap((rp) => {
      const army = armies.get(rp.playerId)!;
      const muster: Muster = { ...fielded.get(rp.playerId)!, rank: army.rank };
      return sameMuster(rp.lastFielded, muster) ? [] : [{ playerId: rp.playerId, muster, soldiers: soldiers(army) }];
    });
    if (changed.length === 0) return [];
    this.submit(
      p,
      now,
      changed.map(({ playerId, muster }) => ({ kind: 'muster', playerId, ...muster })),
      () => {
        for (const c of changed) this.deps.store.setLastFielded(p.round.id, c.playerId, c.muster, c.soldiers);
      },
    );
    const ids = new Set(changed.map((c) => c.playerId));
    for (const meta of this.playerMetas(now)) if (ids.has(meta.playerId)) this.broadcastPlayer(meta);
    return [...ids];
  }

  snapshot(): void {
    const p = this.phase;
    if (p.kind === 'none') return;
    this.persistSnapshot(p.round, p.world);
  }

  feed(item: Omit<NewFeed, 'roundId'>): FeedItem {
    const roundId = this.phase.kind === 'none' ? null : this.phase.round.id;
    const saved = this.deps.store.addFeed({ ...item, roundId });
    this.deps.broadcast({ type: 'feed', item: saved });
    return saved;
  }

  factionOf(playerId: number): number | null {
    const p = this.phase;
    if (p.kind === 'none') return null;
    return this.deps.store.roundPlayers(p.round.id).find((rp) => rp.playerId === playerId)?.faction ?? null;
  }

  status(): { round: RoundMeta | null; tick: number | null; players: number } {
    const p = this.phase;
    if (p.kind === 'none') return { round: null, tick: null, players: 0 };
    return { round: roundMeta(p.round), tick: p.world.tick, players: this.deps.store.roundPlayers(p.round.id).length };
  }

  world(): World | null {
    return this.phase.kind === 'none' ? null : this.phase.world;
  }

  hello(viewerPlayerId: number | null, now: number): Extract<ServerMessage, { type: 'hello' }> | null {
    const p = this.phase;
    if (p.kind === 'none') return null;
    return {
      type: 'hello',
      round: roundMeta(p.round),
      factions: p.factions.map(factionMeta),
      players: this.playerMetas(now),
      snapshot: this.deps.sim.snapshot(p.world),
      inputs: p.kind === 'active' ? p.pending.filter((i) => i.tick >= p.world.tick) : [],
      feed: this.deps.store.recentFeed(50),
      serverNow: now,
      roundStartMs: p.round.startsAt,
      tickMs: TICK_MS,
      viewerPlayerId,
    };
  }

  broadcastPlayer(player: PlayerMeta): void {
    this.deps.broadcast({ type: 'player', player });
  }

  playerMeta(playerId: number, now: number): PlayerMeta | null {
    return this.playerMetas(now).find((m) => m.playerId === playerId) ?? null;
  }

  private playerMetas(now: number): PlayerMeta[] {
    const p = this.phase;
    if (p.kind === 'none') return [];
    const today = isoDay(now);
    return this.deps.store.roundPlayers(p.round.id).flatMap((rp) => {
      const player = this.deps.store.player(rp.playerId);
      if (!player) return [];
      const { infantry, archers, cavalry } = rp.lastFielded ?? { infantry: 0, archers: 0, cavalry: 0 };
      return [{
        playerId: rp.playerId,
        login: player.login,
        avatarUrl: player.avatarUrl,
        faction: rp.faction,
        army: this.deps.armory.get(rp.playerId, today).army,
        fielded: { infantry, archers, cavalry },
        demo: player.demo,
      }];
    });
  }

  private load(round: RoundRow, now: number): void {
    const started = performance.now();
    const factions = this.deps.store.factions(round.id);
    const world = this.restoreWorld(round);
    this.feedWatermark = this.deps.store.lastFeedAt(round.id, EVENT_FEED_KINDS);
    if (round.status === 'ended') {
      this.phase = { kind: 'ended', round, factions, world };
      return;
    }
    const fromTick = world.tick;
    const p: Extract<Phase, { kind: 'active' }> = {
      kind: 'active',
      round,
      factions,
      world,
      pending: this.deps.store.inputsFrom(round.id, world.tick),
      seq: this.deps.store.maxSeq(round.id),
    };
    this.phase = p;
    const loggedInputs = p.pending.length;
    this.stepUntil(p, Math.min(wallTick(round, now), endTick(round)), Number.POSITIVE_INFINITY);
    this.deps.log.info('round recovered', {
      round: round.id,
      fromTick,
      toTick: p.world.tick,
      replayedInputs: loggedInputs - p.pending.length,
      ms: Math.round(performance.now() - started),
    });
  }

  private restoreWorld(round: RoundRow): World {
    const snap = this.deps.store.latestSnapshot(round.id);
    if (snap) return this.deps.sim.restore(JSON.parse(snap.json) as WorldSnapshot);
    const params = roundParams(round);
    return this.deps.sim.createWorld(params, this.deps.sim.generateMap(params));
  }

  private startRound(now: number): void {
    const { store, armory, sim } = this.deps;
    const today = isoDay(now);
    const players = store.players();
    const muscles = new Map(players.map((pl) => [pl.id, armory.get(pl.id, today)]));
    const seed = this.deps.newSeed?.() ?? randomInt(1, 2 ** 31);
    const plan = formFactions(
      players.map((pl) => ({ playerId: pl.id, soldiers: soldiers(muscles.get(pl.id)!.army), language: muscles.get(pl.id)!.language })),
      factionCount(players.length),
      seed,
    );
    const fielded = fieldArmies(new Map([...muscles].map(([id, m]) => [id, m.army])));
    const totalFielded = [...fielded.values()].reduce((s, f) => s + soldiers(f), 0);
    const id = (store.latestRound()?.id ?? 0) + 1;
    const round: RoundRow = {
      id,
      name: campaignName(id, seed),
      status: 'active',
      seed,
      factionCount: plan.length,
      expectedUnits: Math.max(MIN_EXPECTED_UNITS, totalFielded),
      startsAt: now,
      endsAt: now + this.deps.config.roundMs,
      intermissionEndsAt: null,
      winnerFaction: null,
      finalized: false,
    };
    const factions: RoundFactionRow[] = plan.map((f) => ({ faction: f.id, name: f.name, color: f.color, language: f.language }));
    const params = roundParams(round);
    const world = sim.createWorld(params, sim.generateMap(params));

    const inputs: TimedInput[] = [];
    let seq = 0;
    for (const f of plan) {
      for (const playerId of f.members) {
        const m = muscles.get(playerId)!;
        inputs.push({ tick: 0, seq: ++seq, input: { kind: 'enlist', playerId, faction: f.id } });
        inputs.push({ tick: 0, seq: ++seq, input: { kind: 'muster', playerId, ...fielded.get(playerId)!, rank: m.army.rank } });
      }
    }

    store.transaction(() => {
      store.insertRound(round);
      store.insertFactions(id, factions);
      for (const f of plan) {
        for (const playerId of f.members) {
          const m = muscles.get(playerId)!;
          store.insertRoundPlayer(id, playerId, f.id);
          store.setLastFielded(id, playerId, { ...fielded.get(playerId)!, rank: m.army.rank }, soldiers(m.army));
        }
      }
      store.appendInputs(id, inputs);
    });

    this.phase = { kind: 'active', round, factions, world, pending: inputs, seq };
    this.feedWatermark = Number.NEGATIVE_INFINITY;
    this.persistSnapshot(round, world);
    this.deps.log.info('round started', { round: id, name: round.name, factions: plan.length, players: players.length });
    this.feed({ at: now, kind: 'round', playerId: null, faction: null, message: `${round.name} begins. ${plan.length} factions take the field.`, url: null, units: null });
    this.deps.broadcast({ type: 'round', round: roundMeta(round) });
    this.deps.onWorldReset?.();
  }

  private endRound(p: Extract<Phase, { kind: 'active' }>, now: number): void {
    const winner = p.world.winner !== NEUTRAL ? p.world.winner : leader(p.world);
    const intermissionEndsAt = now + this.deps.config.intermissionMs;
    const { store } = this.deps;
    store.transaction(() => {
      store.flushCombat(p.round.id, combatStats(p.world));
      store.endRound(p.round.id, winner, intermissionEndsAt);
    });
    this.persistSnapshot(p.round, p.world);
    const round: RoundRow = { ...p.round, status: 'ended', winnerFaction: winner, intermissionEndsAt };
    this.phase = { kind: 'ended', round, factions: p.factions, world: p.world };
    const name = winner === null ? 'No faction' : (p.factions[winner]?.name ?? `Faction ${winner + 1}`);
    this.deps.log.info('round ended', { round: round.id, winner });
    this.feed({ at: now, kind: 'round', playerId: null, faction: winner, message: `${name} wins ${round.name}.`, url: null, units: null });
    this.deps.broadcast({ type: 'round', round: roundMeta(round) });
  }

  private finalize(p: Extract<Phase, { kind: 'ended' }>): void {
    const { store } = this.deps;
    const applied = store.transaction(() => {
      if (!store.claimFinalize(p.round.id)) return false;
      store.addLifetime(
        store.roundPlayers(p.round.id).map((rp) => ({
          playerId: rp.playerId,
          roundsPlayed: 1,
          roundsWon: rp.faction === p.round.winnerFaction ? 1 : 0,
          kills: rp.kills,
          losses: rp.losses,
          captures: rp.captures,
          peakSoldiers: rp.peakSoldiers,
        })),
      );
      return true;
    });
    if (applied) this.deps.log.info('round finalized', { round: p.round.id });
    p.round = { ...p.round, finalized: true };
  }

  private submit(p: Extract<Phase, { kind: 'active' }>, now: number, inputs: readonly SimInput[], alsoInTransaction: () => void): void {
    const tick = Math.max(p.world.tick, wallTick(p.round, now)) + INPUT_LEAD_TICKS;
    const timed = inputs.map((input) => ({ tick, seq: ++p.seq, input }));
    this.deps.store.transaction(() => {
      this.deps.store.appendInputs(p.round.id, timed);
      alsoInTransaction();
    });
    p.pending.push(...timed);
    p.pending.sort((a, b) => a.tick - b.tick || a.seq - b.seq);
    this.deps.broadcast({ type: 'inputs', inputs: timed });
  }

  private stepUntil(p: Extract<Phase, { kind: 'active' }>, target: number, maxSteps: number): void {
    const { sim } = this.deps;
    for (let n = 0; n < maxSteps && p.world.tick < target && p.world.winner === NEUTRAL; n++) {
      const due: SimInput[] = [];
      while (p.pending.length > 0 && p.pending[0]!.tick <= p.world.tick) due.push(p.pending.shift()!.input);
      const dominatorBefore = p.world.dominationFaction;
      const events = sim.step(p.world, due);
      this.narrate(p, events, dominatorBefore);
      if (p.world.tick % CHECK_EVERY_TICKS === 0) {
        this.deps.broadcast({ type: 'check', tick: p.world.tick, checksum: sim.checksum(p.world) });
      }
      if (p.world.tick % SNAPSHOT_EVERY_TICKS === 0) this.persistSnapshot(p.round, p.world);
    }
  }

  private narrate(p: Extract<Phase, { kind: 'active' }>, events: TickEvents, dominatorBefore: number): void {
    const at = p.round.startsAt + p.world.tick * TICK_MS;
    if (at <= this.feedWatermark) return;
    const factionName = (f: number) => p.factions[f]?.name ?? `Faction ${f + 1}`;
    for (const c of events.captures) {
      if (c.faction === NEUTRAL) continue;
      const objective = p.world.map.objectives.find((o) => o.id === c.objectiveId);
      const label = objective ? objectiveName(objective) : `objective ${c.objectiveId}`;
      this.feed({ at, kind: 'capture', playerId: c.playerIds[0] ?? null, faction: c.faction, message: `${factionName(c.faction)} took ${label}.`, url: null, units: null });
    }
    const dominator = p.world.dominationFaction;
    if (dominator !== NEUTRAL && dominator !== dominatorBefore) {
      this.feed({ at, kind: 'domination', playerId: null, faction: dominator, message: `${factionName(dominator)} holds every objective. Six hours to victory.`, url: null, units: null });
    }
    if (p.world.winner !== NEUTRAL) {
      this.feed({ at, kind: 'domination', playerId: null, faction: p.world.winner, message: `${factionName(p.world.winner)} wins by domination.`, url: null, units: null });
    }
  }

  private persistSnapshot(round: RoundRow, world: World): void {
    const { store, sim } = this.deps;
    store.transaction(() => {
      store.saveSnapshot(round.id, world.tick, JSON.stringify(sim.snapshot(world)), sim.checksum(world));
      store.flushCombat(round.id, combatStats(world));
    });
  }
}

function sameMuster(a: Muster | null, b: Muster): boolean {
  return a !== null && a.infantry === b.infantry && a.archers === b.archers && a.cavalry === b.cavalry && a.rank === b.rank;
}

function wallTick(round: RoundRow, now: number): number {
  return Math.max(0, Math.floor((now - round.startsAt) / TICK_MS));
}

function endTick(round: RoundRow): number {
  return Math.floor((round.endsAt - round.startsAt) / TICK_MS);
}

function roundParams(round: RoundRow): RoundParams {
  return { seed: round.seed, factionCount: round.factionCount, expectedUnits: round.expectedUnits };
}

function leader(world: World): number | null {
  let best: { id: number; score: number } | null = null;
  for (const f of world.factions) if (!best || f.score > best.score) best = f;
  return best?.id ?? null;
}

function combatStats(world: World) {
  return world.players.map((pl) => ({ playerId: pl.playerId, kills: pl.kills, losses: pl.losses, captures: pl.captures }));
}

export function roundMeta(r: RoundRow): RoundMeta {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    intermissionEndsAt: r.intermissionEndsAt,
    winnerFaction: r.winnerFaction,
  };
}

function factionMeta(f: RoundFactionRow): FactionMeta {
  return { id: f.faction, name: f.name, color: f.color, language: f.language };
}
