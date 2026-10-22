import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGithubClient, fetchViewer, parseContributionsResponse } from './github.ts';

const fixture = JSON.parse(readFileSync(new URL('./testing/github-fixture.json', import.meta.url), 'utf8'));

function parseFixture() {
  const result = parseContributionsResponse(fixture);
  if ('notFound' in result) throw new Error('fixture should parse to a user');
  return result;
}

describe('parseContributionsResponse', () => {
  it('reads identity and rate limit', () => {
    const { account, rateLimit } = parseFixture();
    expect(account).toEqual({
      databaseId: 1001, nodeId: 'U_alice', login: 'alice', avatarUrl: 'https://avatars.example/1001',
      createdAtMs: Date.parse('2015-03-01T00:00:00Z'), type: 'User',
    });
    expect(rateLimit).toEqual({ limit: 5000, remaining: 4990, resetAtMs: Date.parse('2026-10-22T13:00:00Z'), cost: 1 });
  });

  it('keeps exactly the countable public contributions with stable source ids', () => {
    const ids = parseFixture().contributions.map((c) => c.sourceId).sort();
    expect(ids).toEqual([
      'commits:acme/rocket:2026-10-20',
      'commits:acme/rocket:2026-10-21',
      'commits:alice/dotfiles:2026-10-21',
      'pr:PR_good',
      'review:PRR_good',
    ]);
  });

  it('drops private repos, unmerged, self-merged, own-repo, merger-less PRs, and self reviews', () => {
    const ids = parseFixture().contributions.map((c) => c.sourceId).join(' ');
    for (const rejected of ['secretcorp', 'PR_open', 'PR_selfmerge', 'PR_ownrepo', 'PR_private', 'PR_nomerger', 'PRR_self', 'PRR_private']) {
      expect(ids).not.toContain(rejected);
    }
  });

  it("dates a merged PR by mergedAt's UTC day", () => {
    const pr = parseFixture().contributions.find((c) => c.sourceId === 'pr:PR_good')!;
    expect(pr).toMatchObject({ kind: 'merged_pr', day: '2026-10-19', count: 1, repo: 'acme/rocket', language: 'Rust', title: 'Speed up launch' });
  });

  it('carries commit counts and languages', () => {
    const c = parseFixture().contributions.find((x) => x.sourceId === 'commits:acme/rocket:2026-10-20')!;
    expect(c).toMatchObject({ kind: 'commits', count: 5, language: 'Rust', url: 'https://github.com/acme/rocket' });
  });

  it('reports a missing or non-user node as not found', () => {
    const bot = { data: { node: { __typename: 'Bot', login: 'x' }, rateLimit: fixture.data.rateLimit } };
    expect(parseContributionsResponse(bot)).toMatchObject({ notFound: true });
    expect(parseContributionsResponse({ data: { node: null, rateLimit: fixture.data.rateLimit } })).toMatchObject({ notFound: true });
  });

  it('rejects a malformed payload at the boundary', () => {
    const broken = structuredClone(fixture);
    delete broken.data.node.databaseId;
    expect(() => parseContributionsResponse(broken)).toThrow();
  });
});

describe('client', () => {
  it('sends the server token and a 56 day range', async () => {
    let seen: { auth: string | null; vars: Record<string, string> } | undefined;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      seen = { auth: new Headers(init.headers).get('authorization'), vars: body.variables };
      return new Response(JSON.stringify(fixture), { status: 200 });
    }) as unknown as typeof fetch;
    const now = Date.parse('2026-10-22T12:00:00Z');
    await createGithubClient('srv-token', fakeFetch).fetchContributions('U_alice', now);
    expect(seen).toEqual({
      auth: 'Bearer srv-token',
      vars: { id: 'U_alice', from: '2026-08-27T12:00:00.000Z', to: '2026-10-22T12:00:00.000Z' },
    });
  });

  it('fetchViewer returns only the identity fields', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ id: 7, node_id: 'U_7', login: 'x', avatar_url: 'a', created_at: '2020-01-01T00:00:00Z', type: 'User', email: 'x@y.z' }))) as unknown as typeof fetch;
    expect(await fetchViewer('t', fakeFetch)).toEqual({ id: 7, node_id: 'U_7', login: 'x', avatar_url: 'a', created_at: '2020-01-01T00:00:00Z', type: 'User' });
  });
});
