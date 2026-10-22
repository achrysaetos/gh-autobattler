import { Container, Graphics, Sprite } from 'pixi.js';
import { NEUTRAL, UnitKind, type Unit, type World } from '../../sim/api.ts';
import { GOLD, NEUTRAL_TINT } from './paint.ts';
import { UNIT_TEXTURE_PX, type Textures } from './textures.ts';

const WORLD_SIZE: Record<UnitKind, number> = { [UnitKind.Infantry]: 9, [UnitKind.Archer]: 8.5, [UnitKind.Cavalry]: 11.5 };
const HEALTH_ZOOM = 1.6;
const TURN_RATE = 0.25;

interface UnitSprite {
  body: Sprite;
  shadow: Sprite;
  angle: number;
  seen: number;
  kind: UnitKind;
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type PreviousPosition = (unitId: number, out: { x: number; y: number }) => boolean;

export class UnitLayer {
  readonly shadows = new Container();
  readonly bodies = new Container();
  readonly overlay = new Graphics();
  private live = new Map<number, UnitSprite>();
  private pool: UnitSprite[] = [];
  private frame = 0;
  private prev = { x: 0, y: 0 };
  private byId = new Map<number, Unit>();

  constructor(
    private textures: Textures,
    private colorOf: (faction: number) => number,
  ) {}

  position(unitId: number): { x: number; y: number } | undefined {
    return this.live.get(unitId);
  }

  update(world: World, alpha: number, previous: PreviousPosition, view: Bounds, zoom: number, selectedPlayerId: number | null): void {
    const frame = ++this.frame;
    const byId = this.byId;
    byId.clear();
    for (const u of world.units) byId.set(u.id, u);
    const prev = this.prev;
    const overlay = this.overlay;
    overlay.clear();
    const showHealth = zoom >= HEALTH_ZOOM;
    let selected = 0;

    for (const u of world.units) {
      let s = this.live.get(u.id);
      if (!s) s = this.acquire(u);
      s.seen = frame;
      let x = u.x;
      let y = u.y;
      if (previous(u.id, prev)) {
        x = prev.x + (u.x - prev.x) * alpha;
        y = prev.y + (u.y - prev.y) * alpha;
      }
      const dx = x - s.x;
      const dy = y - s.y;
      let desired = s.angle;
      const target = u.targetUnitId >= 0 ? byId.get(u.targetUnitId) : undefined;
      if (target) desired = Math.atan2(target.y - y, target.x - x);
      else if (dx * dx + dy * dy > 0.0004) desired = Math.atan2(dy, dx);
      let delta = desired - s.angle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      else if (delta < -Math.PI) delta += Math.PI * 2;
      s.angle += delta * TURN_RATE;
      s.x = x;
      s.y = y;
      s.body.position.set(x, y);
      s.body.rotation = s.angle;
      s.shadow.position.set(x + 1.2, y + 1.8);

      if (x < view.minX || x > view.maxX || y < view.minY || y > view.maxY) continue;
      if (selectedPlayerId !== null && u.playerId === selectedPlayerId) {
        overlay.circle(x, y, WORLD_SIZE[u.kind] * 0.62);
        selected++;
      }
    }
    if (selected) overlay.stroke({ width: 1.1, color: GOLD, alpha: 0.9 });

    if (showHealth) {
      for (const u of world.units) {
        if (u.hp >= u.maxHp) continue;
        const s = this.live.get(u.id)!;
        if (s.x < view.minX || s.x > view.maxX || s.y < view.minY || s.y > view.maxY) continue;
        overlay.rect(s.x - 5, s.y - 9.5, 10, 2).fill({ color: 0x0b0b0a, alpha: 0.75 });
      }
      for (const u of world.units) {
        if (u.hp >= u.maxHp) continue;
        const s = this.live.get(u.id)!;
        if (s.x < view.minX || s.x > view.maxX || s.y < view.minY || s.y > view.maxY) continue;
        const k = Math.max(0, u.hp / u.maxHp);
        overlay.rect(s.x - 4.6, s.y - 9.1, 9.2 * k, 1.2).fill(k > 0.5 ? 0x9fd06a : k > 0.25 ? 0xe2b33c : 0xe0523e);
      }
    }

    for (const [id, s] of this.live) {
      if (s.seen === frame) continue;
      this.live.delete(id);
      s.body.visible = false;
      s.shadow.visible = false;
      this.pool.push(s);
    }
  }

  clear(): void {
    for (const [id, s] of this.live) {
      s.body.visible = false;
      s.shadow.visible = false;
      this.pool.push(s);
      this.live.delete(id);
    }
  }

  private acquire(u: Unit): UnitSprite {
    let s = this.pool.pop();
    if (!s) {
      const body = new Sprite(this.textures.units[u.kind]);
      body.anchor.set(0.5);
      const shadow = new Sprite(this.textures.shadow);
      shadow.anchor.set(0.5);
      this.bodies.addChild(body);
      this.shadows.addChild(shadow);
      s = { body, shadow, angle: 0, seen: 0, kind: u.kind, x: u.x, y: u.y };
    }
    s.kind = u.kind;
    s.body.texture = this.textures.units[u.kind];
    const size = WORLD_SIZE[u.kind];
    s.body.scale.set(size / (UNIT_TEXTURE_PX * 0.85));
    s.shadow.scale.set((size * 1.25) / 64, (size * 0.95) / 64);
    s.body.tint = u.faction === NEUTRAL ? NEUTRAL_TINT : this.colorOf(u.faction);
    s.body.visible = true;
    s.shadow.visible = true;
    s.x = u.x;
    s.y = u.y;
    s.angle = Math.atan2(-u.y, -u.x);
    this.live.set(u.id, s);
    return s;
  }
}
