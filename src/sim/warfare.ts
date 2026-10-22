import { NEUTRAL, type SimInput } from './api.ts';
import { createWorld, generateMap, step } from './index.ts';

export interface WarfareCase {
  name: string;
  factions: number[][];
}

export interface WarfareResult {
  capturesFirst10: number;
  capturesLast10: number;
  deathsFirst10: number;
  deathsLast10: number;
  dominationFaction: number;
  citadelTakenTick: number;
  idleAtHomeSamples: number;
  idleWarbandSamples: number;
  holdSpacing: number;
}

const MINUTE = 600;

export function playerIdFor(n: number): number {
  return n % 2 === 0 ? -(n / 2 + 1) : 40_000_000 + n * 7919;
}

export function warfareInputs(c: WarfareCase): SimInput[] {
  const inputs: SimInput[] = [];
  let n = 0;
  for (let faction = 0; faction < c.factions.length; faction++) {
    for (const size of c.factions[faction]!) {
      const playerId = playerIdFor(n);
      const mix = n % 3;
      const archers = Math.floor(size * (mix === 1 ? 0.5 : 0.25));
      const cavalry = Math.floor(size * (mix === 2 ? 0.45 : 0.15));
      inputs.push({ kind: 'enlist', playerId, faction });
      inputs.push({ kind: 'muster', playerId, infantry: size - archers - cavalry, archers, cavalry, rank: n % 5 });
      n++;
    }
  }
  return inputs;
}

export function runWarfare(c: WarfareCase, seed: number, minutes = 20): WarfareResult {
  const expectedUnits = c.factions.flat().reduce((a, b) => a + b, 0);
  const params = { seed, factionCount: c.factions.length, expectedUnits };
  const map = generateMap(params);
  const world = createWorld(params, map);
  const inputs = warfareInputs(c);
  const citadel = map.objectives.find((o) => o.kind === 'citadel')!.id;
  const r: WarfareResult = {
    capturesFirst10: 0,
    capturesLast10: 0,
    deathsFirst10: 0,
    deathsLast10: 0,
    dominationFaction: NEUTRAL,
    citadelTakenTick: -1,
    idleAtHomeSamples: 0,
    idleWarbandSamples: 0,
    holdSpacing: 0,
  };
  let spacingSum = 0;
  let spacingN = 0;
  for (let t = 0; t < minutes * MINUTE; t++) {
    const ev = step(world, t === 0 ? inputs : []);
    if (t < 10 * MINUTE) {
      r.capturesFirst10 += ev.captures.length;
      r.deathsFirst10 += ev.deaths.length;
    } else {
      r.capturesLast10 += ev.captures.length;
      r.deathsLast10 += ev.deaths.length;
    }
    if (r.citadelTakenTick < 0 && ev.captures.some((cap) => cap.objectiveId === citadel)) r.citadelTakenTick = world.tick;
    if (t >= MINUTE && t % 30 === 29) {
      for (const f of world.factions) {
        const base = map.objectives.find((o) => o.kind === 'base' && o.homeFaction === f.id)!;
        const fielded = world.players.filter((p) => p.faction === f.id && world.units.some((u) => u.faction === f.id && u.playerId === p.playerId));
        if (fielded.length === 0) continue;
        const home = fielded.filter((p) => p.orderObjectiveId === base.id && !p.retreating).length;
        const allHome = home === fielded.length;
        const threatened = world.units.some(
          (u) => u.faction !== f.id && u.faction !== NEUTRAL && dist2(u.x, u.y, base.x, base.y) < 300 * 300,
        );
        if (allHome && !threatened) r.idleAtHomeSamples++;
        if (!threatened) r.idleWarbandSamples += home;
      }
    }
    if (t % MINUTE === MINUTE - 1) {
      const h = holdSpacing(world);
      spacingSum += h.sum;
      spacingN += h.n;
    }
  }
  r.holdSpacing = spacingN > 0 ? spacingSum / spacingN : 0;
  r.dominationFaction = world.dominationFaction;
  return r;
}

function holdSpacing(world: ReturnType<typeof createWorld>): { sum: number; n: number } {
  const orderOf = new Map(world.players.map((p) => [p.playerId, p.orderObjectiveId]));
  let sum = 0;
  let n = 0;
  for (const o of world.map.objectives) {
    const holders = world.units.filter(
      (u) => u.faction !== NEUTRAL && u.targetUnitId < 0 && orderOf.get(u.playerId) === o.id && dist2(u.x, u.y, o.x, o.y) < o.radius * o.radius,
    );
    if (holders.length < 10) continue;
    let total = 0;
    for (const a of holders) {
      let best = Infinity;
      for (const b of holders) if (a !== b) best = Math.min(best, dist2(a.x, a.y, b.x, b.y));
      total += Math.sqrt(best);
    }
    sum += total / holders.length;
    n++;
  }
  return { sum, n };
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
}
