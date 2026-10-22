import { Terrain, type MapDef } from './api.ts';

export interface FlowField {
  // Integer path cost to the objective (10 per plain cell), -1 when unreachable.
  cost: Int32Array;
  // Next cell toward the objective, -1 at the goal or when unreachable.
  next: Int32Array;
}

const STRAIGHT = 10;
const DIAGONAL = 14;
const FOREST_STRAIGHT = 17;
const FOREST_DIAGONAL = 24;

export function isPassable(t: number): boolean {
  return t === Terrain.Plain || t === Terrain.Forest;
}

export function cellAt(map: MapDef, x: number, y: number): number {
  const cx = Math.floor((x - map.originX) / map.navCell);
  const cy = Math.floor((y - map.originY) / map.navCell);
  if (cx < 0 || cy < 0 || cx >= map.navCols || cy >= map.navRows) return -1;
  return cy * map.navCols + cx;
}

export function cellCenterX(map: MapDef, cell: number): number {
  return map.originX + ((cell % map.navCols) + 0.5) * map.navCell;
}

export function cellCenterY(map: MapDef, cell: number): number {
  return map.originY + (Math.floor(cell / map.navCols) + 0.5) * map.navCell;
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

// Dijkstra outward from the goal; `next` points each cell one step back toward it.
// Diagonals may not cut a blocked corner, so units never clip through rock.
export function buildFlowField(map: MapDef, goalCell: number): FlowField {
  const { navCols: cols, navRows: rows, terrain } = map;
  const n = cols * rows;
  const cost = new Int32Array(n).fill(-1);
  const next = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new MinHeap(n);
  if (goalCell < 0 || !isPassable(terrain[goalCell]!)) return { cost, next };
  cost[goalCell] = 0;
  heap.push(goalCell, 0);
  while (heap.size > 0) {
    const c = heap.pop();
    if (done[c]) continue;
    done[c] = 1;
    const cx = c % cols;
    const cy = (c - cx) / cols;
    const base = cost[c]!;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k]!;
      const ny = cy + DY[k]!;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nc = ny * cols + nx;
      if (done[nc] || !isPassable(terrain[nc]!)) continue;
      const diagonal = k >= 4;
      if (diagonal && (!isPassable(terrain[cy * cols + nx]!) || !isPassable(terrain[ny * cols + cx]!))) continue;
      const forest = terrain[nc] === Terrain.Forest;
      const step = diagonal ? (forest ? FOREST_DIAGONAL : DIAGONAL) : forest ? FOREST_STRAIGHT : STRAIGHT;
      const nd = base + step;
      if (cost[nc] === -1 || nd < cost[nc]!) {
        cost[nc] = nd;
        next[nc] = c;
        heap.push(nc, nd);
      }
    }
  }
  return { cost, next };
}

class MinHeap {
  private items: Int32Array;
  private keys: Int32Array;
  size = 0;
  constructor(capacity: number) {
    this.items = new Int32Array(capacity * 4 + 16);
    this.keys = new Int32Array(capacity * 4 + 16);
  }
  push(item: number, key: number): void {
    if (this.size === this.items.length) this.grow();
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(p, key, item)) break;
      this.items[i] = this.items[p]!;
      this.keys[i] = this.keys[p]!;
      i = p;
    }
    this.items[i] = item;
    this.keys[i] = key;
  }
  pop(): number {
    const top = this.items[0]!;
    const lastItem = this.items[--this.size]!;
    const lastKey = this.keys[this.size]!;
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.lessIdx(child + 1, child)) child++;
      if (this.less(child, lastKey, lastItem)) {
        this.items[i] = this.items[child]!;
        this.keys[i] = this.keys[child]!;
        i = child;
      } else break;
    }
    this.items[i] = lastItem;
    this.keys[i] = lastKey;
    return top;
  }
  private less(idx: number, key: number, item: number): boolean {
    const k = this.keys[idx]!;
    return k < key || (k === key && this.items[idx]! < item);
  }
  private lessIdx(a: number, b: number): boolean {
    return this.less(a, this.keys[b]!, this.items[b]!);
  }
  private grow(): void {
    const items = new Int32Array(this.items.length * 2);
    const keys = new Int32Array(this.keys.length * 2);
    items.set(this.items);
    keys.set(this.keys);
    this.items = items;
    this.keys = keys;
  }
}
