import type { Unit } from './api.ts';
import { bucketX, bucketY, type SpatialHash } from './spatial.ts';
import { BEATS, STATS } from './stats.ts';

const FAVORED_PULL = 0.6;

// Nearest enemy within `radius`, with favored matchups looking 1/0.6 closer so
// cavalry peel off toward archers and infantry toward cavalry. Searches rings of
// buckets outward and stops once no farther ring can beat the best found.
export function findTarget(units: readonly Unit[], hash: SpatialHash, i: number, radius: number): number {
  const u = units[i]!;
  const favored = BEATS[u.kind];
  const bx = bucketX(hash, u.x);
  const by = bucketY(hash, u.y);
  const rings = Math.floor(radius / hash.cell) + 1;
  const r2 = radius * radius;
  let best = -1;
  let bestScore = Infinity;
  for (let k = 0; k <= rings; k++) {
    if (best >= 0) {
      const floor = (k - 1) * hash.cell * FAVORED_PULL;
      if (floor > 0 && floor * floor >= bestScore) break;
    }
    const y0 = by - k;
    const y1 = by + k;
    for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= hash.rows) continue;
      const edgeRow = y === y0 || y === y1;
      const step = edgeRow ? 1 : 2 * k;
      for (let x = bx - k; x <= bx + k; x += step === 0 ? 1 : step) {
        if (x < 0 || x >= hash.cols) continue;
        for (let j = hash.head[y * hash.cols + x]!; j >= 0; j = hash.next[j]!) {
          const v = units[j]!;
          if (v.faction === u.faction) continue;
          const dx = v.x - u.x;
          const dy = v.y - u.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          const score = v.kind === favored ? d2 * FAVORED_PULL * FAVORED_PULL : d2;
          if (score < bestScore || (score === bestScore && j < best)) {
            bestScore = score;
            best = j;
          }
        }
      }
    }
  }
  return best;
}

const SCREEN_RADIUS = 70;

// An archer is screened when a friendly melee unit nearby stands closer to its target.
export function isScreened(units: readonly Unit[], hash: SpatialHash, i: number, target: Unit): boolean {
  const u = units[i]!;
  const tdx = target.x - u.x;
  const tdy = target.y - u.y;
  const own = tdx * tdx + tdy * tdy;
  const reach = Math.floor(SCREEN_RADIUS / hash.cell) + 1;
  const bx = bucketX(hash, u.x);
  const by = bucketY(hash, u.y);
  for (let y = Math.max(0, by - reach); y <= Math.min(hash.rows - 1, by + reach); y++) {
    for (let x = Math.max(0, bx - reach); x <= Math.min(hash.cols - 1, bx + reach); x++) {
      for (let j = hash.head[y * hash.cols + x]!; j >= 0; j = hash.next[j]!) {
        const v = units[j]!;
        if (v.faction !== u.faction || STATS[v.kind]!.ranged) continue;
        const dx = target.x - v.x;
        const dy = target.y - v.y;
        if (dx * dx + dy * dy < own) return true;
      }
    }
  }
  return false;
}
