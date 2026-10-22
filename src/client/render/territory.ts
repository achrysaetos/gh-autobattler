import { Container, Graphics, Sprite } from 'pixi.js';
import { NEUTRAL, type MapDef } from '../../sim/api.ts';
import { HEX_TEXTURE_RADIUS, type Textures } from './textures.ts';

const FILL_ALPHA = 0.2;
const FADE_OUT_MS = 260;
const FADE_IN_MS = 520;
const BORDER_THROTTLE_MS = 120;
const DIRS: readonly [number, number, number][] = [
  [1, 0, 0],
  [1, -1, -60],
  [0, -1, -120],
  [-1, 0, 180],
  [-1, 1, 120],
  [0, 1, 60],
];

interface Flip {
  index: number;
  from: number;
  to: number;
  start: number;
}

export class TerritoryLayer {
  readonly fills = new Container();
  readonly borders = new Graphics();
  private sprites: Sprite[] = [];
  private shown: Int8Array;
  private neighbors: Int32Array;
  private flips: Flip[] = [];
  private bordersDirty = true;
  private lastBorderAt = 0;
  private borderScale = 1;

  constructor(
    private map: MapDef,
    textures: Textures,
    private colorOf: (faction: number) => number,
  ) {
    const scale = (map.hexSize + 0.4) / HEX_TEXTURE_RADIUS;
    for (const h of map.hexes) {
      const s = new Sprite(textures.hex);
      s.anchor.set(0.5);
      s.position.set(h.x, h.y);
      s.scale.set(scale);
      s.alpha = 0;
      this.fills.addChild(s);
      this.sprites.push(s);
    }
    this.shown = new Int8Array(map.hexes.length).fill(NEUTRAL);
    const index = new Map<number, number>();
    const key = (q: number, r: number) => (q + 2048) * 4096 + (r + 2048);
    map.hexes.forEach((h, i) => index.set(key(h.q, h.r), i));
    this.neighbors = new Int32Array(map.hexes.length * 6).fill(-1);
    map.hexes.forEach((h, i) => {
      DIRS.forEach(([dq, dr], d) => {
        this.neighbors[i * 6 + d] = index.get(key(h.q + dq, h.r + dr)) ?? -1;
      });
    });
  }

  reset(territory: Int8Array): void {
    this.flips = [];
    for (let i = 0; i < territory.length; i++) {
      const owner = territory[i]!;
      this.shown[i] = owner;
      this.paint(i, owner, owner === NEUTRAL ? 0 : FILL_ALPHA);
    }
    this.bordersDirty = true;
  }

  update(territory: Int8Array, now: number, zoom: number): void {
    const scale = Math.min(1, Math.max(0.35, 1.3 / zoom));
    if (Math.abs(scale - this.borderScale) > this.borderScale * 0.15) {
      this.borderScale = scale;
      this.bordersDirty = true;
    }
    for (let i = 0; i < territory.length; i++) {
      const owner = territory[i]!;
      if (owner === this.shown[i]) continue;
      this.flips.push({ index: i, from: this.shown[i]!, to: owner, start: now });
      this.shown[i] = owner;
      this.bordersDirty = true;
    }
    if (this.flips.length) {
      let w = 0;
      for (const f of this.flips) {
        const t = now - f.start;
        if (t < FADE_OUT_MS) {
          this.paint(f.index, f.from, f.from === NEUTRAL ? 0 : FILL_ALPHA * (1 - t / FADE_OUT_MS) + 0.12 * (t / FADE_OUT_MS));
        } else if (t < FADE_OUT_MS + FADE_IN_MS) {
          const k = (t - FADE_OUT_MS) / FADE_IN_MS;
          this.paint(f.index, f.to, f.to === NEUTRAL ? 0 : FILL_ALPHA * k + 0.18 * Math.sin(k * Math.PI));
        } else {
          this.paint(f.index, f.to, f.to === NEUTRAL ? 0 : FILL_ALPHA);
          continue;
        }
        this.flips[w++] = f;
      }
      this.flips.length = w;
    }
    if (this.bordersDirty && now - this.lastBorderAt > BORDER_THROTTLE_MS) {
      this.lastBorderAt = now;
      this.bordersDirty = false;
      this.drawBorders();
    }
  }

  private paint(i: number, owner: number, alpha: number): void {
    const s = this.sprites[i]!;
    if (owner !== NEUTRAL) s.tint = this.colorOf(owner);
    s.alpha = alpha;
  }

  private drawBorders(): void {
    const g = this.borders;
    g.clear();
    const { hexes, hexSize } = this.map;
    const byOwner = new Map<number, number[]>();
    for (let i = 0; i < hexes.length; i++) {
      const owner = this.shown[i]!;
      if (owner === NEUTRAL) continue;
      for (let d = 0; d < 6; d++) {
        const n = this.neighbors[i * 6 + d]!;
        if (n >= 0 && this.shown[n] === owner) continue;
        let list = byOwner.get(owner);
        if (!list) byOwner.set(owner, (list = []));
        list.push(i, d);
      }
    }
    const k = this.borderScale;
    const inset = hexSize - 1.7 * k;
    const edge = (i: number, d: number, r: number) => {
      const h = hexes[i]!;
      const a = (DIRS[d]![2] * Math.PI) / 180;
      const a0 = a - Math.PI / 6;
      const a1 = a + Math.PI / 6;
      g.moveTo(h.x + Math.cos(a0) * r, h.y + Math.sin(a0) * r);
      g.lineTo(h.x + Math.cos(a1) * r, h.y + Math.sin(a1) * r);
    };
    for (const list of byOwner.values()) {
      for (let k = 0; k < list.length; k += 2) edge(list[k]!, list[k + 1]!, hexSize - 0.4);
    }
    g.stroke({ width: 4.2 * k, color: 0x0b0d0c, alpha: 0.38, cap: 'round' });
    for (const [owner, list] of byOwner) {
      for (let k = 0; k < list.length; k += 2) edge(list[k]!, list[k + 1]!, inset);
      g.stroke({ width: 2.2 * k, color: this.colorOf(owner), alpha: 0.95, cap: 'round' });
    }
  }
}
