import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { WS_CLOSE_ROOM_MISSING, WS_CLOSE_ROOM_UNKNOWN, type PlayerMeta, type ProfileResponse, type RoomsResponse, type ServerMessage, type StandingsResponse } from '../protocol.ts';
import { medalsFor } from '../rules/medals.ts';
import { registerAuth, type AuthDeps } from './auth.ts';
import type { Channel } from './battle.ts';
import type { Recruiter } from './recruit.ts';
import { SLUG_PATTERN, type Rooms } from './rooms.ts';
import { readSession, SESSION_COOKIE } from './session.ts';

export interface MeResponse {
  viewer: { playerId: number; login: string; avatarUrl: string } | null;
  player: PlayerMeta | null;
}

const ClientMessageSchema = z.object({ type: z.literal('resync') });
const PlayerParams = z.object({ id: z.coerce.number().int() });
const WsQuery = z.object({ room: z.string().optional() });

export type ChannelKey = 'campaign' | `room:${string}`;

export class Hub {
  private channels = new Map<ChannelKey, Map<WebSocket, number | null>>();
  private helloFor: ((channel: ChannelKey, viewer: number | null) => ServerMessage | null) | null = null;

  setHello(fn: (channel: ChannelKey, viewer: number | null) => ServerMessage | null): void {
    this.helloFor = fn;
  }

  add(key: ChannelKey, socket: WebSocket, viewer: number | null): void {
    const sockets = this.channels.get(key) ?? new Map<WebSocket, number | null>();
    this.channels.set(key, sockets);
    sockets.set(socket, viewer);
    socket.on('close', () => {
      sockets.delete(socket);
      if (sockets.size === 0 && this.channels.get(key) === sockets) this.channels.delete(key);
    });
    this.sendHello(key, socket);
  }

  sendHello(key: ChannelKey, socket: WebSocket): void {
    const hello = this.helloFor?.(key, this.channels.get(key)?.get(socket) ?? null);
    if (hello) send(socket, hello);
  }

  channel(key: ChannelKey): Channel {
    return {
      send: (msg) => {
        const sockets = this.channels.get(key);
        if (!sockets || sockets.size === 0) return;
        const data = JSON.stringify(msg);
        for (const socket of sockets.keys()) if (socket.readyState === socket.OPEN) socket.send(data);
      },
      reset: () => {
        for (const socket of this.channels.get(key)?.keys() ?? []) this.sendHello(key, socket);
      },
    };
  }

  closeAll(): void {
    for (const sockets of this.channels.values()) for (const socket of sockets.keys()) socket.close(1012, 'server restarting');
  }

  get size(): number {
    let n = 0;
    for (const sockets of this.channels.values()) n += sockets.size;
    return n;
  }
}

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

export async function buildHttp(
  deps: AuthDeps & { hub: Hub; rooms: Rooms; recruiter: Recruiter; ingestionEnabled: boolean },
): Promise<FastifyInstance> {
  const { store, campaign, rooms, recruiter, hub, config, clock } = deps;
  const app = Fastify({ logger: false, trustProxy: true });
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 1024 } });

  const viewerOf = (req: FastifyRequest): number | null => {
    const id = readSession(req.cookies[SESSION_COOKIE], config.sessionSecret, clock());
    return id !== null && store.player(id) ? id : null;
  };

  hub.setHello((channel, viewer) =>
    channel === 'campaign' ? campaign.hello(viewer, clock()) : rooms.hello(channel.slice('room:'.length), viewer, clock()),
  );

  app.get('/ws', { websocket: true }, (socket, req) => {
    const query = WsQuery.safeParse(req.query);
    const room = query.success ? query.data.room : '';
    if (room === '') return socket.close(WS_CLOSE_ROOM_MISSING, 'room slug missing');
    if (room !== undefined && !(SLUG_PATTERN.test(room) && rooms.has(room))) return socket.close(WS_CLOSE_ROOM_UNKNOWN, 'room not found');
    const key: ChannelKey = room === undefined ? 'campaign' : `room:${room}`;
    hub.add(key, socket, viewerOf(req));
    socket.on('message', (raw: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (ClientMessageSchema.safeParse(parsed).success) hub.sendHello(key, socket);
    });
  });

  app.get('/api/me', async (req): Promise<MeResponse> => {
    const id = viewerOf(req);
    const player = id === null ? null : store.player(id);
    if (!player) return { viewer: null, player: null };
    return { viewer: { playerId: player.id, login: player.login, avatarUrl: player.avatarUrl }, player: campaign.playerMeta(player.id, clock()) };
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

  app.post('/api/rooms', async (req, reply) => {
    const outcome = await recruiter.create(req.body, req.ip);
    return reply.code(outcome.status).send(outcome.body);
  });

  app.get('/api/rooms', async (): Promise<RoomsResponse> => rooms.summaries());

  app.get('/api/standings', async (): Promise<StandingsResponse> => ({ lifetime: store.standings(100) }));

  app.get('/api/health', async () => {
    const s = campaign.status();
    return { ok: true, round: s.round?.id ?? null, status: s.round?.status ?? null, tick: s.tick, players: s.players, rooms: rooms.battles().length, spectators: hub.size, ingestion: deps.ingestionEnabled };
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
