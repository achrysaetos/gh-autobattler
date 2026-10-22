import { readFileSync } from 'node:fs';
import { DEMO_ID_BASE } from './demo.ts';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage } from '../protocol.ts';
import { createServer, type Server } from './app.ts';
import { loadConfig } from './config.ts';
import { silentLogger } from './log.ts';
import { issueSession } from './session.ts';
import { createFakeSim } from './testing/fakeSim.ts';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const SECRET = 's'.repeat(40);
const fixture = readFileSync(new URL('./testing/github-fixture.json', import.meta.url), 'utf8');

const fakeGithub = (async (_url: string, init: RequestInit) => {
  const body = String(init.body);
  if (body.includes('PushfrontLogin')) {
    const { node, rateLimit } = JSON.parse(fixture).data;
    const login = String(JSON.parse(body).variables.login).toLowerCase();
    const user = login === 'alice' ? node : login === 'bob' ? { ...node, id: 'U_bob', databaseId: 1002, login: 'bob' } : null;
    return new Response(JSON.stringify({ data: { user, rateLimit } }));
  }
  return new Response(fixture);
}) as unknown as typeof fetch;

let server: Server | null = null;
afterEach(async () => {
  await server?.shutdown();
  server = null;
});

async function boot(env: Record<string, string>) {
  const config = loadConfig({ DATABASE_PATH: ':memory:', SESSION_SECRET: SECRET, PORT: '0', HOST: '127.0.0.1', CLIENT_DIR: '/nonexistent', ...env });
  server = await createServer(config, createFakeSim(), { log: silentLogger, clock: () => NOW, fetchImpl: fakeGithub, background: false });
  return server;
}

function firstMessage(ws: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    ws.once('message', (d) => resolve(JSON.parse(d.toString()) as ServerMessage));
    ws.once('error', reject);
  });
}

function closeOf(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
}

describe('rooms over HTTP and WebSocket', () => {
  it('creates a room, lists it, streams it on its own channel, and closes unknown or missing slugs', async () => {
    const s = await boot({ GITHUB_TOKEN: 'srv' });
    const created = await s.app.inject({ method: 'POST', url: '/api/rooms', payload: { logins: ['alice', 'bob'] } });
    expect(created.statusCode).toBe(201);
    const { slug } = created.json() as { ok: true; slug: string };

    const listed = (await s.app.inject({ url: '/api/rooms' })).json();
    expect(listed.recent).toEqual([]);
    expect(listed.live).toMatchObject([{ slug, name: '@alice vs @bob', status: 'active', fighters: [{ login: 'alice', soldiers: 8 }, { login: 'bob', soldiers: 8 }] }]);

    const base = (await s.listen()).replace('http', 'ws');
    const roomHello = await firstMessage(new WebSocket(`${base}/ws?room=${slug}`));
    expect(roomHello.type === 'hello' && roomHello.round).toMatchObject({ roomSlug: slug, status: 'active' });
    expect(roomHello.type === 'hello' && roomHello.players.map((p) => p.login)).toEqual(['alice', 'bob']);
    const campaignHello = await firstMessage(new WebSocket(`${base}/ws`));
    expect(campaignHello.type === 'hello' && campaignHello.round.roomSlug).toBeNull();
    expect(campaignHello.type === 'hello' && campaignHello.players).toEqual([]);

    expect(await closeOf(new WebSocket(`${base}/ws?room=zzzzzzzz`))).toEqual({ code: 4404, reason: 'room not found' });
    expect(await closeOf(new WebSocket(`${base}/ws?room=`))).toEqual({ code: 4400, reason: 'room slug missing' });
  });

  it('rate limits room creation per client address and answers rooms_full past the live limit', async () => {
    const s = await boot({ GITHUB_TOKEN: 'srv', ROOM_MAX_LIVE: '7' });
    const post = (ip: string) => s.app.inject({ method: 'POST', url: '/api/rooms', payload: { logins: ['alice', 'bob'] }, remoteAddress: ip });
    for (let i = 0; i < 6; i++) expect((await post('10.0.0.1')).statusCode).toBe(201);
    const limited = await post('10.0.0.1');
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ ok: false, error: 'rate_limited' });
    expect((await post('10.0.0.2')).statusCode).toBe(201);
    const full = await post('10.0.0.3');
    expect(full.statusCode).toBe(503);
    expect(full.json()).toMatchObject({ ok: false, error: 'rooms_full' });
  });

  it('answers github_unavailable without a server token', async () => {
    const s = await boot({});
    const res = await s.app.inject({ method: 'POST', url: '/api/rooms', payload: { logins: ['alice', 'bob'] } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'github_unavailable' });
  });
});

describe('server', () => {
  it('signs in through dev auth, enlists, polls at once, and never leaks private repos', async () => {
    const s = await boot({ GITHUB_TOKEN: 'srv', DEV_AUTH: '1' });
    const res = await s.app.inject({ method: 'GET', url: '/auth/dev?login=alice' });
    expect(res.statusCode).toBe(302);
    const cookie = res.cookies.find((c) => c.name === 'pf_session')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
    await new Promise((r) => setTimeout(r, 20));

    const me = await s.app.inject({ method: 'GET', url: '/api/me', cookies: { pf_session: cookie.value } });
    const body = me.json();
    expect(body.viewer).toMatchObject({ playerId: 1001, login: 'alice' });
    expect(body.player.fielded).toEqual({ infantry: 6, archers: 1, cavalry: 1 });

    const address = await s.listen();
    const ws = new WebSocket(`${address.replace('http', 'ws')}/ws`, { headers: { cookie: `pf_session=${cookie.value}` } });
    const hello = await new Promise<string>((resolve, reject) => {
      ws.once('message', (d) => resolve(d.toString()));
      ws.once('error', reject);
    });
    const msg = JSON.parse(hello) as ServerMessage;
    expect(msg.type).toBe('hello');
    if (msg.type !== 'hello') return;
    expect(msg.viewerPlayerId).toBe(1001);
    expect(msg.players.map((p) => p.login)).toEqual(['alice']);
    expect(msg.tickMs).toBe(100);
    expect(hello).not.toContain('secretcorp');
    expect(hello).not.toContain('srv');

    ws.send(JSON.stringify({ type: 'resync' }));
    const again = await new Promise<string>((resolve) => ws.once('message', (d) => resolve(d.toString())));
    expect(JSON.parse(again).type).toBe('hello');
    ws.close();
  });

  it('rejects a forged session and a bad OAuth state', async () => {
    const s = await boot({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' });
    const forged = issueSession(1001, NOW, 'wrong-secret'.repeat(4));
    expect((await s.app.inject({ url: '/api/me', cookies: { pf_session: forged } })).json()).toEqual({ viewer: null, player: null });

    const start = await s.app.inject({ url: '/auth/github' });
    expect(start.statusCode).toBe(302);
    const location = new URL(start.headers.location as string);
    expect(location.searchParams.get('scope')).toBe('');
    const bad = await s.app.inject({ url: '/auth/github/callback?code=c&state=nope', cookies: { pf_oauth_state: 'other' } });
    expect(bad.statusCode).toBe(400);
    expect((await s.app.inject({ url: '/auth/dev?login=alice' })).statusCode).toBe(404);
  });

  it('serves health, standings, and profiles', async () => {
    const s = await boot({ DEMO_PLAYERS: '12' });
    const health = (await s.app.inject({ url: '/api/health' })).json();
    expect(health).toMatchObject({ ok: true, round: 1, status: 'active', players: 12, ingestion: false });
    expect((await s.app.inject({ url: '/api/standings' })).json()).toEqual({ lifetime: [] });
    const profile = (await s.app.inject({ url: `/api/players/${DEMO_ID_BASE + 3}` })).json();
    expect(profile).toMatchObject({ playerId: DEMO_ID_BASE + 3, stats: { roundsPlayed: 0 }, medals: [], history: [] });
    expect((await s.app.inject({ url: '/api/players/42' })).statusCode).toBe(404);
  });
});
