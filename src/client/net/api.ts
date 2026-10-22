import type { CreateRoomResponse, ProfileResponse, RoomsResponse, StandingsResponse } from '../../protocol.ts';

export interface Api {
  standings(): Promise<StandingsResponse>;
  profile(playerId: number): Promise<ProfileResponse | null>;
  rooms(): Promise<RoomsResponse>;
  createRoom(logins: string[]): Promise<CreateRoomResponse>;
}

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return (await res.json()) as T;
}

const UNREACHABLE: CreateRoomResponse = { ok: false, error: 'internal_error', message: 'The war office did not answer. Try again in a moment.' };

export const httpApi: Api = {
  async standings() {
    return (await getJson<StandingsResponse>('/api/standings')) ?? { lifetime: [] };
  },
  profile(playerId) {
    return getJson<ProfileResponse>(`/api/players/${playerId}`);
  },
  async rooms() {
    return (await getJson<RoomsResponse>('/api/rooms')) ?? { live: [], recent: [] };
  },
  async createRoom(logins) {
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ logins }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (typeof body === 'object' && body !== null && 'ok' in body) return body as CreateRoomResponse;
      if (res.status === 429) return { ok: false, error: 'rate_limited', message: 'Too many battles started from here. Wait a minute and try again.' };
      return UNREACHABLE;
    } catch {
      return UNREACHABLE;
    }
  },
};

export interface MockApiSource {
  standings(): StandingsResponse;
  profile(playerId: number): ProfileResponse | null;
  rooms(): RoomsResponse;
  createRoom(logins: string[]): CreateRoomResponse;
}

export function mockApi(source: MockApiSource): Api {
  const later = <T,>(value: T, ms = 180) => new Promise<T>((resolve) => setTimeout(() => resolve(structuredClone(value)), ms));
  return {
    standings: () => later(source.standings()),
    profile: (id) => later(source.profile(id)),
    rooms: () => later(source.rooms()),
    createRoom: (logins) => later(source.createRoom(logins), 650),
  };
}
