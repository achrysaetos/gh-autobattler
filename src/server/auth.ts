import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eligibility } from '../rules/eligibility.ts';
import type { Config } from './config.ts';
import type { Store } from './db.ts';
import type { Campaign } from './campaign.ts';
import { fetchViewer, type GithubAccount, type GithubClient } from './github.ts';
import { errorMessage, type Logger } from './log.ts';
import type { Poller } from './poller.ts';
import { issueSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from './session.ts';

const STATE_COOKIE = 'pf_oauth_state';

export interface AuthDeps {
  config: Config;
  store: Store;
  campaign: Campaign;
  github: GithubClient | null;
  poller: Poller | null;
  log: Logger;
  clock: () => number;
  fetchImpl?: typeof fetch;
}

const CallbackQuery = z.object({ code: z.string().min(1), state: z.string().min(1) });
const TokenResponse = z.object({ access_token: z.string().min(1) });
const DevQuery = z.object({ login: z.string().regex(/^[A-Za-z0-9-]{1,39}$/) });

export function admit(deps: AuthDeps, account: GithubAccount): void {
  const now = deps.clock();
  deps.store.upsertPlayer({
    id: account.databaseId,
    nodeId: account.nodeId,
    login: account.login,
    avatarUrl: account.avatarUrl,
    createdAtGithub: account.createdAtMs,
    enlistedAt: now,
    demo: false,
  });
  const faction = deps.campaign.enlist(account.databaseId, now);
  if (faction !== null) deps.log.info('player enlisted', { player: account.databaseId, login: account.login, faction });
  deps.poller?.pollNow(account.databaseId).catch((err) => deps.log.error('first poll failed', { error: errorMessage(err) }));
}

export function registerAuth(app: FastifyInstance, deps: AuthDeps): void {
  const { config } = deps;
  const secure = config.publicUrl.startsWith('https://');
  const redirectUri = `${config.publicUrl}/auth/github/callback`;

  const signIn = (reply: FastifyReply, account: GithubAccount) => {
    const verdict = eligibility(account, deps.clock());
    if (!verdict.ok) return reply.redirect(`${config.publicUrl}/?error=${verdict.reason}`);
    admit(deps, account);
    reply.setCookie(SESSION_COOKIE, issueSession(account.databaseId, deps.clock(), config.sessionSecret), {
      path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_MAX_AGE_S,
    });
    return reply.redirect(`${config.publicUrl}/`);
  };

  app.get('/auth/github', async (_req, reply) => {
    if (!config.oauth) return reply.code(503).send({ error: 'GitHub sign-in is not configured' });
    const state = randomBytes(18).toString('base64url');
    reply.setCookie(STATE_COOKIE, state, { path: '/auth', httpOnly: true, sameSite: 'lax', secure, maxAge: 600 });
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', config.oauth.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', '');
    return reply.redirect(url.toString());
  });

  app.get('/auth/github/callback', async (req, reply) => {
    if (!config.oauth) return reply.code(503).send({ error: 'GitHub sign-in is not configured' });
    const query = CallbackQuery.safeParse(req.query);
    const expected = req.cookies[STATE_COOKIE];
    reply.clearCookie(STATE_COOKIE, { path: '/auth' });
    if (!query.success || !expected || !sameString(query.data.state, expected)) {
      return reply.code(400).send({ error: 'invalid OAuth state' });
    }
    try {
      const fetchImpl = deps.fetchImpl ?? fetch;
      const res = await fetchImpl('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: config.oauth.clientId, client_secret: config.oauth.clientSecret, code: query.data.code, redirect_uri: redirectUri }),
      });
      const token = TokenResponse.parse(await res.json()).access_token;
      const viewer = await fetchViewer(token, fetchImpl);
      return signIn(reply, {
        databaseId: viewer.id,
        nodeId: viewer.node_id,
        login: viewer.login,
        avatarUrl: viewer.avatar_url,
        createdAtMs: Date.parse(viewer.created_at),
        type: viewer.type,
      });
    } catch (err) {
      deps.log.warn('OAuth callback failed', { error: errorMessage(err) });
      return reply.redirect(`${config.publicUrl}/?error=signin_failed`);
    }
  });

  app.get('/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.redirect(`${config.publicUrl}/`);
  });

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  if (!config.devAuth) return;
  app.get('/auth/dev', async (req, reply) => {
    const query = DevQuery.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: 'login required' });
    if (!deps.github) return reply.code(503).send({ error: 'dev auth needs GITHUB_TOKEN' });
    const nodeId = await deps.github.resolveLogin(query.data.login);
    if (!nodeId) return reply.code(404).send({ error: 'no such GitHub user' });
    const result = await deps.github.fetchContributions(nodeId, deps.clock());
    if ('notFound' in result) return reply.code(404).send({ error: 'no such GitHub user' });
    return signIn(reply, result.account);
  });
}

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
