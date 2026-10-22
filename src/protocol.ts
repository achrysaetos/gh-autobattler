// Wire protocol between the authoritative server and spectator clients.
// Transport: one WebSocket at /ws carrying JSON messages, plus a few REST reads.

import type { TimedInput, WorldSnapshot } from './sim/api.ts';
import type { Army, Fielded, LifetimeStats, Medal } from './rules/types.ts';

export type RoundStatus = 'active' | 'ended';

export interface RoundMeta {
  id: number;
  name: string;
  status: RoundStatus;
  startsAt: number;
  endsAt: number;
  intermissionEndsAt: number | null;
  winnerFaction: number | null;
}

export interface FactionMeta {
  id: number;
  name: string;
  color: number;
  language: string | null;
}

export interface PlayerMeta {
  playerId: number;
  login: string;
  avatarUrl: string;
  faction: number;
  army: Army;
  fielded: Fielded;
  demo: boolean;
}

export interface FeedItem {
  id: number;
  at: number;
  kind: 'enlist' | 'reinforce' | 'capture' | 'round' | 'domination';
  playerId: number | null;
  faction: number | null;
  message: string;
  url: string | null;
  units: Fielded | null;
}

export type ServerMessage =
  | {
      type: 'hello';
      round: RoundMeta;
      factions: FactionMeta[];
      players: PlayerMeta[];
      snapshot: WorldSnapshot;
      inputs: TimedInput[];
      feed: FeedItem[];
      serverNow: number;
      roundStartMs: number;
      tickMs: number;
      viewerPlayerId: number | null;
    }
  | { type: 'inputs'; inputs: TimedInput[] }
  | { type: 'check'; tick: number; checksum: number }
  | { type: 'player'; player: PlayerMeta }
  | { type: 'feed'; item: FeedItem }
  | { type: 'round'; round: RoundMeta };

export type ClientMessage = { type: 'resync' };

export interface ProfileResponse {
  playerId: number;
  login: string;
  avatarUrl: string;
  stats: LifetimeStats;
  medals: Medal[];
  history: { roundId: number; roundName: string; faction: string; won: boolean; kills: number; captures: number }[];
}

export interface StandingsResponse {
  lifetime: { playerId: number; login: string; avatarUrl: string; stats: LifetimeStats }[];
}
