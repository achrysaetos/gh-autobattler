import type { MapDef, World, WorldSnapshot } from './api.ts';

interface SerializedWorld extends Omit<World, 'map' | 'territory'> {
  map: Omit<MapDef, 'terrain'> & { terrain: string };
  territory: number[];
}

export function snapshot(world: World): WorldSnapshot {
  const plain: SerializedWorld = {
    ...world,
    map: { ...world.map, terrain: toBase64(world.map.terrain) },
    territory: Array.from(world.territory),
  };
  return { version: 1, world: JSON.parse(JSON.stringify(plain)) as unknown };
}

export function restore(snap: WorldSnapshot): World {
  if (snap.version !== 1) throw new Error(`unsupported snapshot version ${String(snap.version)}`);
  const w = JSON.parse(JSON.stringify(snap.world)) as SerializedWorld;
  return {
    ...w,
    map: { ...w.map, terrain: fromBase64(w.map.terrain) },
    territory: Int8Array.from(w.territory),
  };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

export function checksum(world: World): number {
  let h = 0x811c9dc5 | 0;
  const int = (v: number) => {
    let k = Math.imul(v | 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    h ^= Math.imul(k, 0x1b873593);
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  };
  const num = (v: number) => {
    f64[0] = v;
    int(u32[0]!);
    int(u32[1]!);
  };
  num(world.tick);
  int(world.rng);
  num(world.nextUnitId);
  int(world.units.length);
  for (const u of world.units) {
    num(u.id);
    num(u.playerId);
    int(u.faction);
    int(u.kind);
    num(u.x);
    num(u.y);
    num(u.hp);
    num(u.maxHp);
    num(u.targetUnitId);
    num(u.cooldown);
    num(u.bornTick);
  }
  for (const p of world.players) {
    num(p.playerId);
    int(p.faction);
    for (let k = 0; k < 3; k++) {
      num(p.target[k]!);
      num(p.respawnAt[k]!);
    }
    num(p.rank);
    int(p.orderObjectiveId);
    num(p.kills);
    num(p.losses);
    num(p.captures);
    int(p.retreating ? 1 : 0);
  }
  for (const o of world.objectives) {
    int(o.owner);
    int(o.capturer);
    num(o.progress);
  }
  for (let i = 0; i < world.territory.length; i++) int(world.territory[i]!);
  for (const f of world.factions) {
    num(f.score);
    int(f.hexesHeld);
    int(f.objectivesHeld);
  }
  int(world.dominationFaction);
  num(world.dominationSince);
  int(world.winner);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
