import { z } from 'zod';
import { DAY_MS, isoDay } from '../rules/days.ts';
import type { Contribution } from '../rules/types.ts';

export const CONTRIBUTION_LOOKBACK_DAYS = 56;
const GRAPHQL_URL = 'https://api.github.com/graphql';
const USER_AGENT = 'pushfront';

export interface GithubAccount {
  databaseId: number;
  nodeId: string;
  login: string;
  avatarUrl: string;
  createdAtMs: number;
  type: string;
}

export interface RateLimit {
  limit: number;
  remaining: number;
  resetAtMs: number;
  cost: number;
}

export interface ContributionsResult {
  account: GithubAccount;
  contributions: Contribution[];
  rateLimit: RateLimit;
}

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

const CONTRIBUTIONS_QUERY = `
query Pushfront($id: ID!, $from: DateTime!, $to: DateTime!) {
  node(id: $id) {
    __typename
    ... on Bot { login }
    ... on User {
      id databaseId login avatarUrl createdAt
      contributionsCollection(from: $from, to: $to) {
        commitContributionsByRepository(maxRepositories: 100) {
          repository { nameWithOwner isPrivate owner { login } primaryLanguage { name } url }
          contributions(first: 100) { nodes { occurredAt commitCount } }
        }
        pullRequestContributions(first: 100) {
          nodes { pullRequest {
            id url title merged mergedAt mergedBy { login } author { login }
            repository { nameWithOwner isPrivate owner { login } primaryLanguage { name } }
          } }
        }
        pullRequestReviewContributions(first: 100) {
          nodes {
            occurredAt
            pullRequestReview { id url }
            pullRequest { title author { login } repository { nameWithOwner isPrivate primaryLanguage { name } } }
          }
        }
      }
    }
  }
  rateLimit { limit remaining resetAt cost }
}`;

const LOGIN_QUERY = `query PushfrontLogin($login: String!) { user(login: $login) { id } }`;

const login = z.object({ login: z.string() });
const language = z.object({ name: z.string() }).nullable();

const RateLimitSchema = z.object({ limit: z.number(), remaining: z.number(), resetAt: z.string(), cost: z.number() });

const UserSchema = z.object({
  __typename: z.literal('User'),
  id: z.string(),
  databaseId: z.number().int(),
  login: z.string(),
  avatarUrl: z.string(),
  createdAt: z.string(),
  contributionsCollection: z.object({
    commitContributionsByRepository: z.array(
      z.object({
        repository: z.object({
          nameWithOwner: z.string(),
          isPrivate: z.boolean(),
          owner: login,
          primaryLanguage: language,
          url: z.string(),
        }),
        contributions: z.object({
          nodes: z.array(z.object({ occurredAt: z.string(), commitCount: z.number().int() }).nullable()),
        }),
      }),
    ),
    pullRequestContributions: z.object({
      nodes: z.array(
        z
          .object({
            pullRequest: z.object({
              id: z.string(),
              url: z.string(),
              title: z.string(),
              merged: z.boolean(),
              mergedAt: z.string().nullable(),
              mergedBy: login.nullable(),
              author: login.nullable(),
              repository: z.object({ nameWithOwner: z.string(), isPrivate: z.boolean(), owner: login, primaryLanguage: language }),
            }),
          })
          .nullable(),
      ),
    }),
    pullRequestReviewContributions: z.object({
      nodes: z.array(
        z
          .object({
            occurredAt: z.string(),
            pullRequestReview: z.object({ id: z.string(), url: z.string() }),
            pullRequest: z.object({
              title: z.string(),
              author: login.nullable(),
              repository: z.object({ nameWithOwner: z.string(), isPrivate: z.boolean(), primaryLanguage: language.optional() }),
            }),
          })
          .nullable(),
      ),
    }),
  }),
});

const ContributionsResponseSchema = z.object({
  data: z.object({
    node: z.object({ __typename: z.string() }).loose().nullable(),
    rateLimit: RateLimitSchema,
  }),
});

const ViewerSchema = z.object({
  id: z.number().int(),
  node_id: z.string(),
  login: z.string(),
  avatar_url: z.string(),
  created_at: z.string(),
  type: z.string(),
});

export type Viewer = z.infer<typeof ViewerSchema>;

type ParsedUser = z.infer<typeof UserSchema>;

function sameLogin(a: string | undefined | null, b: string | undefined | null): boolean {
  return a != null && b != null && a.toLowerCase() === b.toLowerCase();
}

function utcDay(iso: string) {
  return isoDay(Date.parse(iso));
}

export function parseContributionsResponse(json: unknown): ContributionsResult | { notFound: true; rateLimit: RateLimit } {
  const parsed = ContributionsResponseSchema.parse(json);
  const rl = parsed.data.rateLimit;
  const rateLimit: RateLimit = { limit: rl.limit, remaining: rl.remaining, resetAtMs: Date.parse(rl.resetAt), cost: rl.cost };
  if (parsed.data.node?.__typename !== 'User') return { notFound: true, rateLimit };
  const user = UserSchema.parse(parsed.data.node);
  return {
    account: {
      databaseId: user.databaseId,
      nodeId: user.id,
      login: user.login,
      avatarUrl: user.avatarUrl,
      createdAtMs: Date.parse(user.createdAt),
      type: 'User',
    },
    contributions: contributionsOf(user),
    rateLimit,
  };
}

function contributionsOf(user: ParsedUser): Contribution[] {
  const out = new Map<string, Contribution>();
  const cc = user.contributionsCollection;

  for (const { repository: repo, contributions } of cc.commitContributionsByRepository) {
    if (repo.isPrivate) continue;
    for (const node of contributions.nodes) {
      if (!node || node.commitCount <= 0) continue;
      const day = utcDay(node.occurredAt);
      const sourceId = `commits:${repo.nameWithOwner}:${day}`;
      const existing = out.get(sourceId);
      if (existing) existing.count += node.commitCount;
      else {
        out.set(sourceId, {
          sourceId,
          kind: 'commits',
          day,
          count: node.commitCount,
          repo: repo.nameWithOwner,
          url: repo.url,
          title: null,
          language: repo.primaryLanguage?.name ?? null,
        });
      }
    }
  }

  for (const node of cc.pullRequestContributions.nodes) {
    const pr = node?.pullRequest;
    if (!pr || pr.repository.isPrivate || !pr.merged || !pr.mergedAt) continue;
    const author = pr.author?.login ?? user.login;
    if (!pr.mergedBy || sameLogin(pr.mergedBy.login, author)) continue;
    if (sameLogin(pr.repository.owner.login, author)) continue;
    const sourceId = `pr:${pr.id}`;
    out.set(sourceId, {
      sourceId,
      kind: 'merged_pr',
      day: utcDay(pr.mergedAt),
      count: 1,
      repo: pr.repository.nameWithOwner,
      url: pr.url,
      title: pr.title,
      language: pr.repository.primaryLanguage?.name ?? null,
    });
  }

  for (const node of cc.pullRequestReviewContributions.nodes) {
    if (!node || node.pullRequest.repository.isPrivate) continue;
    if (sameLogin(node.pullRequest.author?.login, user.login)) continue;
    const sourceId = `review:${node.pullRequestReview.id}`;
    out.set(sourceId, {
      sourceId,
      kind: 'review',
      day: utcDay(node.occurredAt),
      count: 1,
      repo: node.pullRequest.repository.nameWithOwner,
      url: node.pullRequestReview.url,
      title: node.pullRequest.title,
      language: node.pullRequest.repository.primaryLanguage?.name ?? null,
    });
  }

  return [...out.values()];
}

export interface GithubClient {
  fetchContributions(nodeId: string, nowMs: number): Promise<ContributionsResult | { notFound: true; rateLimit: RateLimit }>;
  resolveLogin(login: string): Promise<string | null>;
}

export function createGithubClient(token: string, fetchImpl: typeof fetch = fetch): GithubClient {
  async function graphql(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const res = await fetchImpl(GRAPHQL_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': USER_AGENT },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new GithubError(`GitHub GraphQL ${res.status}`, res.status);
    const body = (await res.json()) as { errors?: { message: string }[] };
    if (body.errors?.length && !(body as { data?: unknown }).data) {
      throw new GithubError(`GitHub GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    return body;
  }

  return {
    async fetchContributions(nodeId, nowMs) {
      const from = new Date(nowMs - CONTRIBUTION_LOOKBACK_DAYS * DAY_MS).toISOString();
      const to = new Date(nowMs).toISOString();
      return parseContributionsResponse(await graphql(CONTRIBUTIONS_QUERY, { id: nodeId, from, to }));
    },
    async resolveLogin(loginName) {
      const body = z.object({ data: z.object({ user: z.object({ id: z.string() }).nullable() }) }).parse(
        await graphql(LOGIN_QUERY, { login: loginName }),
      );
      return body.data.user?.id ?? null;
    },
  };
}

export async function fetchViewer(token: string, fetchImpl: typeof fetch = fetch): Promise<Viewer> {
  const res = await fetchImpl('https://api.github.com/user', {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': USER_AGENT },
  });
  if (!res.ok) throw new GithubError(`GitHub /user ${res.status}`, res.status);
  return ViewerSchema.parse(await res.json());
}
