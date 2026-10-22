import type { MapDef, Unit } from './api.ts';
import { cellAt, cellCenterX, cellCenterY, isPassable, type FlowField } from './flowfield.ts';
import { bucketX, bucketY, type SpatialHash } from './spatial.ts';

export interface Vec {
  x: number;
  y: number;
}

const SEPARATION_RADIUS = 10;
const SEPARATION_GAIN = 1.5;
const MAX_PUSH_FACTOR = 1.4;
const DEADBAND2 = 0.25 * 0.25;

export function towards(out: Vec, fromX: number, fromY: number, toX: number, toY: number): number {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-9) {
    out.x = 0;
    out.y = 0;
  } else {
    out.x = dx / d;
    out.y = dy / d;
  }
  return d;
}

export function flowDirection(out: Vec, map: MapDef, field: FlowField, x: number, y: number, goalX: number, goalY: number): void {
  const c = cellAt(map, x, y);
  const n1 = c < 0 || field.cost[c]! < 0 ? -1 : field.next[c]!;
  if (n1 < 0) {
    towards(out, x, y, goalX, goalY);
    return;
  }
  const n2 = field.next[n1]!;
  const aim = n2 >= 0 ? n2 : n1;
  towards(out, x, y, cellCenterX(map, aim), cellCenterY(map, aim));
}

export function separation(out: Vec, units: readonly Unit[], hash: SpatialHash, i: number): void {
  const u = units[i]!;
  let px = 0;
  let py = 0;
  const bx = bucketX(hash, u.x);
  const by = bucketY(hash, u.y);
  const r2 = SEPARATION_RADIUS * SEPARATION_RADIUS;
  for (let y = Math.max(0, by - 1); y <= Math.min(hash.rows - 1, by + 1); y++) {
    for (let x = Math.max(0, bx - 1); x <= Math.min(hash.cols - 1, bx + 1); x++) {
      for (let j = hash.head[y * hash.cols + x]!; j >= 0; j = hash.next[j]!) {
        if (j === i) continue;
        const v = units[j]!;
        const dx = u.x - v.x;
        const dy = u.y - v.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;
        if (d2 < 1e-6) {
          px += u.id < v.id ? 0.5 : -0.5;
          py += (u.id & 1) === 0 ? 0.3 : -0.3;
          continue;
        }
        const d = Math.sqrt(d2);
        const w = (SEPARATION_RADIUS - d) / (SEPARATION_RADIUS * d);
        px += dx * w;
        py += dy * w;
      }
    }
  }
  out.x = px * SEPARATION_GAIN;
  out.y = py * SEPARATION_GAIN;
}

export function resolveMove(out: Vec, map: MapDef, x: number, y: number, vx: number, vy: number, speed: number): void {
  const max = speed * MAX_PUSH_FACTOR;
  const m2 = vx * vx + vy * vy;
  if (m2 < DEADBAND2) {
    out.x = x;
    out.y = y;
    return;
  }
  if (m2 > max * max) {
    const k = max / Math.sqrt(m2);
    vx *= k;
    vy *= k;
  }
  if (passableAt(map, x + vx, y + vy)) {
    out.x = x + vx;
    out.y = y + vy;
  } else if (passableAt(map, x + vx, y)) {
    out.x = x + vx;
    out.y = y;
  } else if (passableAt(map, x, y + vy)) {
    out.x = x;
    out.y = y + vy;
  } else {
    out.x = x;
    out.y = y;
  }
}

export function passableAt(map: MapDef, x: number, y: number): boolean {
  const c = cellAt(map, x, y);
  return c >= 0 && isPassable(map.terrain[c]!);
}
