import type { World } from './api.ts';

export function seedRng(seed: number): number {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
}

// mulberry32 with its state kept on the world so snapshots carry it.
export function nextRandom(world: World): number {
  const s = (world.rng + 0x6d2b79f5) | 0;
  world.rng = s;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
