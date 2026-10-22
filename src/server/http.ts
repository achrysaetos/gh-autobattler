import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { PlayerMeta, ProfileResponse, ServerMessage, StandingsResponse } from '../protocol.ts';
import { medalsFor } from '../rules/medals.ts';
import { registerAuth, type AuthDeps } from './auth.ts';
import { readSession, SESSION_COOKIE } from './session.ts';

export interface MeResponse {
  viewer: { playerId: number; login: string; avatarUrl: string } | null;
  player: PlayerMeta | null;
}

const ClientMessageSchema = z.object({ type: z.literal('resync') });
const PlayerParams = z.object({ id: z.coerce.number().int() });

export class Hub {
  private sockets = new Map<WebSocket, number | null>();
  private helloFor: ((viewer: number | null) => ServerMessage | null) | null = null;

  setHello(fn: (viewer: number | null) => ServerMessage | null): void {
    this.helloFor = fn;
  }

  add(socket: WebSocket, viewer: number | null): void {
    this.sockets.set(socket, viewer);
    socket.on('close', () => this.sockets.delete(socket));
    this.sendHello(socket);
  }

  sendHello(socket: WebSocket): void {
    const hello = this.helloFor?.(this.sockets.get(socket) ?? null);
    if (hello) send(socket, hello);
  }

  broadcast(msg: ServerMessage): void {
    if (this.sockets.size === 0) return;
    const data = JSON.stringify(msg);
    for (const socket of this.sockets.keys()) if (socket.readyState === socket.OPEN) socket.send(data);
  }

  resetAll(): void {
    for (const socket of this.sockets.keys()) this.sendHello(socket);
  }

  closeAll(): void {
    for (const socket of this.sockets.keys()) socket.close(1012, 'server restarting');
  }

  get size(): number {
    return this.sockets.size;
  }
}

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

export async function buildHttp(deps: AuthDeps & { hub: Hub; ingestionEnabled: boolean }): Promise<FastifyInstance> {
  const { store, engine, hub, config, clock } = deps;
  const app = Fastify({ logger: false, trustProxy: true });
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 1024 } });

  const viewerOf = (req: FastifyRequest): number | null => {
    const id = readSession(req.cookies[SESSION_COOKIE], config.sessionSecret, clock());
    return id !== null && store.player(id) ? id : null;
  };

  hub.setHello((viewer) => engine.hello(viewer, clock()));

  app.get('/ws', { websocket: true }, (socket, req) => {
    hub.add(socket, viewerOf(req));
    socket.on('message', (raw: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (ClientMessageSchema.safeParse(parsed).success) hub.sendHello(socket);
    });
  });

  app.get('/api/me', async (req): Promise<MeResponse> => {
    const id = viewerOf(req);
    const player = id === null ? null : store.player(id);
    if (!player) return { viewer: null, player: null };
    return { viewer: { playerId: player.id, login: player.login, avatarUrl: player.avatarUrl }, player: engine.playerMeta(player.id, clock()) };
  });

  app.get('/api/players/:id', async (req, reply) => {
    const params = PlayerParams.safeParse(req.params);
    const player = params.success ? store.player(params.data.id) : null;
    if (!player) return reply.code(404).send({ error: 'not found' });
    const stats = store.lifetime(player.id);
    const profile: ProfileResponse = {
      playerId: player.id,
      login: player.login,
      avatarUrl: player.avatarUrl,
      stats,
      medals: medalsFor(stats),
      history: store.history(player.id),
    };
    return profile;
  });

  app.get('/api/standings', async (): Promise<StandingsResponse> => ({ lifetime: store.standings(100) }));

  app.get('/api/health', async () => {
    const s = engine.status();
    return { ok: true, round: s.round?.id ?? null, status: s.round?.status ?? null, tick: s.tick, players: s.players, spectators: hub.size, ingestion: deps.ingestionEnabled };
  });

  registerAuth(app, deps);

  const clientDir = resolve(config.clientDir);
  if (existsSync(clientDir)) {
    await app.register(fastifyStatic, { root: clientDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split('?')[0]!;
      if (req.method !== 'GET' || /^\/(api|auth|ws)(\/|$)/.test(path)) return reply.code(404).send({ error: 'not found' });
      return reply.type('text/html').sendFile('index.html');
    });
  }
  return app;
}
