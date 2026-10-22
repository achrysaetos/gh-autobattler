import { Container, Graphics } from 'pixi.js';
import { NEUTRAL, type ObjectiveDef, type World } from '../../sim/api.ts';
import { GOLD, NEUTRAL_TINT, shade } from './paint.ts';

const OUTLINE = 0x16130f;
const STONE = 0xcdbf9c;
const STONE_SIDE = 0x968969;
const PULSE_MS = 800;

interface ObjectiveSprite {
  def: ObjectiveDef;
  root: Container;
  zone: Graphics;
  banner: Graphics;
  ring: Graphics;
  owner: number;
  pulseAt: number;
}

function dashedCircle(g: Graphics, r: number, dashes: number): void {
  const step = (Math.PI * 2) / dashes;
  for (let i = 0; i < dashes; i++) {
    const a0 = i * step;
    g.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
    g.arc(0, 0, r, a0, a0 + step * 0.55);
  }
}

function pennant(g: Graphics, top: number, length: number, color: number): void {
  g.moveTo(0, top + 16).lineTo(0, top).stroke({ width: 1.6, color: 0x2a231a });
  g.poly([0.6, top, length, top + 3.5, 0.6, top + 7.5]).fill(color).stroke({ width: 1, color: OUTLINE });
}

function swallowtail(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.poly([x, y, x + w, y, x + w - w * 0.22, y + h / 2, x + w, y + h, x, y + h]).fill(color).stroke({ width: 1.2, color: GOLD });
}

function drawStronghold(g: Graphics): void {
  g.circle(0, 0, 19).fill({ color: 0x221e18, alpha: 0.55 }).stroke({ width: 1.4, color: 0x8f826a, alpha: 0.8 });
  g.poly([-9, 9, 9, 9, 12, 12, -6, 12]).fill({ color: 0x000000, alpha: 0.35 });
  g.rect(-8, -8, 16, 17).fill(STONE).stroke({ width: 1.4, color: OUTLINE });
  g.rect(3, -8, 5, 17).fill(STONE_SIDE);
  for (const x of [-8, -2.5, 3]) g.rect(x, -12, 5, 4).fill(STONE).stroke({ width: 1.2, color: OUTLINE });
  g.roundRect(-2.5, 2, 5, 7, 2).fill(0x2a231b);
  g.rect(-8, -8, 16, 17).stroke({ width: 1.4, color: OUTLINE });
}

function drawCitadel(g: Graphics): void {
  g.circle(0, 0, 36).fill({ color: 0x221e18, alpha: 0.55 }).stroke({ width: 1.6, color: 0xa8976f, alpha: 0.8 });
  const oct = (r: number) => Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? Math.cos(((Math.floor(i / 2) + 0.5) * Math.PI) / 4) * r : Math.sin(((Math.floor(i / 2) + 0.5) * Math.PI) / 4) * r));
  g.poly(oct(26).map((v, i) => v + (i % 2 === 0 ? 3 : 4))).fill({ color: 0x000000, alpha: 0.35 });
  g.poly(oct(26)).fill(STONE).stroke({ width: 1.6, color: OUTLINE });
  g.poly(oct(19)).fill(0x6c624f).stroke({ width: 1.2, color: OUTLINE });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const x = Math.cos(a) * 25;
    const y = Math.sin(a) * 25;
    g.circle(x + 1.5, y + 2, 6.5).fill({ color: 0x000000, alpha: 0.3 });
    g.circle(x, y, 6.5).fill(STONE).stroke({ width: 1.4, color: OUTLINE });
    g.circle(x, y, 3.2).fill(STONE_SIDE);
  }
  g.rect(-9, -10, 18, 19).fill(STONE).stroke({ width: 1.4, color: OUTLINE });
  g.rect(3, -10, 6, 19).fill(STONE_SIDE);
  for (const x of [-9, -3, 3]) g.rect(x, -14, 6, 4).fill(STONE).stroke({ width: 1.1, color: OUTLINE });
  g.roundRect(-3, 2, 6, 7, 2.5).fill(0x2a231b);
}

function drawCamp(g: Graphics, color: number, gate: number): void {
  const inGate = (a: number) => Math.abs(Math.atan2(Math.sin(a - gate), Math.cos(a - gate))) < 0.28;
  g.circle(0, 0, 42).fill({ color: 0x3a3022, alpha: 0.4 });
  const stakes = 44;
  for (let i = 0; i < stakes; i++) {
    const a = (i / stakes) * Math.PI * 2;
    if (inGate(a)) continue;
    const c = Math.cos(a);
    const s = Math.sin(a);
    g.moveTo(c * 33, s * 33).lineTo(c * 40, s * 40);
  }
  g.stroke({ width: 4.2, color: OUTLINE, cap: 'round' });
  for (let i = 0; i < stakes; i++) {
    const a = (i / stakes) * Math.PI * 2;
    if (inGate(a)) continue;
    const c = Math.cos(a);
    const s = Math.sin(a);
    g.moveTo(c * 33.5, s * 33.5).lineTo(c * 39.5, s * 39.5);
  }
  g.stroke({ width: 2.4, color: 0x8a6a44, cap: 'round' });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const x = Math.cos(a) * 21;
    const y = Math.sin(a) * 21;
    g.poly([x - 6, y + 4, x, y - 6, x + 6, y + 4]).fill(shade(color, -0.25)).stroke({ width: 1.2, color: OUTLINE });
    g.poly([x, y - 6, x + 6, y + 4, x + 1.5, y + 4]).fill(shade(color, -0.5));
  }
  g.circle(0, 0, 7).fill({ color: 0x000000, alpha: 0.3 });
  g.moveTo(0, 2).lineTo(0, -32).stroke({ width: 2.2, color: 0x2a231a });
  g.circle(0, -33, 1.8).fill(GOLD);
  swallowtail(g, 1, -31, 20, 14, color);
}

export class ObjectiveLayer {
  readonly ground = new Container();
  readonly glyphs = new Container();
  private items: ObjectiveSprite[] = [];

  constructor(
    defs: readonly ObjectiveDef[],
    private colorOf: (faction: number) => number,
  ) {
    for (const def of defs) {
      const zone = new Graphics();
      zone.position.set(def.x, def.y);
      this.ground.addChild(zone);
      const root = new Container();
      root.position.set(def.x, def.y);
      const body = new Graphics();
      if (def.kind === 'stronghold') drawStronghold(body);
      else if (def.kind === 'citadel') drawCitadel(body);
      else drawCamp(body, colorOf(def.homeFaction), Math.atan2(-def.y, -def.x));
      const banner = new Graphics();
      const ring = new Graphics();
      root.addChild(body, banner, ring);
      root.scale.set(def.kind === 'stronghold' ? 1.25 : 1);
      this.glyphs.addChild(root);
      this.items.push({ def, root, zone, banner, ring, owner: -2, pulseAt: -1e9 });
    }
  }

  pulse(objectiveId: number, now: number): void {
    const item = this.items[objectiveId];
    if (item) item.pulseAt = now;
  }

  update(world: World, now: number): void {
    for (const item of this.items) {
      const state = world.objectives[item.def.id];
      if (!state) continue;
      if (state.owner !== item.owner) {
        item.owner = state.owner;
        this.redrawOwner(item);
      }
      const t = (now - item.pulseAt) / PULSE_MS;
      const base = item.def.kind === 'stronghold' ? 1.25 : 1;
      item.root.scale.set(t >= 0 && t < 1 ? base * (1 + 0.35 * Math.sin(t * Math.PI) * (1 - t)) : base);
      const ring = item.ring;
      ring.clear();
      if (item.def.kind !== 'base' && state.progress > 0 && state.capturer !== NEUTRAL) {
        const r = (item.def.kind === 'citadel' ? 44 : 27) / (item.def.kind === 'stronghold' ? 1.25 : 1);
        const p = Math.min(1, Math.max(0, state.progress));
        ring.circle(0, 0, r).stroke({ width: 5, color: 0x0b0d0c, alpha: 0.55 });
        ring.moveTo(0, -r).arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p).stroke({ width: 3.4, color: this.colorOf(state.capturer), cap: 'round' });
        const blink = 0.5 + 0.5 * Math.sin(now / 140);
        ring.circle(0, 0, r + 4).stroke({ width: 1, color: this.colorOf(state.capturer), alpha: 0.25 + 0.35 * blink });
      }
    }
  }

  private redrawOwner(item: ObjectiveSprite): void {
    const { def, owner } = item;
    const color = owner === NEUTRAL ? NEUTRAL_TINT : this.colorOf(owner);
    const zone = item.zone;
    zone.clear();
    if (def.kind !== 'base') {
      dashedCircle(zone, def.radius, def.kind === 'citadel' ? 40 : 28);
      zone.stroke({ width: 1.6, color, alpha: owner === NEUTRAL ? 0.35 : 0.7 });
      if (owner !== NEUTRAL) zone.circle(0, 0, def.radius).fill({ color, alpha: 0.07 });
    }
    const b = item.banner;
    b.clear();
    if (def.kind === 'stronghold') pennant(b, -28, 13, color);
    else if (def.kind === 'citadel') {
      b.moveTo(0, -13).lineTo(0, -44).stroke({ width: 2.2, color: 0x2a231a });
      b.circle(0, -45, 2).fill(GOLD);
      swallowtail(b, 1, -43, 24, 15, color);
    }
  }
}
