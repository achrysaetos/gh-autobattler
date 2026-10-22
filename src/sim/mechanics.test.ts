import { describe, expect, it } from 'vitest';
import { NEUTRAL, UnitKind, type World } from './api.ts';
import { CAPTURE_FULL } from './capture.ts';
import { step } from './index.ts';
import { DOMINATION_TICKS, MAX_ALIVE, STATS, hitDamage } from './stats.ts';
import { aliveOf, arenaWorld, battleWorld, duel, run } from './testkit.ts';

const KIND_NAMES = ['infantry', 'archers', 'cavalry'];
const FAVORED: [UnitKind, UnitKind][] = [
  [UnitKind.Infantry, UnitKind.Cavalry],
  [UnitKind.Cavalry, UnitKind.Archer],
  [UnitKind.Archer, UnitKind.Infantry],
];

function kill(world: World, playerId: number, kind: UnitKind, n: number): void {
  for (const u of world.units) {
    if (n === 0) return;
    if (u.playerId === playerId && u.kind === kind) {
      u.hp = 0;
      n--;
    }
  }
}

function soloPlayer(infantry: number, archers = 0, cavalry = 0, rank = 0): World {
  const world = arenaWorld(5, 1);
  step(world, [
    { kind: 'enlist', playerId: 1, faction: 0 },
    { kind: 'muster', playerId: 1, infantry, archers, cavalry, rank },
  ]);
  return world;
}

describe('combat', () => {
  for (const [winner, loser] of FAVORED) {
    for (const [a, b, side] of [[winner, loser, 0], [loser, winner, 1]] as const) {
      it(`${KIND_NAMES[winner]} beat ${KIND_NAMES[loser]} 10v10 (favored side ${side})`, () => {
        const r = duel(a, b);
        const other = (1 - side) as 0 | 1;
        expect(r.kills[side]).toBeGreaterThan(r.kills[other]);
        expect(r.survivors[side]).toBeGreaterThan(r.survivors[other]);
        expect(r.kills[side]).toBeGreaterThanOrEqual(4);
      });
    }
  }

  it('applies the 1.5x matchup, rank bonus, and forest arrow cover', () => {
    expect(hitDamage(UnitKind.Infantry, 0, UnitKind.Cavalry, false)).toBe(18);
    expect(hitDamage(UnitKind.Infantry, 0, UnitKind.Archer, false)).toBe(12);
    expect(hitDamage(UnitKind.Cavalry, 4, UnitKind.Infantry, false)).toBeCloseTo(15 * 1.32, 10);
    expect(hitDamage(UnitKind.Archer, 0, UnitKind.Infantry, true)).toBeCloseTo(9 * 1.5 * 0.5, 10);
    expect(hitDamage(UnitKind.Cavalry, 0, UnitKind.Archer, true)).toBe(22.5);
  });

  it('gives ranked units 8% more health per rank', () => {
    const world = soloPlayer(2, 0, 0, 3);
    for (const u of world.units) expect(u.maxHp).toBeCloseTo(STATS[UnitKind.Infantry]!.hp * 1.24, 10);
  });
});

describe('muster and respawn', () => {
  it('spawns missing units immediately at the base, with spawn events', () => {
    const world = arenaWorld(5, 1);
    const ev = step(world, [
      { kind: 'enlist', playerId: 1, faction: 0 },
      { kind: 'muster', playerId: 1, infantry: 3, archers: 2, cavalry: 1, rank: 0 },
    ]);
    expect(ev.spawns.map((s) => s.kind).sort()).toEqual([0, 0, 0, 1, 1, 2]);
    const base = world.map.objectives[0]!;
    for (const u of world.units) {
      expect(Math.sqrt((u.x - base.x) ** 2 + (u.y - base.y) ** 2)).toBeLessThan(base.radius);
    }
  });

  it('does not replace surplus units after muster shrinks, but refills up to the new target', () => {
    const world = soloPlayer(10);
    step(world, [{ kind: 'muster', playerId: 1, infantry: 4, archers: 0, cavalry: 0, rank: 0 }]);
    expect(aliveOf(world, 1)).toBe(10);
    kill(world, 1, UnitKind.Infantry, 3);
    run(world, 400);
    expect(aliveOf(world, 1)).toBe(7);
    kill(world, 1, UnitKind.Infantry, 5);
    run(world, 210);
    expect(aliveOf(world, 1)).toBe(4);
    expect(world.players[0]!.losses).toBe(8);
  });

  it('respawns a fallen unit exactly 20 seconds after it dies', () => {
    const world = soloPlayer(5);
    kill(world, 1, UnitKind.Infantry, 1);
    const deathTick = world.tick;
    const death = step(world, []);
    expect(death.deaths).toHaveLength(1);
    expect(death.deaths[0]!.killerPlayerId).toBe(NEUTRAL);
    let respawnTick = -1;
    while (world.tick < deathTick + 400 && respawnTick < 0) {
      const ev = step(world, []);
      if (ev.spawns.length > 0) respawnTick = world.tick - 1;
    }
    expect(respawnTick - deathTick).toBe(200);
    expect(aliveOf(world, 1)).toBe(5);
  });

  it('never exceeds the 2400 alive cap', () => {
    const world = arenaWorld(5, 2);
    const inputs = [];
    for (let p = 1; p <= 12; p++) {
      inputs.push({ kind: 'enlist' as const, playerId: p, faction: p % 2 });
      inputs.push({ kind: 'muster' as const, playerId: p, infantry: 100, archers: 60, cavalry: 60, rank: 0 });
    }
    step(world, inputs);
    expect(world.units.length).toBe(MAX_ALIVE);
    run(world, 300);
    expect(world.units.length).toBeLessThanOrEqual(MAX_ALIVE);
  });
});

describe('objectives', () => {
  it('a lone faction standing on a stronghold flips it and emits a capture event naming the players', () => {
    const world = arenaWorld(5, 2);
    step(world, [
      { kind: 'enlist', playerId: 7, faction: 1 },
      { kind: 'muster', playerId: 7, infantry: 10, archers: 0, cavalry: 0, rank: 0 },
    ]);
    const target = world.map.objectives.find((o) => o.kind === 'stronghold')!;
    world.units.forEach((u, i) => {
      u.x = target.x + ((i % 4) - 1.5) * 10;
      u.y = target.y + (Math.floor(i / 4) - 1) * 10;
    });
    world.players[0]!.orderObjectiveId = target.id;
    let capture;
    for (let t = 0; t < 400 && !capture; t++) capture = step(world, []).captures[0];
    expect(capture).toEqual({ objectiveId: target.id, faction: 1, previous: NEUTRAL, playerIds: [7] });
    expect(world.objectives[target.id]!.owner).toBe(1);
    expect(world.players[0]!.captures).toBe(1);
    expect(world.tick).toBeGreaterThanOrEqual(CAPTURE_FULL / 10);
  });

  it('bases cannot be captured', () => {
    const world = arenaWorld(5, 2);
    step(world, [
      { kind: 'enlist', playerId: 7, faction: 1 },
      { kind: 'muster', playerId: 7, infantry: 10, archers: 0, cavalry: 0, rank: 0 },
    ]);
    const enemyBase = world.map.objectives[0]!;
    for (const u of world.units) {
      u.x = enemyBase.x;
      u.y = enemyBase.y;
    }
    run(world, 400);
    expect(world.objectives[0]!.owner).toBe(0);
  });

  it('a one-faction world clears every neutral garrison, takes the citadel, and dominates', () => {
    const { world, inputs } = battleWorld(21, [[
      { infantry: 30, archers: 15, cavalry: 15, rank: 4 },
      { infantry: 30, archers: 15, cavalry: 15, rank: 4 },
      { infantry: 20, archers: 20, cavalry: 20, rank: 2 },
    ]]);
    const garrison = world.units.filter((u) => u.faction === NEUTRAL).length;
    expect(garrison).toBeGreaterThan(20);
    const citadel = world.map.objectives.find((o) => o.kind === 'citadel')!;
    const captured: number[] = [];
    run(world, 11, inputs);
    const startHexes = world.factions[0]!.hexesHeld;
    expect(startHexes).toBeGreaterThan(0);
    for (let t = 0; t < 12000 && world.dominationFaction !== 0; t++) {
      for (const c of step(world, []).captures) captured.push(c.objectiveId);
    }
    expect(world.units.filter((u) => u.faction === NEUTRAL)).toHaveLength(0);
    expect(world.objectives[citadel.id]!.owner).toBe(0);
    expect(captured).toContain(citadel.id);
    expect(world.dominationFaction).toBe(0);
    expect(world.winner).toBe(NEUTRAL);
    expect(world.factions[0]!.hexesHeld).toBeGreaterThan(startHexes * 2);

    world.dominationSince = world.tick - (DOMINATION_TICKS - 1);
    step(world, []);
    expect(world.winner).toBe(NEUTRAL);
    step(world, []);
    expect(world.winner).toBe(0);
  });
});

describe('scoring', () => {
  it('scores hexes, strongholds, and the citadel once per second', () => {
    const world = arenaWorld(5, 2);
    const citadel = world.map.objectives.find((o) => o.kind === 'citadel')!;
    const stronghold = world.map.objectives.find((o) => o.kind === 'stronghold')!;
    world.objectives[citadel.id]!.owner = 1;
    world.objectives[stronghold.id]!.owner = 1;
    world.territory.fill(NEUTRAL);
    for (let h = 0; h < 20; h++) world.territory[h] = 1;
    world.tick = 10;
    step(world, []);
    expect(world.factions[1]!.hexesHeld).toBeGreaterThanOrEqual(20);
    const held = world.factions[1]!.hexesHeld;
    expect(world.factions[1]!.score).toBeCloseTo(held / 10 + 5 + 15, 10);
    run(world, 9);
    expect(world.factions[1]!.score).toBeCloseTo(held / 10 + 5 + 15, 10);
  });
});
