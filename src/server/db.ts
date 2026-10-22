import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FeedItem, RoundStatus } from '../protocol.ts';
import type { Contribution, ContributionKind, Fielded, IsoDay, LifetimeStats } from '../rules/types.ts';
import type { SimInput, TimedInput } from '../sim/api.ts';

export type Db = Database.Database;

export const SNAPSHOTS_KEPT = 3;

export interface Muster extends Fielded {
  rank: number;
}

export interface PlayerRow {
  id: number;
  nodeId: string;
  login: string;
  avatarUrl: string;
  createdAtGithub: number;
  enlistedAt: number;
  demo: boolean;
  lastPolledAt: number | null;
  pollError: string | null;
}

export interface RoundRow {
  id: number;
  name: string;
  status: RoundStatus;
  seed: number;
  factionCount: number;
  expectedUnits: number;
  startsAt: number;
  endsAt: number;
  intermissionEndsAt: number | null;
  winnerFaction: number | null;
  finalized: boolean;
}

export interface RoundFactionRow {
  faction: number;
  name: string;
  color: number;
  language: string | null;
}

export interface RoundPlayerRow {
  playerId: number;
  faction: number;
  lastFielded: Muster | null;
  kills: number;
  losses: number;
  captures: number;
  peakSoldiers: number;
}

export interface CombatStats {
  playerId: number;
  kills: number;
  losses: number;
  captures: number;
}

export interface ContributionDelta {
  contribution: Contribution;
  added: number;
}

export interface HistoryRow {
  roundId: number;
  roundName: string;
  faction: string;
  won: boolean;
  kills: number;
  captures: number;
}

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE players (
    id INTEGER PRIMARY KEY,
    node_id TEXT NOT NULL UNIQUE,
    login TEXT NOT NULL,
    avatar_url TEXT NOT NULL,
    created_at_github INTEGER NOT NULL,
    enlisted_at INTEGER NOT NULL,
    demo INTEGER NOT NULL DEFAULT 0,
    last_polled_at INTEGER,
    poll_error TEXT
  );
  CREATE TABLE contributions (
    player_id INTEGER NOT NULL REFERENCES players(id),
    source_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL,
    repo TEXT NOT NULL,
    url TEXT,
    title TEXT,
    language TEXT,
    first_seen_at INTEGER NOT NULL,
    PRIMARY KEY (player_id, source_id)
  );
  CREATE TABLE rounds (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    seed INTEGER NOT NULL,
    faction_count INTEGER NOT NULL,
    expected_units INTEGER NOT NULL,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    intermission_ends_at INTEGER,
    winner_faction INTEGER,
    finalized INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE round_factions (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    faction INTEGER NOT NULL,
    name TEXT NOT NULL,
    color INTEGER NOT NULL,
    language TEXT,
    PRIMARY KEY (round_id, faction)
  );
  CREATE TABLE round_players (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    player_id INTEGER NOT NULL REFERENCES players(id),
    faction INTEGER NOT NULL,
    last_fielded_json TEXT,
    kills INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    captures INTEGER NOT NULL DEFAULT 0,
    peak_soldiers INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (round_id, player_id)
  );
  CREATE TABLE round_inputs (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    tick INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    json TEXT NOT NULL,
    PRIMARY KEY (round_id, seq)
  );
  CREATE INDEX round_inputs_tick ON round_inputs (round_id, tick);
  CREATE TABLE round_snapshots (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    tick INTEGER NOT NULL,
    json TEXT NOT NULL,
    checksum INTEGER NOT NULL,
    PRIMARY KEY (round_id, tick)
  );
  CREATE TABLE feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    player_id INTEGER,
    faction INTEGER,
    message TEXT NOT NULL,
    url TEXT,
    units_json TEXT
  );
  CREATE TABLE lifetime (
    player_id INTEGER PRIMARY KEY REFERENCES players(id),
    rounds_played INTEGER NOT NULL DEFAULT 0,
    rounds_won INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    captures INTEGER NOT NULL DEFAULT 0,
    peak_soldiers INTEGER NOT NULL DEFAULT 0
  );
  `,
];

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

interface RawPlayer {
  id: number;
  node_id: string;
  login: string;
  avatar_url: string;
  created_at_github: number;
  enlisted_at: number;
  demo: number;
  last_polled_at: number | null;
  poll_error: string | null;
}

interface RawRound {
  id: number;
  name: string;
  status: RoundStatus;
  seed: number;
  faction_count: number;
  expected_units: number;
  starts_at: number;
  ends_at: number;
  intermission_ends_at: number | null;
  winner_faction: number | null;
  finalized: number;
}

interface RawContribution {
  source_id: string;
  kind: ContributionKind;
  day: string;
  count: number;
  repo: string;
  url: string | null;
  title: string | null;
  language: string | null;
}

interface RawFeed {
  id: number;
  at: number;
  kind: FeedItem['kind'];
  player_id: number | null;
  faction: number | null;
  message: string;
  url: string | null;
  units_json: string | null;
}

const toPlayer = (r: RawPlayer): PlayerRow => ({
  id: r.id,
  nodeId: r.node_id,
  login: r.login,
  avatarUrl: r.avatar_url,
  createdAtGithub: r.created_at_github,
  enlistedAt: r.enlisted_at,
  demo: r.demo === 1,
  lastPolledAt: r.last_polled_at,
  pollError: r.poll_error,
});

const toRound = (r: RawRound): RoundRow => ({
  id: r.id,
  name: r.name,
  status: r.status,
  seed: r.seed,
  factionCount: r.faction_count,
  expectedUnits: r.expected_units,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  intermissionEndsAt: r.intermission_ends_at,
  winnerFaction: r.winner_faction,
  finalized: r.finalized === 1,
});

const toContribution = (r: RawContribution): Contribution => ({
  sourceId: r.source_id,
  kind: r.kind,
  day: r.day as IsoDay,
  count: r.count,
  repo: r.repo,
  url: r.url,
  title: r.title,
  language: r.language,
});

const toFeed = (r: RawFeed): FeedItem => ({
  id: r.id,
  at: r.at,
  kind: r.kind,
  playerId: r.player_id,
  faction: r.faction,
  message: r.message,
  url: r.url,
  units: r.units_json === null ? null : (JSON.parse(r.units_json) as Fielded),
});

export type NewRound = Omit<RoundRow, 'id' | 'status' | 'intermissionEndsAt' | 'winnerFaction' | 'finalized'>;
export type NewFeed = Omit<FeedItem, 'id'> & { roundId: number | null };

export class Store {
  constructor(readonly db: Db) {}

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  upsertPlayer(p: Omit<PlayerRow, 'lastPolledAt' | 'pollError'>): void {
    this.db
      .prepare(
        `INSERT INTO players (id, node_id, login, avatar_url, created_at_github, enlisted_at, demo)
         VALUES (@id, @nodeId, @login, @avatarUrl, @createdAtGithub, @enlistedAt, @demo)
         ON CONFLICT(id) DO UPDATE SET login = excluded.login, avatar_url = excluded.avatar_url, node_id = excluded.node_id`,
      )
      .run({ ...p, demo: p.demo ? 1 : 0 });
  }

  refreshIdentity(id: number, login: string, avatarUrl: string): void {
    this.db.prepare('UPDATE players SET login = ?, avatar_url = ? WHERE id = ?').run(login, avatarUrl, id);
  }

  player(id: number): PlayerRow | null {
    const r = this.db.prepare('SELECT * FROM players WHERE id = ?').get(id) as RawPlayer | undefined;
    return r ? toPlayer(r) : null;
  }

  players(): PlayerRow[] {
    return (this.db.prepare('SELECT * FROM players ORDER BY id').all() as RawPlayer[]).map(toPlayer);
  }

  markPolled(id: number, at: number, error: string | null): void {
    this.db.prepare('UPDATE players SET last_polled_at = ?, poll_error = ? WHERE id = ?').run(at, error, id);
  }

  markPollError(id: number, error: string): void {
    this.db.prepare('UPDATE players SET poll_error = ? WHERE id = ?').run(error, id);
  }

  contributions(playerId: number): Contribution[] {
    return (
      this.db.prepare('SELECT * FROM contributions WHERE player_id = ? ORDER BY source_id').all(playerId) as RawContribution[]
    ).map(toContribution);
  }

  contribution(playerId: number, sourceId: string): Contribution | null {
    const r = this.db
      .prepare('SELECT * FROM contributions WHERE player_id = ? AND source_id = ?')
      .get(playerId, sourceId) as RawContribution | undefined;
    return r ? toContribution(r) : null;
  }

  upsertContributions(playerId: number, contributions: readonly Contribution[], now: number): ContributionDelta[] {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO contributions (player_id, source_id, kind, day, count, repo, url, title, language, first_seen_at)
       VALUES (@playerId, @sourceId, @kind, @day, @count, @repo, @url, @title, @language, @now)`,
    );
    const select = this.db.prepare('SELECT count FROM contributions WHERE player_id = ? AND source_id = ?');
    const grow = this.db.prepare(
      'UPDATE contributions SET count = ?, url = ?, title = ?, language = ? WHERE player_id = ? AND source_id = ?',
    );
    const deltas: ContributionDelta[] = [];
    for (const c of contributions) {
      if (insert.run({ ...c, playerId, now }).changes === 1) {
        deltas.push({ contribution: c, added: c.count });
        continue;
      }
      const { count } = select.get(playerId, c.sourceId) as { count: number };
      if (c.count > count) {
        grow.run(c.count, c.url, c.title, c.language, playerId, c.sourceId);
        deltas.push({ contribution: c, added: c.count - count });
      }
    }
    return deltas;
  }

  latestRound(): RoundRow | null {
    const r = this.db.prepare('SELECT * FROM rounds ORDER BY id DESC LIMIT 1').get() as RawRound | undefined;
    return r ? toRound(r) : null;
  }

  round(id: number): RoundRow | null {
    const r = this.db.prepare('SELECT * FROM rounds WHERE id = ?').get(id) as RawRound | undefined;
    return r ? toRound(r) : null;
  }

  insertRound(r: NewRound & { id: number }): void {
    this.db
      .prepare(
        `INSERT INTO rounds (id, name, status, seed, faction_count, expected_units, starts_at, ends_at)
         VALUES (@id, @name, 'active', @seed, @factionCount, @expectedUnits, @startsAt, @endsAt)`,
      )
      .run(r);
  }

  endRound(id: number, winnerFaction: number | null, intermissionEndsAt: number): boolean {
    return (
      this.db
        .prepare(
          `UPDATE rounds SET status = 'ended', winner_faction = ?, intermission_ends_at = ? WHERE id = ? AND status = 'active'`,
        )
        .run(winnerFaction, intermissionEndsAt, id).changes === 1
    );
  }

  claimFinalize(id: number): boolean {
    return this.db.prepare(`UPDATE rounds SET finalized = 1 WHERE id = ? AND status = 'ended' AND finalized = 0`).run(id).changes === 1;
  }

  insertFactions(roundId: number, factions: readonly RoundFactionRow[]): void {
    const stmt = this.db.prepare(
      'INSERT INTO round_factions (round_id, faction, name, color, language) VALUES (?, ?, ?, ?, ?)',
    );
    for (const f of factions) stmt.run(roundId, f.faction, f.name, f.color, f.language);
  }

  factions(roundId: number): RoundFactionRow[] {
    return this.db
      .prepare('SELECT faction, name, color, language FROM round_factions WHERE round_id = ? ORDER BY faction')
      .all(roundId) as RoundFactionRow[];
  }

  insertRoundPlayer(roundId: number, playerId: number, faction: number): boolean {
    return (
      this.db
        .prepare('INSERT OR IGNORE INTO round_players (round_id, player_id, faction) VALUES (?, ?, ?)')
        .run(roundId, playerId, faction).changes === 1
    );
  }

  roundPlayers(roundId: number): RoundPlayerRow[] {
    const rows = this.db
      .prepare(
        `SELECT player_id, faction, last_fielded_json, kills, losses, captures, peak_soldiers
         FROM round_players WHERE round_id = ? ORDER BY player_id`,
      )
      .all(roundId) as {
      player_id: number;
      faction: number;
      last_fielded_json: string | null;
      kills: number;
      losses: number;
      captures: number;
      peak_soldiers: number;
    }[];
    return rows.map((r) => ({
      playerId: r.player_id,
      faction: r.faction,
      lastFielded: r.last_fielded_json === null ? null : (JSON.parse(r.last_fielded_json) as Muster),
      kills: r.kills,
      losses: r.losses,
      captures: r.captures,
      peakSoldiers: r.peak_soldiers,
    }));
  }

  setLastFielded(roundId: number, playerId: number, muster: Muster, soldiers: number): void {
    this.db
      .prepare(
        `UPDATE round_players SET last_fielded_json = ?, peak_soldiers = MAX(peak_soldiers, ?)
         WHERE round_id = ? AND player_id = ?`,
      )
      .run(JSON.stringify(muster), soldiers, roundId, playerId);
  }

  flushCombat(roundId: number, stats: readonly CombatStats[]): void {
    const stmt = this.db.prepare(
      'UPDATE round_players SET kills = ?, losses = ?, captures = ? WHERE round_id = ? AND player_id = ?',
    );
    for (const s of stats) stmt.run(s.kills, s.losses, s.captures, roundId, s.playerId);
  }

  appendInputs(roundId: number, inputs: readonly TimedInput[]): void {
    const stmt = this.db.prepare('INSERT INTO round_inputs (round_id, tick, seq, json) VALUES (?, ?, ?, ?)');
    for (const i of inputs) stmt.run(roundId, i.tick, i.seq, JSON.stringify(i.input));
  }

  inputsFrom(roundId: number, fromTick: number): TimedInput[] {
    const rows = this.db
      .prepare('SELECT tick, seq, json FROM round_inputs WHERE round_id = ? AND tick >= ? ORDER BY tick, seq')
      .all(roundId, fromTick) as { tick: number; seq: number; json: string }[];
    return rows.map((r) => ({ tick: r.tick, seq: r.seq, input: JSON.parse(r.json) as SimInput }));
  }

  maxSeq(roundId: number): number {
    const r = this.db.prepare('SELECT MAX(seq) AS seq FROM round_inputs WHERE round_id = ?').get(roundId) as { seq: number | null };
    return r.seq ?? 0;
  }

  saveSnapshot(roundId: number, tick: number, json: string, checksum: number): void {
    this.transaction(() => {
      this.db
        .prepare('INSERT OR REPLACE INTO round_snapshots (round_id, tick, json, checksum) VALUES (?, ?, ?, ?)')
        .run(roundId, tick, json, checksum);
      this.db
        .prepare(
          `DELETE FROM round_snapshots WHERE round_id = ? AND tick NOT IN
           (SELECT tick FROM round_snapshots WHERE round_id = ? ORDER BY tick DESC LIMIT ${SNAPSHOTS_KEPT})`,
        )
        .run(roundId, roundId);
    });
  }

  latestSnapshot(roundId: number): { tick: number; json: string; checksum: number } | null {
    const r = this.db
      .prepare('SELECT tick, json, checksum FROM round_snapshots WHERE round_id = ? ORDER BY tick DESC LIMIT 1')
      .get(roundId) as { tick: number; json: string; checksum: number } | undefined;
    return r ?? null;
  }

  snapshotCount(roundId: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM round_snapshots WHERE round_id = ?').get(roundId) as { n: number }).n;
  }

  addFeed(item: NewFeed): FeedItem {
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO feed (round_id, at, kind, player_id, faction, message, url, units_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(item.roundId, item.at, item.kind, item.playerId, item.faction, item.message, item.url, item.units === null ? null : JSON.stringify(item.units));
    const { roundId: _, ...rest } = item;
    return { id: Number(lastInsertRowid), ...rest };
  }

  lastFeedAt(roundId: number, kinds: readonly FeedItem['kind'][]): number {
    const r = this.db
      .prepare(`SELECT MAX(at) AS at FROM feed WHERE round_id = ? AND kind IN (${kinds.map(() => '?').join(',')})`)
      .get(roundId, ...kinds) as { at: number | null };
    return r.at ?? Number.NEGATIVE_INFINITY;
  }

  recentFeed(limit: number): FeedItem[] {
    const rows = this.db.prepare('SELECT * FROM feed ORDER BY id DESC LIMIT ?').all(limit) as RawFeed[];
    return rows.map(toFeed).reverse();
  }

  addLifetime(rows: readonly (LifetimeStats & { playerId: number })[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO lifetime (player_id, rounds_played, rounds_won, kills, losses, captures, peak_soldiers)
       VALUES (@playerId, @roundsPlayed, @roundsWon, @kills, @losses, @captures, @peakSoldiers)
       ON CONFLICT(player_id) DO UPDATE SET
         rounds_played = rounds_played + excluded.rounds_played,
         rounds_won = rounds_won + excluded.rounds_won,
         kills = kills + excluded.kills,
         losses = losses + excluded.losses,
         captures = captures + excluded.captures,
         peak_soldiers = MAX(peak_soldiers, excluded.peak_soldiers)`,
    );
    for (const r of rows) stmt.run(r);
  }

  lifetime(playerId: number): LifetimeStats {
    const r = this.db
      .prepare(
        `SELECT rounds_played AS roundsPlayed, rounds_won AS roundsWon, kills, losses, captures, peak_soldiers AS peakSoldiers
         FROM lifetime WHERE player_id = ?`,
      )
      .get(playerId) as LifetimeStats | undefined;
    return r ?? { roundsPlayed: 0, roundsWon: 0, kills: 0, losses: 0, captures: 0, peakSoldiers: 0 };
  }

  standings(limit: number): { playerId: number; login: string; avatarUrl: string; stats: LifetimeStats }[] {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.login, p.avatar_url, l.rounds_played, l.rounds_won, l.kills, l.losses, l.captures, l.peak_soldiers
         FROM lifetime l JOIN players p ON p.id = l.player_id
         ORDER BY l.rounds_won DESC, l.kills DESC, l.captures DESC, p.id ASC LIMIT ?`,
      )
      .all(limit) as {
      id: number;
      login: string;
      avatar_url: string;
      rounds_played: number;
      rounds_won: number;
      kills: number;
      losses: number;
      captures: number;
      peak_soldiers: number;
    }[];
    return rows.map((r) => ({
      playerId: r.id,
      login: r.login,
      avatarUrl: r.avatar_url,
      stats: {
        roundsPlayed: r.rounds_played,
        roundsWon: r.rounds_won,
        kills: r.kills,
        losses: r.losses,
        captures: r.captures,
        peakSoldiers: r.peak_soldiers,
      },
    }));
  }

  history(playerId: number): HistoryRow[] {
    const rows = this.db
      .prepare(
        `SELECT r.id, r.name, f.name AS faction_name, rp.faction, r.winner_faction, rp.kills, rp.captures
         FROM round_players rp
         JOIN rounds r ON r.id = rp.round_id
         LEFT JOIN round_factions f ON f.round_id = rp.round_id AND f.faction = rp.faction
         WHERE rp.player_id = ? AND r.finalized = 1
         ORDER BY r.id DESC`,
      )
      .all(playerId) as {
      id: number;
      name: string;
      faction_name: string | null;
      faction: number;
      winner_faction: number | null;
      kills: number;
      captures: number;
    }[];
    return rows.map((r) => ({
      roundId: r.id,
      roundName: r.name,
      faction: r.faction_name ?? `Faction ${r.faction + 1}`,
      won: r.winner_faction === r.faction,
      kills: r.kills,
      captures: r.captures,
    }));
  }
}
