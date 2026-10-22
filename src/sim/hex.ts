import type { Hex } from './api.ts';

// Pointy-top axial hexes: x = size * sqrt3 * (q + r / 2), y = size * 1.5 * r.
const SQRT3 = Math.sqrt(3);

export function hexCenter(q: number, r: number, size: number): { x: number; y: number } {
  return { x: size * SQRT3 * (q + r / 2), y: size * 1.5 * r };
}

export function hexesInDisc(radius: number, size: number): Hex[] {
  const reach = Math.floor(radius / size) + 2;
  const hexes: Hex[] = [];
  for (let r = -reach; r <= reach; r++) {
    for (let q = -reach * 2; q <= reach * 2; q++) {
      const { x, y } = hexCenter(q, r, size);
      if (x * x + y * y <= (radius - size * 0.4) * (radius - size * 0.4)) hexes.push({ q, r, x, y });
    }
  }
  return hexes;
}

export interface HexLookup {
  qMin: number;
  rMin: number;
  qSpan: number;
  rSpan: number;
  index: Int32Array;
  size: number;
}

export function buildHexLookup(hexes: readonly Hex[], size: number): HexLookup {
  let qMin = 0, qMax = 0, rMin = 0, rMax = 0;
  for (const h of hexes) {
    qMin = Math.min(qMin, h.q);
    qMax = Math.max(qMax, h.q);
    rMin = Math.min(rMin, h.r);
    rMax = Math.max(rMax, h.r);
  }
  const qSpan = qMax - qMin + 1;
  const rSpan = rMax - rMin + 1;
  const index = new Int32Array(qSpan * rSpan).fill(-1);
  for (let i = 0; i < hexes.length; i++) {
    const h = hexes[i]!;
    index[(h.r - rMin) * qSpan + (h.q - qMin)] = i;
  }
  return { qMin, rMin, qSpan, rSpan, index, size };
}

export function hexIndexAt(lookup: HexLookup, x: number, y: number): number {
  const fq = ((SQRT3 / 3) * x - y / 3) / lookup.size;
  const fr = ((2 / 3) * y) / lookup.size;
  const fs = -fq - fr;
  let q = Math.floor(fq + 0.5);
  let r = Math.floor(fr + 0.5);
  const s = Math.floor(fs + 0.5);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  const qi = q - lookup.qMin;
  const ri = r - lookup.rMin;
  if (qi < 0 || ri < 0 || qi >= lookup.qSpan || ri >= lookup.rSpan) return -1;
  return lookup.index[ri * lookup.qSpan + qi]!;
}
