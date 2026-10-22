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
  roomSlug: string | null;
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

export const ROOM_MIN_FIGHTERS = 2;
export const ROOM_MAX_FIGHTERS = 8;

export interface CreateRoomRequest {
  logins: string[];
}

export type FighterRejection = 'not_found' | 'bot' | 'too_new' | 'no_public_activity' | 'duplicate';

export type CreateRoomResponse =
  | { ok: true; slug: string }
  | { ok: false; error: 'invalid_request' | 'rate_limited' | 'rooms_full' | 'github_unavailable'; message: string }
  | { ok: false; error: 'rejected_fighters'; rejected: { login: string; reason: FighterRejection }[] };

export interface RoomFighter {
  login: string;
  avatarUrl: string;
  faction: number;
  color: number;
  soldiers: number;
  score: number;
}

export interface RoomSummary {
  slug: string;
  name: string;
  status: RoundStatus;
  startsAt: number;
  endsAt: number;
  winnerLogin: string | null;
  fighters: RoomFighter[];
}

// The client treats any close code from 4000 to 4999 as final and does not reconnect.
export const WS_CLOSE_ROOM_NOT_FOUND = 4404;

export interface RoomsResponse {
  live: RoomSummary[];
  recent: RoomSummary[];
}
