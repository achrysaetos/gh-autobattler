import type { ProfileResponse, StandingsResponse } from '../../protocol.ts';
import type { MockServer } from '../dev/mockServer.ts';

export interface Api {
  standings(): Promise<StandingsResponse>;
  profile(playerId: number): Promise<ProfileResponse | null>;
}

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return (await res.json()) as T;
}

export const httpApi: Api = {
  async standings() {
    return (await getJson<StandingsResponse>('/api/standings')) ?? { lifetime: [] };
  },
  profile(playerId) {
    return getJson<ProfileResponse>(`/api/players/${playerId}`);
  },
};

export function mockApi(server: MockServer): Api {
  const later = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(structuredClone(value)), 180));
  return {
    standings: () => later(server.standings()),
    profile: (id) => later(server.profile(id)),
  };
}
