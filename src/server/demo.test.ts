import { afterEach, describe, expect, it } from 'vitest';
import { DemoTicker, enlistDemoPlayers, seedDemoPlayers } from './demo.ts';
import { silentLogger } from './log.ts';
import { harness, type Harness } from './testing/harness.ts';

const NOW = Date.parse('2026-10-22T12:00:00Z');
let h: Harness;
afterEach(() => h.close());

describe('demo mode', () => {
  it('seeds unique synthetic players once, with negative ids and plausible armies', () => {
    h = harness();
    expect(seedDemoPlayers(h.store, 200, NOW)).toHaveLength(200);
    expect(seedDemoPlayers(h.store, 200, NOW)).toHaveLength(0);
    const players = h.store.players();
    expect(players.every((p) => p.demo && p.id < 0 && p.avatarUrl.startsWith('data:image/svg+xml'))).toBe(true);
    expect(new Set(players.map((p) => p.login)).size).toBe(200);
    expect(players.some((p) => h.store.contributions(p.id).length > 0)).toBe(true);
  });

  it('ticks a synthetic contribution into a reinforcement line and a muster', () => {
    h = harness();
    seedDemoPlayers(h.store, 6, NOW);
    h.engine.boot(NOW);
    enlistDemoPlayers(h.store, h.engine, NOW);
    const inputsBefore = h.store.inputsFrom(1, 0).length;
    const ticker = new DemoTicker({ store: h.store, ingest: h.ingest, engine: h.engine, log: silentLogger, clock: () => NOW + 1000 }, 3);
    for (let i = 0; i < 10; i++) ticker.tick();
    const reinforcements = h.store.recentFeed(50).filter((f) => f.kind === 'reinforce');
    expect(reinforcements).toHaveLength(10);
    expect(reinforcements[0]!.message).toMatch(/^@[a-z]+/);
    expect(h.store.inputsFrom(1, 0).length).toBeGreaterThan(inputsBefore);
  });
});
