import type { FastifyInstance } from 'fastify';
import type { SimModule } from '../sim/api.ts';
import { Armory } from './armory.ts';
import type { Config } from './config.ts';
import { openDb, Store } from './db.ts';
import { DemoTicker, enlistDemoPlayers, seedDemoPlayers } from './demo.ts';
import { Campaign } from './campaign.ts';
import { createGithubClient } from './github.ts';
import { buildHttp, Hub } from './http.ts';
import { Ingest } from './ingest.ts';
import { consoleLogger, type Logger } from './log.ts';
import { Poller } from './poller.ts';
import { Scheduler } from './scheduler.ts';

export interface Server {
  app: FastifyInstance;
  campaign: Campaign;
  store: Store;
  listen(): Promise<string>;
  shutdown(): Promise<void>;
}

export async function createServer(
  config: Config,
  sim: SimModule,
  opts: { log?: Logger; clock?: () => number; fetchImpl?: typeof fetch; background?: boolean } = {},
): Promise<Server> {
  const log = opts.log ?? consoleLogger;
  const clock = opts.clock ?? Date.now;
  const background = opts.background ?? true;
  const db = openDb(config.databasePath);
  const store = new Store(db);
  const armory = new Armory(store);
  const hub = new Hub();
  const campaign = new Campaign({
    store,
    sim,
    armory,
    config: { roundMs: config.roundMs, intermissionMs: config.intermissionMs },
    log,
    channel: hub.channel('campaign'),
  });
  const scheduler = new Scheduler([campaign], log);
  const ingest = new Ingest(store, armory, campaign);
  const github = config.githubToken ? createGithubClient(config.githubToken, opts.fetchImpl) : null;
  const poller = github ? new Poller({ store, github, ingest, log, clock }) : null;

  if (!github) log.warn('GITHUB_TOKEN is not set: GitHub ingestion is disabled, armies only change through demo players');
  if (config.sessionSecretGenerated) log.warn('SESSION_SECRET is not set: using a random secret, sessions end on restart');
  if (config.devAuth) log.warn('DEV_AUTH=1: /auth/dev signs in as any GitHub login without OAuth');

  const now = clock();
  if (config.demoPlayers > 0) {
    const created = seedDemoPlayers(store, config.demoPlayers, now);
    log.info('demo players ready', { requested: config.demoPlayers, created: created.length });
  }
  campaign.boot(now);
  if (config.demoPlayers > 0) enlistDemoPlayers(store, campaign, now);
  const ticker = config.demoPlayers > 0 ? new DemoTicker({ store, ingest, campaign, log, clock }) : null;

  const app = await buildHttp({ config, store, campaign, github, poller, log, clock, fetchImpl: opts.fetchImpl, hub, ingestionEnabled: github !== null });

  let closing = false;
  return {
    app,
    campaign,
    store,
    async listen() {
      if (background) {
        scheduler.start(clock);
        poller?.start();
        ticker?.start();
      }
      const address = await app.listen({ port: config.port, host: config.host });
      log.info('pushfront listening', { address });
      return address;
    },
    async shutdown() {
      if (closing) return;
      closing = true;
      scheduler.stop();
      poller?.stop();
      ticker?.stop();
      campaign.snapshot();
      hub.closeAll();
      await app.close();
      db.close();
      log.info('pushfront stopped');
    },
  };
}
