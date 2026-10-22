import { Container, Sprite, Text, type Texture } from 'pixi.js';
import { NEUTRAL, type TickEvents, type World } from '../../sim/api.ts';
import { NEUTRAL_TINT } from './paint.ts';
import type { Textures } from './textures.ts';

type FxKind = 'arrow' | 'spark' | 'puff' | 'mark' | 'ring' | 'shock' | 'flash';

interface Fx {
  kind: FxKind;
  sprite: Sprite;
  start: number;
  duration: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  size: number;
}

interface Label {
  text: Text;
  start: number;
  x: number;
  y: number;
}

const CAPS: Record<FxKind, number> = { arrow: 500, spark: 260, puff: 220, mark: 700, ring: 40, shock: 16, flash: 16 };
const LABEL_MS = 2600;
const MAX_LABELS = 10;

type Animate = (fx: Fx, t: number) => void;

const ANIMATE: Record<FxKind, Animate> = {
  arrow(fx, t) {
    const dx = fx.x1 - fx.x0;
    const dy = fx.y1 - fx.y0;
    const h = fx.size;
    const x = fx.x0 + dx * t;
    const y = fx.y0 + dy * t - h * 4 * t * (1 - t);
    fx.sprite.position.set(x, y);
    fx.sprite.rotation = Math.atan2(dy - h * 4 * (1 - 2 * t), dx);
    fx.sprite.alpha = t < 0.85 ? 1 : (1 - t) / 0.15;
  },
  spark(fx, t) {
    fx.sprite.scale.set(fx.size * (0.4 + t * 0.8));
    fx.sprite.alpha = 1 - t;
    fx.sprite.rotation = t * 2;
  },
  puff(fx, t) {
    fx.sprite.scale.set(fx.size * (0.5 + t * 1.2));
    fx.sprite.alpha = 0.55 * (1 - t) * (1 - t);
    fx.sprite.position.set(fx.x0, fx.y0 - t * 6);
  },
  mark(fx, t) {
    fx.sprite.alpha = 0.5 * (t < 0.7 ? 1 : (1 - t) / 0.3);
  },
  ring(fx, t) {
    const e = 1 - (1 - t) * (1 - t);
    fx.sprite.scale.set((fx.size * (0.25 + e)) / 56);
    fx.sprite.alpha = 0.9 * (1 - t);
  },
  shock(fx, t) {
    const e = 1 - (1 - t) * (1 - t) * (1 - t);
    fx.sprite.scale.set((fx.size * (0.2 + e * 1.0)) / 56);
    fx.sprite.alpha = 1 - t;
  },
  flash(fx, t) {
    fx.sprite.scale.set((fx.size * (0.6 + t * 0.8)) / 32);
    fx.sprite.alpha = 0.8 * (1 - t);
  },
};

export class FxLayer {
  readonly marks = new Container();
  readonly air = new Container();
  readonly labels = new Container();
  private active: Fx[] = [];
  private counts: Record<FxKind, number> = { arrow: 0, spark: 0, puff: 0, mark: 0, ring: 0, shock: 0, flash: 0 };
  private pools: Record<FxKind, Sprite[]> = { arrow: [], spark: [], puff: [], mark: [], ring: [], shock: [], flash: [] };
  private labelList: Label[] = [];
  private labelPool: Text[] = [];
  private byId = new Map<number, { x: number; y: number; faction: number }>();

  constructor(
    private textures: Textures,
    private colorOf: (faction: number) => number,
    private loginOf: (playerId: number) => string | null,
  ) {}

  ingest(events: TickEvents, world: World, now: number, view: { contains(x: number, y: number): boolean }, position: (id: number) => { x: number; y: number } | undefined): void {
    const byId = this.byId;
    byId.clear();
    for (const u of world.units) byId.set(u.id, { x: u.x, y: u.y, faction: u.faction });
    const at = (id: number) => {
      const p = position(id);
      const u = byId.get(id);
      return p && u ? { x: p.x, y: p.y, faction: u.faction } : u;
    };

    for (const a of events.attacks) {
      const from = at(a.from);
      const to = at(a.to);
      if (!from || !to || !(view.contains(from.x, from.y) || view.contains(to.x, to.y))) continue;
      if (a.ranged) {
        const d = Math.hypot(to.x - from.x, to.y - from.y);
        this.spawn('arrow', now, 180 + d * 4.2, from.x, from.y, to.x + (Math.random() - 0.5) * 3, to.y + (Math.random() - 0.5) * 3, d * 0.22, 0xf4ead2);
      } else if (Math.random() < 0.6) {
        this.spawn('spark', now, 200, (from.x + to.x * 2) / 3, (from.y + to.y * 2) / 3, 0, 0, 0.22 + Math.random() * 0.12, Math.random() < 0.5 ? 0xffe2a0 : 0xffffff);
      }
    }
    for (const d of events.deaths) {
      const color = d.faction === NEUTRAL ? NEUTRAL_TINT : this.colorOf(d.faction);
      this.spawn('mark', now, 14_000, d.x, d.y, 0, 0, 0.32 + Math.random() * 0.12, 0x2a1a10, Math.random() * 6);
      if (view.contains(d.x, d.y)) this.spawn('puff', now, 700, d.x, d.y, 0, 0, 0.34, mixGrey(color));
    }
    const musters = new Map<number, { count: number; x: number; y: number; faction: number }>();
    for (const s of events.spawns) {
      const u = byId.get(s.unitId);
      if (!u) continue;
      const m = musters.get(s.playerId);
      if (m) m.count++;
      else musters.set(s.playerId, { count: 1, x: u.x, y: u.y, faction: u.faction });
    }
    for (const [playerId, m] of musters) {
      const color = this.colorOf(m.faction);
      this.spawn('ring', now, 1100, m.x, m.y, 0, 0, 30 + Math.min(40, m.count * 2), color);
      const login = this.loginOf(playerId);
      if (m.count >= 3 && login) this.label(`+${m.count} · @${login}`, color, m.x, m.y, now);
    }
    for (const c of events.captures) {
      const def = world.map.objectives[c.objectiveId];
      if (!def) continue;
      const color = this.colorOf(c.faction);
      this.spawn('shock', now, 1300, def.x, def.y, 0, 0, def.radius * 3.2, color);
      this.spawn('shock', now + 160, 1100, def.x, def.y, 0, 0, def.radius * 2, 0xfff2d0);
      this.spawn('flash', now, 600, def.x, def.y, 0, 0, def.radius * 0.9, 0xfff2d0);
    }
  }

  update(now: number): void {
    let w = 0;
    for (const fx of this.active) {
      const t = (now - fx.start) / fx.duration;
      if (t < 0) {
        fx.sprite.visible = false;
        this.active[w++] = fx;
        continue;
      }
      if (t >= 1) {
        this.release(fx);
        continue;
      }
      fx.sprite.visible = true;
      ANIMATE[fx.kind](fx, t);
      this.active[w++] = fx;
    }
    this.active.length = w;

    let lw = 0;
    for (const l of this.labelList) {
      const t = (now - l.start) / LABEL_MS;
      if (t >= 1) {
        l.text.visible = false;
        this.labelPool.push(l.text);
        continue;
      }
      l.text.alpha = t < 0.1 ? t / 0.1 : t > 0.7 ? (1 - t) / 0.3 : 1;
      l.text.position.set(l.x, l.y - 18 - t * 22);
      this.labelList[lw++] = l;
    }
    this.labelList.length = lw;
  }

  setLabelScale(zoom: number): void {
    const s = 1 / Math.max(0.35, zoom);
    for (const l of this.labelList) l.text.scale.set(s);
  }

  clear(): void {
    for (const fx of this.active) this.release(fx);
    this.active.length = 0;
  }

  private label(text: string, color: number, x: number, y: number, now: number): void {
    if (this.labelList.length >= MAX_LABELS) return;
    let t = this.labelPool.pop();
    if (!t) {
      t = new Text({
        text,
        style: { fontFamily: 'Cinzel, serif', fontSize: 15, fontWeight: '700', fill: 0xf3ead2, stroke: { color: 0x0b0d0f, width: 4 }, letterSpacing: 0.5 },
        resolution: 2,
      });
      t.anchor.set(0.5, 1);
      this.labels.addChild(t);
    }
    t.text = text;
    t.style.fill = color;
    t.visible = true;
    this.labelList.push({ text: t, start: now, x, y });
  }

  private spawn(kind: FxKind, now: number, duration: number, x0: number, y0: number, x1: number, y1: number, size: number, tint: number, rotation = 0): void {
    if (this.counts[kind] >= CAPS[kind]) {
      if (kind !== 'mark') return;
      const oldest = this.active.find((f) => f.kind === 'mark');
      if (oldest) oldest.start = -1e12;
      return;
    }
    let sprite = this.pools[kind].pop();
    if (!sprite) {
      sprite = new Sprite(this.textureFor(kind));
      sprite.anchor.set(0.5);
      if (kind === 'spark' || kind === 'flash') sprite.blendMode = 'add';
      (kind === 'mark' ? this.marks : this.air).addChild(sprite);
    }
    sprite.tint = tint;
    sprite.position.set(x0, y0);
    sprite.rotation = rotation;
    sprite.alpha = 0;
    sprite.visible = false;
    if (kind === 'mark') sprite.scale.set(size);
    if (kind === 'arrow') sprite.scale.set(0.42);
    this.counts[kind]++;
    this.active.push({ kind, sprite, start: now, duration, x0, y0, x1, y1, size });
  }

  private release(fx: Fx): void {
    fx.sprite.visible = false;
    this.counts[fx.kind]--;
    this.pools[fx.kind].push(fx.sprite);
  }

  private textureFor(kind: FxKind): Texture {
    const t = this.textures;
    switch (kind) {
      case 'arrow':
        return t.arrow;
      case 'spark':
        return t.spark;
      case 'puff':
      case 'flash':
        return t.soft;
      case 'mark':
        return t.mark;
      case 'ring':
      case 'shock':
        return t.ring;
    }
  }
}

function mixGrey(color: number): number {
  const r = (((color >> 16) & 255) + 170) / 2;
  const g = (((color >> 8) & 255) + 160) / 2;
  const b = ((color & 255) + 140) / 2;
  return (r << 16) | (g << 8) | b;
}
