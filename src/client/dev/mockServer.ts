import { NEUTRAL, TICK_MS, type SimInput, type TimedInput, type World } from '../../sim/api.ts';
import type { Army, DayLedger, Fielded, IsoDay, LifetimeStats, Medal } from '../../rules/types.ts';
import type { FactionMeta, FeedItem, PlayerMeta, ProfileResponse, RoundMeta, ServerMessage, StandingsResponse } from '../../protocol.ts';
import { sim } from '../simModule.ts';
import { objectiveName } from '../../rules/names.ts';
import type { Connect, TransportHandlers } from '../net/transport.ts';

export interface MockOptions {
  empty: boolean;
  ended: boolean;
  desync: boolean;
  viewer: boolean;
  players: number;
}

export function mockOptionsFromUrl(search: string): MockOptions | null {
  const q = new URLSearchParams(search);
  if (!q.has('mock')) return null;
  return {
    empty: q.has('empty'),
    ended: q.has('ended'),
    desync: q.has('desync'),
    viewer: q.has('viewer'),
    players: Number(q.get('players') ?? 44) || 44,
  };
}

const DAY_MS = 86_400_000;
const LATENCY_MS = 35;
const PRESIM_TICKS = 450;
const FIELD_CAP = 2400;

const LANGUAGES = ['TypeScript', 'Rust', 'Go', 'Python', 'Kotlin', 'Elixir', 'Swift', 'Haskell'];
const FACTION_SUFFIX = ['Vanguard', 'Legion', 'Wardens', 'Covenant', 'Host', 'Order', 'Company', 'Concord'];
const PALETTE = [0xd2483f, 0x3f88d6, 0xe2a634, 0x9160d4, 0x2fb39f, 0xe06aa8, 0xef7d3c, 0x8fbf4a];
const HANDLES = [
  'ada-lind', 'bramblecode', 'cormac', 'dvorak-j', 'emberfox', 'fjordline', 'gwen-ito', 'hollowtree', 'isadora-k', 'jun-park',
  'kestrel', 'lumen-dev', 'mirela', 'noor-a', 'oakhaven', 'pell', 'quillon', 'rook-and-pawn', 'sable', 'tamsin-r',
  'ulrike', 'vesper', 'wren-o', 'xiomara', 'yusuf-b', 'zephyrine', 'arlo-m', 'birchwood', 'calloway', 'dagny',
  'evander', 'faye-l', 'gideon-h', 'harrow', 'ines-v', 'jaspar', 'kaito', 'linnea', 'marek-s', 'nadia-q',
  'osric', 'priya-n', 'quentin', 'rasmus', 'saoirse', 'theo-w', 'una-m', 'viggo',
];
const ORGS = ['ironvale', 'northwind', 'emberworks', 'saltmarsh', 'lanternlabs', 'greyhaven', 'copperline', 'tidewater'];
const REPOS = ['forge', 'tide', 'ledger', 'compass', 'beacon', 'quarry', 'loom', 'atlas', 'harbor', 'kiln'];
const PR_TITLES = [
  'Fix race in connection pool',
  'Add streaming parser for large manifests',
  'Document retry semantics',
  'Cut cold start by 40%',
  'Handle empty config gracefully',
  'Port CLI to new arg parser',
  'Typed errors for the storage layer',
];

function mulberry(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isoDay(ms: number): IsoDay {
  return new Date(ms).toISOString().slice(0, 10) as IsoDay;
}

function infantryFor(commits: number): number {
  return commits <= 0 ? 0 : Math.min(4, 1 + Math.floor(Math.log2(commits)));
}

function tally(days: DayLedger[]): Army {
  let infantry = 0;
  let archers = 0;
  let cavalry = 0;
  let activeDays = 0;
  for (const d of days) {
    d.infantry = infantryFor(d.commits);
    d.archers = Math.min(3, d.reviews);
    d.cavalry = Math.min(3, d.mergedPrs);
    infantry += d.infantry;
    archers += d.archers;
    cavalry += d.cavalry;
    if (d.commits + d.reviews + d.mergedPrs > 0) activeDays++;
  }
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!;
    if (d.commits + d.reviews + d.mergedPrs === 0) {
      if (i === days.length - 1) continue;
      break;
    }
    streak++;
  }
  return { infantry, archers, cavalry, rank: Math.min(4, Math.floor(activeDays / 7)), activeDays, streak, days };
}

function avatarFor(login: string, color: number): string {
  const hex = `#${color.toString(16).padStart(6, '0')}`;
  const letter = login[0]!.toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hex}"/><stop offset="1" stop-color="#1a1f25"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><path d="M32 8 52 16v16c0 12-9 20-20 24C21 52 12 44 12 32V16z" fill="rgba(0,0,0,.28)" stroke="rgba(240,210,138,.55)" stroke-width="2"/><text x="32" y="41" font-family="Georgia,serif" font-size="22" text-anchor="middle" fill="#f3ead2">${letter}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

interface MockPlayer {
  meta: PlayerMeta;
  activity: number;
  repos: string[];
  lifetime: LifetimeStats;
  medals: Medal[];
}

const MEDALS: Medal[] = [
  { id: 'iron-streak', name: 'Iron Streak', description: 'Active on all 28 days of a tour.' },
  { id: 'kingmaker', name: 'Kingmaker', description: 'Served in a winning faction.' },
  { id: 'first-blood', name: 'First Blood', description: 'Drew the first kill of a round.' },
  { id: 'peer-accepted', name: 'Peer Accepted', description: 'Ten pull requests merged by others.' },
  { id: 'citadel-breaker', name: 'Citadel Breaker', description: 'Took part in capturing the Citadel.' },
];

function fieldedFor(army: Army, scale: number): Fielded {
  const f = (n: number) => (n === 0 ? 0 : Math.max(1, Math.round(n * scale)));
  return { infantry: f(army.infantry), archers: f(army.archers), cavalry: f(army.cavalry) };
}

class MockServer {
  private rand = mulberry(20261022);
  private players: MockPlayer[] = [];
  private factions: FactionMeta[] = [];
  private feed: FeedItem[] = [];
  private round!: RoundMeta;
  private world!: World;
  private roundStartMs = 0;
  private schedule = new Map<number, TimedInput[]>();
  private seq = 0;
  private feedId = 0;
  private clients = new Set<TransportHandlers>();
  private nextContributionAt = 0;
  private nextEnlistAt = 0;
  private desyncSent = false;
  private started = false;

  constructor(private opts: MockOptions) {}

  connect: Connect = (handlers) => {
    this.start();
    this.clients.add(handlers);
    setTimeout(() => this.deliver(handlers, this.hello()), LATENCY_MS * 4);
    return {
      send: (msg) => {
        if (msg.type === 'resync') setTimeout(() => this.deliver(handlers, this.hello()), LATENCY_MS * 3);
      },
      close: () => {
        this.clients.delete(handlers);
      },
    };
  };

  dropConnections(): void {
    const dropped = [...this.clients];
    this.clients.clear();
    for (const c of dropped) c.onClose();
  }

  standings(): StandingsResponse {
    const lifetime = this.players
      .map((p) => ({ playerId: p.meta.playerId, login: p.meta.login, avatarUrl: p.meta.avatarUrl, stats: this.liveStats(p) }))
      .sort((a, b) => b.stats.roundsWon - a.stats.roundsWon || b.stats.kills - a.stats.kills || a.playerId - b.playerId);
    return { lifetime };
  }

  profile(playerId: number): ProfileResponse | null {
    const p = this.players.find((x) => x.meta.playerId === playerId);
    if (!p) return null;
    const r = mulberry(playerId * 31);
    const history = Array.from({ length: Math.min(6, p.lifetime.roundsPlayed) }, (_, i) => ({
      roundId: this.round.id - 1 - i,
      roundName: `Round ${this.round.id - 1 - i}`,
      faction: `${LANGUAGES[Math.floor(r() * LANGUAGES.length)]} ${FACTION_SUFFIX[Math.floor(r() * FACTION_SUFFIX.length)]}`,
      won: r() < 0.3,
      kills: Math.floor(r() * 400),
      captures: Math.floor(r() * 12),
    }));
    return { playerId, login: p.meta.login, avatarUrl: p.meta.avatarUrl, stats: this.liveStats(p), medals: p.medals, history };
  }

  private liveStats(p: MockPlayer): LifetimeStats {
    const live = this.world.players.find((x) => x.playerId === p.meta.playerId);
    return {
      ...p.lifetime,
      kills: p.lifetime.kills + (live?.kills ?? 0),
      losses: p.lifetime.losses + (live?.losses ?? 0),
      captures: p.lifetime.captures + (live?.captures ?? 0),
    };
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    const now = Date.now();
    const count = this.opts.empty ? 0 : this.opts.players;
    const F = count === 0 ? 0 : Math.max(Math.min(count, 2), Math.min(8, Math.round(Math.sqrt(count))));
    for (let i = 0; i < F; i++) {
      this.factions.push({ id: i, name: `${LANGUAGES[i]} ${FACTION_SUFFIX[i]}`, color: PALETTE[i]!, language: LANGUAGES[i]! });
    }
    for (let i = 0; i < count; i++) this.players.push(this.makePlayer(i, now));
    this.rescaleFielded();

    const monday = now - (((new Date(now).getUTCDay() + 6) % 7) * DAY_MS + (now % DAY_MS));
    this.roundStartMs = now - PRESIM_TICKS * TICK_MS;
    this.round = {
      id: 12,
      roomSlug: null,
      name: 'Round XII · The Ember March',
      status: this.opts.ended ? 'ended' : 'active',
      startsAt: monday,
      endsAt: this.opts.ended ? now - 60_000 : monday + 7 * DAY_MS,
      intermissionEndsAt: this.opts.ended ? now + 47 * 60_000 : null,
      winnerFaction: null,
    };
    const expectedUnits = Math.max(200, this.players.reduce((s, p) => s + p.meta.fielded.infantry + p.meta.fielded.archers + p.meta.fielded.cavalry, 0));
    const params = { seed: 7331, factionCount: F, expectedUnits, dominationTicks: 216000 };
    this.world = sim.createWorld(params, sim.generateMap(params));
    for (const p of this.players) {
      this.scheduleInput(0, { kind: 'enlist', playerId: p.meta.playerId, faction: p.meta.faction });
      this.scheduleInput(0, this.musterFor(p));
    }
    this.advanceTo(PRESIM_TICKS, false);
    if (this.opts.ended) {
      const leader = [...this.world.factions].sort((a, b) => b.score - a.score)[0];
      this.round.winnerFaction = leader?.id ?? null;
    }
    this.seedFeed(now);
    this.nextContributionAt = now + 2500;
    this.nextEnlistAt = now + 45_000;
    setInterval(() => this.loop(), TICK_MS);
  }

  private makePlayer(i: number, now: number): MockPlayer {
    const id = 1000 + i * 7;
    const login = HANDLES[i % HANDLES.length]! + (i >= HANDLES.length ? `-${i}` : '');
    const activity = 0.4 + this.rand() * 0.6;
    const repos = Array.from({ length: 3 }, () => `${ORGS[Math.floor(this.rand() * ORGS.length)]}/${REPOS[Math.floor(this.rand() * REPOS.length)]}`);
    const days: DayLedger[] = [];
    for (let d = 27; d >= 0; d--) {
      const active = this.rand() < activity;
      const commits = active ? 1 + Math.floor(this.rand() * this.rand() * 14) : 0;
      const reviews = active && this.rand() < activity * 0.7 ? 1 + Math.floor(this.rand() * 3) : 0;
      const mergedPrs = active && this.rand() < activity * 0.45 ? 1 + Math.floor(this.rand() * 2) : 0;
      days.push({ day: isoDay(now - d * DAY_MS), commits, reviews, mergedPrs, infantry: 0, archers: 0, cavalry: 0 });
    }
    const army = tally(days);
    const faction = this.factions.length ? this.weakestFaction() : NEUTRAL;
    const color = this.factions[faction]?.color ?? 0x888888;
    const meta: PlayerMeta = {
      playerId: id,
      login,
      avatarUrl: avatarFor(login, color),
      faction,
      army,
      fielded: { infantry: army.infantry, archers: army.archers, cavalry: army.cavalry },
      demo: true,
    };
    const rounds = 1 + Math.floor(this.rand() * 11);
    const lifetime: LifetimeStats = {
      roundsPlayed: rounds,
      roundsWon: Math.floor(rounds * this.rand() * 0.4),
      kills: Math.floor(rounds * this.rand() * 300),
      losses: Math.floor(rounds * this.rand() * 280),
      captures: Math.floor(rounds * this.rand() * 9),
      peakSoldiers: army.infantry + army.archers + army.cavalry + Math.floor(this.rand() * 40),
    };
    const medals = MEDALS.filter((m, k) => (army.activeDays === 28 && m.id === 'iron-streak') || (k > 0 && this.rand() < 0.3));
    return { meta, activity, repos, lifetime, medals };
  }

  private weakestFaction(): number {
    const totals = this.factions.map((f) => ({ id: f.id, n: 0 }));
    for (const p of this.players) {
      const t = totals[p.meta.faction];
      if (t) t.n += p.meta.army.infantry + p.meta.army.archers + p.meta.army.cavalry;
    }
    totals.sort((a, b) => a.n - b.n || a.id - b.id);
    return totals[0]!.id;
  }

  private rescaleFielded(): void {
    const total = this.players.reduce((s, p) => s + p.meta.army.infantry + p.meta.army.archers + p.meta.army.cavalry, 0);
    const scale = total > FIELD_CAP ? FIELD_CAP / total : 1;
    for (const p of this.players) p.meta.fielded = fieldedFor(p.meta.army, scale);
  }

  private musterFor(p: MockPlayer): SimInput {
    return { kind: 'muster', playerId: p.meta.playerId, infantry: p.meta.fielded.infantry, archers: p.meta.fielded.archers, cavalry: p.meta.fielded.cavalry, rank: p.meta.army.rank };
  }

  private scheduleInput(tick: number, input: SimInput): TimedInput {
    const timed = { tick, seq: this.seq++, input };
    const list = this.schedule.get(tick) ?? [];
    list.push(timed);
    this.schedule.set(tick, list);
    return timed;
  }

  private advanceTo(tick: number, live: boolean): void {
    while (this.world.tick < tick) {
      const due = this.schedule.get(this.world.tick) ?? [];
      this.schedule.delete(this.world.tick);
      const events = sim.step(this.world, due.map((t) => t.input));
      for (const c of events.captures) {
        const def = this.world.map.objectives[c.objectiveId]!;
        const taker = this.factions[c.faction];
        const loser = this.factions[c.previous];
        const where = objectiveName(def);
        const msg = loser ? `${taker?.name} took ${where} from the ${loser.name}` : `${taker?.name} broke the garrison at ${where}`;
        this.pushFeed({ kind: 'capture', playerId: c.playerIds[0] ?? null, faction: c.faction, message: msg, url: null, units: null }, live);
      }
      if (live && this.world.tick % 50 === 0) {
        let checksum = sim.checksum(this.world);
        if (this.opts.desync && !this.desyncSent && this.world.tick > PRESIM_TICKS + 80) {
          this.desyncSent = true;
          checksum ^= 0x5f;
        }
        this.broadcast({ type: 'check', tick: this.world.tick, checksum });
      }
    }
  }

  private loop(): void {
    const now = Date.now();
    this.advanceTo(Math.floor((now - this.roundStartMs) / TICK_MS), true);
    if (this.players.length === 0 || this.round.status === 'ended') return;
    if (now >= this.nextContributionAt) {
      this.nextContributionAt = now + 2200 + this.rand() * 4200;
      this.contribute(now);
    }
    if (now >= this.nextEnlistAt && this.players.length < 48) {
      this.nextEnlistAt = now + 40_000 + this.rand() * 40_000;
      this.enlist(now);
    }
  }

  private contribute(now: number): void {
    const p = this.players[Math.floor(this.rand() * this.players.length)]!;
    const today = p.meta.army.days[p.meta.army.days.length - 1]!;
    const before = { ...p.meta.fielded };
    const repo = p.repos[Math.floor(this.rand() * p.repos.length)]!;
    const roll = this.rand();
    let detail: string;
    let url: string;
    if (roll < 0.6) {
      const n = 1 + Math.floor(this.rand() * 6);
      today.commits += n;
      detail = `${n} commit${n === 1 ? '' : 's'} to ${repo}`;
      url = `https://github.com/${repo}/commits?author=${p.meta.login}`;
    } else if (roll < 0.82) {
      const pr = 100 + Math.floor(this.rand() * 900);
      today.reviews += 1;
      detail = `reviewed ${repo}#${pr}`;
      url = `https://github.com/${repo}/pull/${pr}`;
    } else {
      const pr = 100 + Math.floor(this.rand() * 900);
      today.mergedPrs += 1;
      detail = `merged ${repo}#${pr} “${PR_TITLES[Math.floor(this.rand() * PR_TITLES.length)]}”`;
      url = `https://github.com/${repo}/pull/${pr}`;
    }
    p.meta.army = tally(p.meta.army.days);
    this.rescaleFielded();
    const gained: Fielded = {
      infantry: Math.max(0, p.meta.fielded.infantry - before.infantry),
      archers: Math.max(0, p.meta.fielded.archers - before.archers),
      cavalry: Math.max(0, p.meta.fielded.cavalry - before.cavalry),
    };
    const parts = [
      gained.infantry && `+${gained.infantry} infantry`,
      gained.archers && `+${gained.archers} archer${gained.archers === 1 ? '' : 's'}`,
      gained.cavalry && `+${gained.cavalry} cavalry`,
    ].filter(Boolean);
    const timed = this.scheduleInput(this.world.tick + 10, this.musterFor(p));
    this.broadcast({ type: 'inputs', inputs: [timed] });
    this.broadcast({ type: 'player', player: p.meta });
    const message = parts.length ? `@${p.meta.login} ${parts.join(', ')} · ${detail}` : `@${p.meta.login} ${detail} · daily cap reached`;
    this.pushFeed({ kind: 'reinforce', playerId: p.meta.playerId, faction: p.meta.faction, message, url, units: gained }, true, now);
  }

  private enlist(now: number): void {
    const p = this.makePlayer(this.players.length, now);
    this.players.push(p);
    this.rescaleFielded();
    const tick = this.world.tick + 10;
    const inputs = [this.scheduleInput(tick, { kind: 'enlist', playerId: p.meta.playerId, faction: p.meta.faction }), this.scheduleInput(tick, this.musterFor(p))];
    this.broadcast({ type: 'inputs', inputs });
    this.broadcast({ type: 'player', player: p.meta });
    const f = this.factions[p.meta.faction];
    this.pushFeed(
      { kind: 'enlist', playerId: p.meta.playerId, faction: p.meta.faction, message: `@${p.meta.login} enlisted with the ${f?.name} · ${p.meta.army.infantry + p.meta.army.archers + p.meta.army.cavalry} soldiers`, url: `https://github.com/${p.meta.login}`, units: p.meta.fielded },
      true,
      now,
    );
  }

  private seedFeed(now: number): void {
    const lines: Omit<FeedItem, 'id' | 'at'>[] = [{ kind: 'round', playerId: null, faction: null, message: `${this.round.name} has begun. Factions formed from ${this.players.length} enlisted players.`, url: null, units: null }];
    for (let i = 0; i < 10 && this.players.length; i++) {
      const p = this.players[Math.floor(this.rand() * this.players.length)]!;
      const repo = p.repos[0]!;
      const n = 2 + Math.floor(this.rand() * 6);
      lines.push({ kind: 'reinforce', playerId: p.meta.playerId, faction: p.meta.faction, message: `@${p.meta.login} +${infantryFor(n)} infantry · ${n} commits to ${repo}`, url: `https://github.com/${repo}`, units: { infantry: infantryFor(n), archers: 0, cavalry: 0 } });
    }
    lines.forEach((l, i) => this.pushFeed(l, false, now - (lines.length - i) * 37_000));
    if (this.opts.ended && this.round.winnerFaction !== null) {
      this.pushFeed({ kind: 'round', playerId: null, faction: this.round.winnerFaction, message: `${this.factions[this.round.winnerFaction]?.name} won ${this.round.name}.`, url: null, units: null }, false, now);
    }
  }

  private pushFeed(item: Omit<FeedItem, 'id' | 'at'>, live: boolean, at = Date.now()): void {
    const full: FeedItem = { ...item, id: ++this.feedId, at };
    this.feed.push(full);
    if (this.feed.length > 80) this.feed.shift();
    if (live) this.broadcast({ type: 'feed', item: full });
  }

  private hello(): ServerMessage {
    const pending: TimedInput[] = [];
    for (const [tick, list] of this.schedule) if (tick >= this.world.tick) pending.push(...list);
    pending.sort((a, b) => a.tick - b.tick || a.seq - b.seq);
    const viewer = this.opts.viewer ? (this.players[3]?.meta.playerId ?? null) : null;
    return {
      type: 'hello',
      round: this.round,
      factions: this.factions,
      players: this.players.map((p) => p.meta),
      snapshot: sim.snapshot(this.world),
      inputs: pending,
      feed: this.feed.slice(-40),
      serverNow: Date.now(),
      roundStartMs: this.roundStartMs,
      tickMs: TICK_MS,
      viewerPlayerId: viewer,
    };
  }

  private broadcast(msg: ServerMessage): void {
    for (const c of this.clients) this.deliver(c, msg);
  }

  private deliver(handlers: TransportHandlers, msg: ServerMessage): void {
    const wire = JSON.stringify(msg);
    setTimeout(() => {
      if (this.clients.has(handlers)) handlers.onMessage(JSON.parse(wire) as ServerMessage);
    }, LATENCY_MS);
  }
}

let instance: MockServer | null = null;

export function mockServer(opts: MockOptions): MockServer {
  return (instance ??= new MockServer(opts));
}

export type { MockServer };
