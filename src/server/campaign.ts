import { randomInt } from 'node:crypto';
import type { FeedItem, PlayerMeta, RoundMeta } from '../protocol.ts';
import { soldiers } from '../rules/army.ts';
import { isoDay } from '../rules/days.ts';
import { factionCount, formFactions, weakestFaction } from '../rules/factions.ts';
import { fieldArmies } from '../rules/fielding.ts';
import { campaignName } from '../rules/naming.ts';
import { TICKS_PER_SECOND, type SimModule, type World } from '../sim/api.ts';
import type { Armory } from './armory.ts';
import { Battle, MIN_EXPECTED_UNITS, rosterMetas, type BattleDeps, type Channel, type Enrollment, type HelloMessage } from './battle.ts';
import type { Muster, NewFeed, Store } from './db.ts';
import type { Logger } from './log.ts';
import type { Lifecycle } from './scheduler.ts';

const CAMPAIGN_DOMINATION_TICKS = 6 * 60 * 60 * TICKS_PER_SECOND;

export interface CampaignConfig {
  roundMs: number;
  intermissionMs: number;
}

export interface CampaignDeps {
  store: Store;
  sim: SimModule;
  armory: Armory;
  config: CampaignConfig;
  log: Logger;
  channel: Channel;
  newSeed?: () => number;
}

type Phase =
  | { kind: 'none' }
  | { kind: 'active'; battle: Battle }
  | { kind: 'ended'; battle: Battle };

export class Campaign implements Lifecycle {
  readonly name = 'campaign';
  private phase: Phase = { kind: 'none' };
  private readonly battleDeps: BattleDeps;

  constructor(private readonly deps: CampaignDeps) {
    this.battleDeps = { store: deps.store, sim: deps.sim, log: deps.log, channel: deps.channel };
  }

  boot(now: number): void {
    const round = this.deps.store.latestCampaignRound();
    if (round) {
      const battle = Battle.load(this.battleDeps, round, now);
      this.phase = round.status === 'ended' ? { kind: 'ended', battle } : { kind: 'active', battle };
    }
    this.reconcile(now);
  }

  battles(): Battle[] {
    return this.phase.kind === 'active' ? [this.phase.battle] : [];
  }

  reconcile(now: number): void {
    for (;;) {
      const p = this.phase;
      if (p.kind === 'none') {
        this.startRound(now);
      } else if (p.kind === 'active') {
        if (!p.battle.over(now)) {
          this.remuster(now);
          return;
        }
        p.battle.conclude(now, { intermissionEndsAt: now + this.deps.config.intermissionMs, winnerLogin: () => null });
        this.phase = { kind: 'ended', battle: p.battle };
      } else if (!p.battle.round.finalized) {
        this.finalize(p.battle);
      } else if (p.battle.round.intermissionEndsAt !== null && now >= p.battle.round.intermissionEndsAt) {
        this.startRound(now);
      } else {
        return;
      }
    }
  }

  enlist(playerId: number, now: number): number | null {
    const p = this.phase;
    if (p.kind !== 'active') return null;
    const { store, armory } = this.deps;
    if (store.player(playerId)?.enlistedAt == null) return null;
    const roster = store.roundPlayers(p.battle.round.id);
    if (roster.some((rp) => rp.playerId === playerId)) return null;
    const today = isoDay(now);
    const strength = p.battle.factions.map((f) => ({ id: f.faction, soldiers: 0, members: 0 }));
    for (const rp of roster) {
      const f = strength[rp.faction];
      if (!f) continue;
      f.soldiers += soldiers(armory.get(rp.playerId, today).army);
      f.members++;
    }
    const faction = weakestFaction(strength);
    p.battle.submit(now, [{ kind: 'enlist', playerId, faction }], () => {
      store.insertRoundPlayer(p.battle.round.id, playerId, faction);
    });
    return faction;
  }

  remuster(now: number): number[] {
    const p = this.phase;
    if (p.kind !== 'active') return [];
    const { store, armory } = this.deps;
    const roundId = p.battle.round.id;
    const today = isoDay(now);
    const roster = store.roundPlayers(roundId);
    const armies = new Map(roster.map((rp) => [rp.playerId, armory.get(rp.playerId, today).army]));
    const fielded = fieldArmies(armies);
    const changed = roster.flatMap((rp) => {
      const army = armies.get(rp.playerId)!;
      const muster: Muster = { ...fielded.get(rp.playerId)!, rank: army.rank };
      return sameMuster(rp.lastFielded, muster) ? [] : [{ playerId: rp.playerId, muster, soldiers: soldiers(army) }];
    });
    if (changed.length === 0) return [];
    p.battle.submit(
      now,
      changed.map(({ playerId, muster }) => ({ kind: 'muster', playerId, ...muster })),
      () => {
        for (const c of changed) store.setLastFielded(roundId, c.playerId, c.muster, c.soldiers);
      },
    );
    const ids = new Set(changed.map((c) => c.playerId));
    for (const meta of this.playerMetas(now)) if (ids.has(meta.playerId)) this.broadcastPlayer(meta);
    return [...ids];
  }

  snapshot(): void {
    if (this.phase.kind !== 'none') this.phase.battle.persistSnapshot();
  }

  feed(item: Omit<NewFeed, 'roundId'>): FeedItem {
    if (this.phase.kind !== 'none') return this.phase.battle.feed(item);
    const saved = this.deps.store.addFeed({ ...item, roundId: null });
    this.deps.channel.send({ type: 'feed', item: saved });
    return saved;
  }

  factionOf(playerId: number): number | null {
    const p = this.phase;
    if (p.kind === 'none') return null;
    return this.deps.store.roundPlayers(p.battle.round.id).find((rp) => rp.playerId === playerId)?.faction ?? null;
  }

  status(): { round: RoundMeta | null; tick: number | null; players: number } {
    const p = this.phase;
    if (p.kind === 'none') return { round: null, tick: null, players: 0 };
    return { round: p.battle.meta(), tick: p.battle.world.tick, players: this.deps.store.roundPlayers(p.battle.round.id).length };
  }

  world(): World | null {
    return this.phase.kind === 'none' ? null : this.phase.battle.world;
  }

  hello(viewerPlayerId: number | null, now: number): HelloMessage | null {
    const p = this.phase;
    if (p.kind === 'none') return null;
    return p.battle.hello(this.playerMetas(now), viewerPlayerId, now);
  }

  broadcastPlayer(player: PlayerMeta): void {
    this.deps.channel.send({ type: 'player', player });
  }

  playerMeta(playerId: number, now: number): PlayerMeta | null {
    return this.playerMetas(now).find((m) => m.playerId === playerId) ?? null;
  }

  private playerMetas(now: number): PlayerMeta[] {
    const p = this.phase;
    if (p.kind === 'none') return [];
    return rosterMetas(this.deps.store, this.deps.armory, p.battle.round.id, now);
  }

  private startRound(now: number): void {
    const { store, armory } = this.deps;
    const today = isoDay(now);
    const players = store.enlistedPlayers();
    const muscles = new Map(players.map((pl) => [pl.id, armory.get(pl.id, today)]));
    const seed = this.deps.newSeed?.() ?? randomInt(1, 2 ** 31);
    const plan = formFactions(
      players.map((pl) => ({ playerId: pl.id, soldiers: soldiers(muscles.get(pl.id)!.army), language: muscles.get(pl.id)!.language })),
      factionCount(players.length),
      seed,
    );
    const fielded = fieldArmies(new Map([...muscles].map(([id, m]) => [id, m.army])));
    const totalFielded = [...fielded.values()].reduce((s, f) => s + soldiers(f), 0);
    const roster: Enrollment[] = plan.flatMap((f) =>
      f.members.map((playerId) => {
        const army = muscles.get(playerId)!.army;
        return { playerId, faction: f.id, muster: { ...fielded.get(playerId)!, rank: army.rank }, soldiers: soldiers(army) };
      }),
    );
    const battle = Battle.open(this.battleDeps, {
      round: {
        name: campaignName(store.campaignRoundCount() + 1, seed),
        seed,
        factionCount: plan.length,
        expectedUnits: Math.max(MIN_EXPECTED_UNITS, totalFielded),
        dominationTicks: CAMPAIGN_DOMINATION_TICKS,
        startsAt: now,
        endsAt: now + this.deps.config.roundMs,
        roomSlug: null,
      },
      factions: plan.map((f) => ({ faction: f.id, name: f.name, color: f.color, language: f.language })),
      roster,
    });
    this.phase = { kind: 'active', battle };
    const round = battle.round;
    this.deps.log.info('round started', { round: round.id, name: round.name, factions: plan.length, players: players.length });
    this.feed({ at: now, kind: 'round', playerId: null, faction: null, message: `${round.name} begins. ${plan.length} factions take the field.`, url: null, units: null });
    this.deps.channel.send({ type: 'round', round: battle.meta() });
    this.deps.channel.reset();
  }

  private finalize(battle: Battle): void {
    const { store } = this.deps;
    const round = battle.round;
    const applied = store.transaction(() => {
      if (!store.claimFinalize(round.id)) return false;
      store.addLifetime(
        store.roundPlayers(round.id).map((rp) => ({
          playerId: rp.playerId,
          roundsPlayed: 1,
          roundsWon: rp.faction === round.winnerFaction ? 1 : 0,
          kills: rp.kills,
          losses: rp.losses,
          captures: rp.captures,
          peakSoldiers: rp.peakSoldiers,
        })),
      );
      return true;
    });
    if (applied) this.deps.log.info('round finalized', { round: round.id });
    battle.markFinalized();
  }
}

function sameMuster(a: Muster | null, b: Muster): boolean {
  return a !== null && a.infantry === b.infantry && a.archers === b.archers && a.cavalry === b.cavalry && a.rank === b.rank;
}
