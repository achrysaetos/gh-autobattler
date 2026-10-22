import type { Contribution } from '../../rules/types.ts';
import { GithubError, type GithubClient, type LookupResult, type RateLimit } from '../github.ts';

export interface FakeUser {
  id: number;
  login: string;
  type?: string;
  createdAtMs?: number;
  contributions: Contribution[];
}

export interface FakeGithub extends GithubClient {
  calls: string[];
  down: boolean;
}

const RATE: RateLimit = { limit: 5000, remaining: 4999, resetAtMs: 0, cost: 1 };

export function createFakeGithub(users: readonly FakeUser[]): FakeGithub {
  const found = (u: FakeUser | undefined): LookupResult =>
    u
      ? {
          account: { databaseId: u.id, nodeId: `U_${u.id}`, login: u.login, avatarUrl: `https://avatars.example/${u.id}`, createdAtMs: u.createdAtMs ?? 0, type: u.type ?? 'User' },
          contributions: u.contributions.map((c) => ({ ...c })),
          rateLimit: RATE,
        }
      : { notFound: true, rateLimit: RATE };
  const fake: FakeGithub = {
    calls: [],
    down: false,
    async fetchContributions(nodeId) {
      fake.calls.push(nodeId);
      if (fake.down) throw new GithubError('GitHub GraphQL 502', 502);
      return found(users.find((u) => `U_${u.id}` === nodeId));
    },
    async fetchContributionsByLogin(login) {
      fake.calls.push(login);
      if (fake.down) throw new GithubError('GitHub GraphQL 502', 502);
      return found(users.find((u) => u.login.toLowerCase() === login.toLowerCase()));
    },
  };
  return fake;
}
