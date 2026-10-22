import { Application, Container, Graphics, RenderTexture, Sprite, Text, Texture } from 'pixi.js';
import { NEUTRAL, type MapDef, type World } from '../../sim/api.ts';
import type { LockstepRunner } from '../net/runner.ts';
import type { Store } from '../store.ts';
import { objectiveName } from '../names.ts';
import { Camera } from './camera.ts';
import { FxLayer } from './fx.ts';
import { ObjectiveLayer } from './objectives.ts';
import { NEUTRAL_TINT, canvas2d, toCss } from './paint.ts';
import { paintTerrain, type TerrainArt } from './terrain.ts';
import { TerritoryLayer } from './territory.ts';
import { makeTextures, type Textures } from './textures.ts';
import { UnitLayer } from './units.ts';

const MINIMAP_INTERVAL_MS = 100;
const PICK_RADIUS_PX = 16;

interface MapScene {
  key: string;
  map: MapDef;
  art: TerrainArt;
  terrain: Sprite;
  territory: TerritoryLayer;
  objectives: ObjectiveLayer;
  names: { text: Text; x: number; y: number; major: boolean }[];
}

function mapKey(world: World): string {
  return `${world.params.seed}:${world.params.factionCount}:${world.map.radius}:${world.map.hexes.length}`;
}

export class Battlefield {
  private app = new Application();
  private camera!: Camera;
  private textures!: Textures;
  private worldLayer = new Container();
  private groundLayer = new Container();
  private screenLayer = new Container();
  private units!: UnitLayer;
  private fx!: FxLayer;
  private scene: MapScene | null = null;
  private vignette!: Sprite;
  private minimap: HTMLCanvasElement | null = null;
  private minimapAt = 0;
  private lastFrame = performance.now();
  private unsubscribe: (() => void) | null = null;
  private destroyed = false;

  constructor(
    private runner: LockstepRunner,
    private store: Store,
  ) {}

  async mount(host: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: host, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1), background: '#0a0e11', preference: 'webgl' });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    host.appendChild(this.app.canvas);
    this.app.canvas.style.display = 'block';
    this.app.canvas.style.touchAction = 'none';
    this.textures = makeTextures();
    const colorOf = (f: number) => this.colorOf(f);
    this.units = new UnitLayer(this.textures, colorOf);
    this.fx = new FxLayer(this.textures, colorOf, (id) => this.store.players.get(id)?.login ?? null);
    this.worldLayer.addChild(this.groundLayer, this.fx.marks, this.units.shadows, this.units.bodies, this.units.overlay, this.fx.air, this.fx.labels);
    this.vignette = new Sprite(this.vignetteTexture());
    this.app.stage.addChild(this.worldLayer, this.vignette, this.screenLayer);

    this.camera = new Camera(this.app.canvas, {
      onClick: (x, y) => this.pick(x, y),
      onUserPan: () => this.store.setFollowing(false),
    });
    this.unsubscribe = this.runner.onStep((events, world) => {
      const now = performance.now();
      this.fx.ingest(events, world, now, this.camera.bounds(60), (id) => this.units.position(id));
      for (const c of events.captures) this.scene?.objectives.pulse(c.objectiveId, now);
    });
    this.app.ticker.add(() => this.frame());
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe?.();
    this.camera?.destroy();
    if (this.app.renderer) this.app.destroy(true, { children: true, texture: true });
  }

  attachMinimap(canvas: HTMLCanvasElement | null): void {
    this.minimap = canvas;
    if (!canvas) return;
    const go = (e: PointerEvent) => {
      if (!this.scene || (e.type === 'pointermove' && e.buttons === 0)) return;
      const r = canvas.getBoundingClientRect();
      const extent = this.scene.art.extent;
      const x = ((e.clientX - r.left) / r.width) * extent * 2 - extent;
      const y = ((e.clientY - r.top) / r.height) * extent * 2 - extent;
      this.store.setFollowing(false);
      this.camera.panTo(x, y);
    };
    canvas.onpointerdown = (e) => {
      canvas.setPointerCapture(e.pointerId);
      go(e);
    };
    canvas.onpointermove = go;
  }

  focus(x: number, y: number, zoom?: number): void {
    this.camera?.panTo(x, y, zoom);
  }

  overview(): void {
    if (this.scene) this.camera.panTo(0, 0, this.camera.fitZoom(this.scene.map.radius));
  }

  zoomBy(factor: number): void {
    this.camera?.zoomBy(factor);
  }

  private colorOf(faction: number): number {
    if (faction === NEUTRAL) return NEUTRAL_TINT;
    return this.store.factions[faction]?.color ?? NEUTRAL_TINT;
  }

  private vignetteTexture(): Texture {
    const [c, ctx] = canvas2d(512, 512);
    const g = ctx.createRadialGradient(256, 256, 120, 256, 256, 362);
    g.addColorStop(0, 'rgba(8,10,12,0)');
    g.addColorStop(0.7, 'rgba(8,10,12,0.22)');
    g.addColorStop(1, 'rgba(5,6,8,0.72)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    return Texture.from(c);
  }

  private ensureScene(world: World): MapScene {
    const key = mapKey(world);
    if (this.scene && this.scene.key === key) return this.scene;
    if (this.scene) {
      this.groundLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
      this.screenLayer.removeChildren().forEach((c) => c.destroy());
      this.scene.terrain.texture.destroy(true);
    }
    this.units.clear();
    this.fx.clear();
    const map = world.map;
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    const art = paintTerrain(map, world.params.seed, small ? 2048 : 4096);
    const terrain = this.bakeTerrain(map, art);
    const colorOf = (f: number) => this.colorOf(f);
    const territory = new TerritoryLayer(map, this.textures, colorOf);
    territory.reset(world.territory);
    const objectives = new ObjectiveLayer(map.objectives, colorOf);
    this.groundLayer.addChild(terrain, territory.fills, territory.borders, objectives.ground, objectives.glyphs);
    const names = map.objectives.map((def) => {
      const major = def.kind !== 'stronghold';
      const text = new Text({
        text: objectiveName(def, this.store.factions[def.homeFaction]?.name).toUpperCase(),
        style: { fontFamily: 'Cinzel, serif', fontSize: major ? 13 : 11, fontWeight: '700', fill: 0xeadfc4, letterSpacing: 1.6, stroke: { color: 0x0a0c0e, width: 4, join: 'round' } },
        resolution: 2,
      });
      text.anchor.set(0.5, 0);
      this.screenLayer.addChild(text);
      return { text, x: def.x, y: def.y + (def.kind === 'citadel' ? 40 : def.kind === 'base' ? 46 : 26), major };
    });
    this.scene = { key, map, art, terrain, territory, objectives, names };
    this.camera.resize(this.app.screen.width, this.app.screen.height);
    this.camera.fit(map.radius);
    return this.scene;
  }

  private bakeTerrain(map: MapDef, art: TerrainArt): Sprite {
    const size = art.canvas.width;
    const source = Texture.from(art.canvas);
    const holder = new Container();
    holder.addChild(new Sprite(source));
    const grid = new Graphics();
    grid.position.set(art.extent * art.pxPerUnit, art.extent * art.pxPerUnit);
    grid.scale.set(art.pxPerUnit);
    for (const h of map.hexes) {
      for (let i = 0; i < 6; i++) {
        const a = ((60 * i - 30) * Math.PI) / 180;
        const x = h.x + Math.cos(a) * map.hexSize;
        const y = h.y + Math.sin(a) * map.hexSize;
        if (i === 0) grid.moveTo(x, y);
        else grid.lineTo(x, y);
      }
      grid.closePath();
    }
    grid.stroke({ width: 0.8, color: 0x12160a, alpha: 0.16 });
    holder.addChild(grid);
    const rt = RenderTexture.create({ width: size, height: size, autoGenerateMipmaps: true, scaleMode: 'linear' });
    this.app.renderer.render({ container: holder, target: rt });
    rt.source.updateMipmaps();
    holder.destroy({ children: true });
    source.destroy(true);
    const sprite = new Sprite(rt);
    sprite.position.set(-art.extent, -art.extent);
    sprite.scale.set(1 / art.pxPerUnit);
    return sprite;
  }

  private pick(sx: number, sy: number): void {
    const world = this.store.world;
    if (!world) return;
    const p = this.camera.toWorld(sx, sy);
    const reach = PICK_RADIUS_PX / this.camera.zoom;
    let best = reach * reach;
    let playerId: number | null = null;
    for (const u of world.units) {
      if (u.playerId < 0) continue;
      const pos = this.units.position(u.id) ?? u;
      const d = (pos.x - p.x) * (pos.x - p.x) + (pos.y - p.y) * (pos.y - p.y);
      if (d < best) {
        best = d;
        playerId = u.playerId;
      }
    }
    this.store.select(playerId);
  }

  private frame(): void {
    const now = performance.now();
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    this.runner.frame();
    const world = this.store.world;
    if (!world) return;
    const scene = this.ensureScene(world);
    const cam = this.camera;
    cam.resize(this.app.screen.width, this.app.screen.height);

    const selected = this.store.selectedPlayerId;
    if (selected !== null && this.store.following) {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const u of world.units) {
        if (u.playerId !== selected) continue;
        sx += u.x;
        sy += u.y;
        n++;
      }
      if (n) cam.follow(sx / n, sy / n, dt);
    }
    cam.update(dt);

    this.worldLayer.scale.set(cam.zoom);
    this.worldLayer.position.set(cam.width / 2 - cam.x * cam.zoom, cam.height / 2 - cam.y * cam.zoom);
    this.vignette.width = cam.width;
    this.vignette.height = cam.height;

    scene.territory.update(world.territory, now);
    scene.objectives.update(world, now);
    const view = cam.bounds(30);
    this.units.update(world, this.runner.alpha, (id, out) => this.runner.previousPosition(id, out), view, cam.zoom, selected);
    this.fx.update(now);
    this.fx.setLabelScale(cam.zoom);

    for (const n of scene.names) {
      const s = cam.toScreen(n.x, n.y);
      n.text.position.set(Math.round(s.x), Math.round(s.y));
      const visible = n.major ? cam.zoom > 0.28 : cam.zoom > 0.42;
      n.text.visible = visible;
      n.text.alpha = Math.min(1, (cam.zoom - (n.major ? 0.28 : 0.42)) * 6);
    }

    if (this.minimap && now - this.minimapAt > MINIMAP_INTERVAL_MS) {
      this.minimapAt = now;
      this.drawMinimap(this.minimap, world, scene);
    }
  }

  private drawMinimap(canvas: HTMLCanvasElement, world: World, scene: MapScene): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const css = canvas.clientWidth;
    if (css === 0) return;
    if (canvas.width !== Math.round(css * dpr)) {
      canvas.width = Math.round(css * dpr);
      canvas.height = Math.round(css * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    const size = canvas.width;
    const extent = scene.art.extent;
    const k = size / (extent * 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(scene.art.thumb, 0, 0, size, size);
    ctx.setTransform(k, 0, 0, k, extent * k, extent * k);
    const r = scene.map.hexSize * 0.95;
    for (let i = 0; i < scene.map.hexes.length; i++) {
      const owner = world.territory[i]!;
      if (owner === NEUTRAL) continue;
      const h = scene.map.hexes[i]!;
      ctx.fillStyle = toCss(this.colorOf(owner), 0.5);
      ctx.fillRect(h.x - r, h.y - r, r * 2, r * 2);
    }
    for (const def of scene.map.objectives) {
      const owner = world.objectives[def.id]?.owner ?? NEUTRAL;
      ctx.fillStyle = toCss(this.colorOf(owner), 1);
      ctx.strokeStyle = 'rgba(10,10,10,0.9)';
      ctx.lineWidth = 2 / k;
      ctx.beginPath();
      const s = (def.kind === 'citadel' ? 5 : def.kind === 'base' ? 4.5 : 3) / k;
      if (def.kind === 'stronghold') ctx.rect(def.x - s, def.y - s, s * 2, s * 2);
      else ctx.arc(def.x, def.y, s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const cam = this.camera;
    const hw = cam.width / 2 / cam.zoom;
    const hh = cam.height / 2 / cam.zoom;
    ctx.strokeStyle = 'rgba(240,210,138,0.95)';
    ctx.lineWidth = 1.5 / k;
    ctx.strokeRect(cam.x - hw, cam.y - hh, hw * 2, hh * 2);
  }
}
