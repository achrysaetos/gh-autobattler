import { NEUTRAL, TICKS_PER_SECOND, type SimInput } from './api.ts';
import { checksum, createWorld, generateMap, step } from './index.ts';
import { DOMINATION_TICKS } from './stats.ts';

const armies = [
  { players: 10, infantry: 14, archers: 8, cavalry: 6 },
  { players: 6, infantry: 10, archers: 10, cavalry: 10 },
  { players: 14, infantry: 8, archers: 4, cavalry: 2 },
  { players: 4, infantry: 30, archers: 15, cavalry: 15 },
];

const inputs: SimInput[] = [];
let expectedUnits = 0;
let playerId = 1000;
armies.forEach((a, faction) => {
  for (let i = 0; i < a.players; i++) {
    const id = playerId++;
    inputs.push({ kind: 'enlist', playerId: id, faction });
    inputs.push({ kind: 'muster', playerId: id, infantry: a.infantry, archers: a.archers, cavalry: a.cavalry, rank: i % 5 });
    expectedUnits += a.infantry + a.archers + a.cavalry;
  }
});

const params = { seed: Number(process.argv[2] ?? 42), factionCount: armies.length, expectedUnits, dominationTicks: DOMINATION_TICKS };
const map = generateMap(params);
const world = createWorld(params, map);
console.log(`map radius ${map.radius.toFixed(0)}, ${map.hexes.length} hexes, ${map.objectives.length} objectives, ${world.units.length} garrison units`);

const minutes = Number(process.argv[3] ?? 10);
let kills = 0;
let captures = 0;
let maxDeathsPerSecond = 0;
let deathsThisSecond = 0;
let routs = 0;
const wasRetreating = new Map<number, boolean>();
const started = performance.now();
for (let t = 0; t < minutes * 60 * TICKS_PER_SECOND; t++) {
  const ev = step(world, t === 0 ? inputs : []);
  kills += ev.deaths.length;
  captures += ev.captures.length;
  deathsThisSecond += ev.deaths.length;
  for (const c of ev.captures) {
    const name = map.objectives[c.objectiveId]!.kind;
    console.log(`  t=${(world.tick / 10).toFixed(0)}s faction ${c.faction} took ${name} #${c.objectiveId} from ${c.previous} (${c.playerIds.length} players)`);
  }
  for (const p of world.players) {
    if (p.retreating && !wasRetreating.get(p.playerId)) routs++;
    wasRetreating.set(p.playerId, p.retreating);
  }
  if (world.tick % TICKS_PER_SECOND === 0) {
    maxDeathsPerSecond = Math.max(maxDeathsPerSecond, deathsThisSecond);
    deathsThisSecond = 0;
  }
  if (world.tick % (60 * TICKS_PER_SECOND) === 0) {
    const owners = world.objectives
      .filter((o) => map.objectives[o.id]!.kind !== 'base')
      .map((o) => (o.owner === NEUTRAL ? '.' : String(o.owner)))
      .join('');
    console.log(`minute ${world.tick / 600}: alive ${world.units.length}, deaths ${kills}, captures ${captures}, routs ${routs}, owners [${owners}]`);
    for (const f of world.factions) {
      const members = world.players.filter((p) => p.faction === f.id);
      const k = members.reduce((n, p) => n + p.kills, 0);
      const l = members.reduce((n, p) => n + p.losses, 0);
      const alive = world.units.filter((u) => u.faction === f.id).length;
      const retreating = members.filter((p) => p.retreating).length;
      console.log(
        `  faction ${f.id}: score ${f.score.toFixed(0).padStart(6)}  hexes ${String(f.hexesHeld).padStart(3)}  objectives ${f.objectivesHeld}  alive ${String(alive).padStart(4)}  kills ${String(k).padStart(4)}  losses ${String(l).padStart(4)}  retreating ${retreating}`,
      );
    }
  }
}
const elapsed = performance.now() - started;
console.log(`peak deaths/s ${maxDeathsPerSecond}; ${(elapsed / (minutes * 600)).toFixed(3)} ms/tick; checksum ${checksum(world).toString(16)}`);
