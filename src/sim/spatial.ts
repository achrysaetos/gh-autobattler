import type { MapDef, Unit } from './api.ts';

export interface SpatialHash {
  cols: number;
  rows: number;
  cell: number;
  originX: number;
  originY: number;
  head: Int32Array;
  next: Int32Array;
}

export function createSpatialHash(map: MapDef, capacity: number): SpatialHash {
  return {
    cols: map.navCols,
    rows: map.navRows,
    cell: map.navCell,
    originX: map.originX,
    originY: map.originY,
    head: new Int32Array(map.navCols * map.navRows),
    next: new Int32Array(capacity),
  };
}

export function rebuildSpatialHash(hash: SpatialHash, units: readonly Unit[]): void {
  hash.head.fill(-1);
  if (hash.next.length < units.length) hash.next = new Int32Array(units.length * 2);
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i]!;
    const c = bucketOf(hash, u.x, u.y);
    hash.next[i] = hash.head[c]!;
    hash.head[c] = i;
  }
}

export function bucketX(hash: SpatialHash, x: number): number {
  return Math.min(hash.cols - 1, Math.max(0, Math.floor((x - hash.originX) / hash.cell)));
}

export function bucketY(hash: SpatialHash, y: number): number {
  return Math.min(hash.rows - 1, Math.max(0, Math.floor((y - hash.originY) / hash.cell)));
}

function bucketOf(hash: SpatialHash, x: number, y: number): number {
  return bucketY(hash, y) * hash.cols + bucketX(hash, x);
}
