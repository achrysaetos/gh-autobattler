import { Terrain, type MapDef } from '../../sim/api.ts';
import { canvas2d, fbm, noise, seeded, smoothstep } from './paint.ts';

export const SEA_MARGIN = 320;

export interface TerrainArt {
  canvas: HTMLCanvasElement;
  thumb: HTMLCanvasElement;
  extent: number;
  pxPerUnit: number;
}

function mask(map: MapDef, kind: number): Float32Array {
  const { navCols: w, navRows: h, terrain } = map;
  let a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = terrain[i] === kind ? 1 : 0;
  let b = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            s += a[yy * w + xx]!;
            n++;
          }
        }
        b[y * w + x] = s / n;
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

function sampler(map: MapDef, field: Float32Array): (x: number, y: number) => number {
  const { navCols: w, navRows: h, navCell, originX, originY } = map;
  return (x, y) => {
    const fx = (x - originX) / navCell - 0.5;
    const fy = (y - originY) / navCell - 0.5;
    const x0 = Math.max(0, Math.min(w - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(h - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - x0));
    const ty = Math.max(0, Math.min(1, fy - y0));
    const i = y0 * w + x0;
    const a = field[i]!;
    const b = field[i + 1]!;
    const c = field[i + w]!;
    const d = field[i + w + 1]!;
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

type Rgb = [number, number, number];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const GRASS_DARK: Rgb = [58, 66, 38];
const GRASS: Rgb = [84, 92, 54];
const GRASS_LIGHT: Rgb = [108, 112, 66];
const GRASS_DRY: Rgb = [122, 112, 70];
const FOREST_FLOOR: Rgb = [42, 50, 30];
const ROCK: Rgb = [112, 108, 100];
const ROCK_DARK: Rgb = [70, 67, 62];
const MUD: Rgb = [86, 80, 54];
const SHALLOW: Rgb = [64, 116, 110];
const DEEP: Rgb = [20, 56, 64];
const FOAM: Rgb = [150, 176, 162];
const SEA: Rgb = [12, 22, 28];
const SEA_NEAR: Rgb = [24, 50, 56];
const CLIFF: Rgb = [64, 58, 40];

export function paintTerrain(map: MapDef, seed: number, maxPx: number): TerrainArt {
  const R = map.radius;
  const extent = R + SEA_MARGIN;
  const world = extent * 2;
  const pxPerUnit = Math.min(1.6, maxPx / world);
  const size = Math.ceil(world * pxPerUnit);
  const [canvas, ctx] = canvas2d(size, size);

  const forest = sampler(map, mask(map, Terrain.Forest));
  const water = sampler(map, mask(map, Terrain.Water));
  const rock = sampler(map, mask(map, Terrain.Rock));

  const fw = Math.min(1300, Math.ceil(size * 0.5));
  const [field, fctx] = canvas2d(fw, fw);
  const img = fctx.createImageData(fw, fw);
  const data = img.data;
  const unitPerField = world / fw;
  for (let py = 0; py < fw; py++) {
    const y = -extent + (py + 0.5) * unitPerField;
    for (let px = 0; px < fw; px++) {
      const x = -extent + (px + 0.5) * unitPerField;
      const d = Math.sqrt(x * x + y * y);
      let c: Rgb;
      const n1 = fbm(x / 160, y / 160, seed, 4);
      const n2 = noise(x / 18, y / 18, seed + 7);
      if (d > R) {
        const waves = fbm(x / 60, y / 220, seed + 41, 3);
        c = mix(SEA_NEAR, SEA, smoothstep(R, R + 140, d));
        c = mix(c, [c[0] + 10, c[1] + 14, c[2] + 16], waves * 0.6);
        const foam = 1 - smoothstep(0, 9 + n2 * 6, d - R);
        c = mix(c, FOAM, foam * 0.55);
        const fade = smoothstep(R + 40, extent, d);
        c = mix(c, [6, 9, 12], fade * 0.85);
      } else {
        c = mix(GRASS, GRASS_LIGHT, smoothstep(0.42, 0.75, n1));
        c = mix(c, GRASS_DARK, smoothstep(0.5, 0.2, n1) * 0.8);
        c = mix(c, GRASS_DRY, smoothstep(0.62, 0.8, fbm(x / 300 + 9, y / 300, seed + 3, 3)) * 0.55);
        c = mix(c, [c[0] * 0.9, c[1] * 0.92, c[2] * 0.86], n2 * 0.6);
        const fm = forest(x, y) + (n2 - 0.5) * 0.2;
        c = mix(c, FOREST_FLOOR, smoothstep(0.25, 0.6, fm) * 0.85);
        const rm = rock(x, y) + (n1 - 0.5) * 0.3 + (n2 - 0.5) * 0.12;
        const rockT = smoothstep(0.4, 0.5, rm);
        if (rockT > 0) {
          const rc = mix(ROCK_DARK, ROCK, smoothstep(0.3, 0.75, noise(x / 9, y / 9, seed + 5)));
          c = mix(c, rc, rockT);
          c = mix(c, [40, 38, 34], (smoothstep(0.38, 0.44, rm) - smoothstep(0.44, 0.5, rm)) * 0.6);
        }
        const wm = water(x, y) + (n1 - 0.5) * 0.22 + (n2 - 0.5) * 0.05;
        c = mix(c, MUD, smoothstep(0.3, 0.42, wm) * 0.8);
        const wt = smoothstep(0.43, 0.47, wm);
        if (wt > 0) {
          let wc = mix(SHALLOW, DEEP, smoothstep(0.5, 0.95, wm));
          wc = mix(wc, FOAM, (smoothstep(0.42, 0.46, wm) - smoothstep(0.47, 0.53, wm)) * 0.45);
          wc = mix(wc, [wc[0] + 14, wc[1] + 18, wc[2] + 18], noise(x / 30, y / 6, seed + 11) * 0.35);
          c = mix(c, wc, wt);
        }
        c = mix(c, CLIFF, smoothstep(R - 22, R - 2, d) * 0.85);
      }
      const o = (py * fw + px) * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 255;
    }
  }
  fctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(field, 0, 0, size, size);

  ctx.setTransform(pxPerUnit, 0, 0, pxPerUnit, extent * pxPerUnit, extent * pxPerUnit);
  const rand = seeded(seed ^ 0x5bd1e995);
  const terrainAt = (x: number, y: number) => {
    const col = Math.floor((x - map.originX) / map.navCell);
    const row = Math.floor((y - map.originY) / map.navCell);
    if (col < 0 || row < 0 || col >= map.navCols || row >= map.navRows) return Terrain.Void;
    return map.terrain[row * map.navCols + col]!;
  };

  for (const o of map.objectives) {
    const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.radius * 1.5);
    g.addColorStop(0, 'rgba(118,100,66,0.55)');
    g.addColorStop(0.6, 'rgba(110,94,62,0.3)');
    g.addColorStop(1, 'rgba(110,94,62,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.radius * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  paintRoads(ctx, map, seed, terrainAt);

  const area = Math.PI * R * R;
  for (let i = 0; i < area / 55; i++) {
    const x = (rand() * 2 - 1) * R;
    const y = (rand() * 2 - 1) * R;
    if (x * x + y * y > (R - 24) * (R - 24) || terrainAt(x, y) !== Terrain.Plain) continue;
    const light = rand() < 0.5;
    ctx.strokeStyle = light ? 'rgba(150,150,92,0.22)' : 'rgba(34,40,20,0.22)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 2, y - 1.5 - rand() * 2.5);
    ctx.stroke();
  }

  for (let row = 0; row < map.navRows; row++) {
    for (let col = 0; col < map.navCols; col++) {
      if (map.terrain[row * map.navCols + col] !== Terrain.Rock || rand() < 0.35) continue;
      const x = map.originX + (col + rand()) * map.navCell;
      const y = map.originY + (row + rand()) * map.navCell;
      const r = 2 + rand() * 4;
      ctx.fillStyle = 'rgba(30,28,26,0.45)';
      ctx.beginPath();
      ctx.ellipse(x + 1.2, y + 1.6, r, r * 0.7, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${150 + rand() * 30},${146 + rand() * 26},${136 + rand() * 20},0.55)`;
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x - r * 0.2, y - r * 0.8);
      ctx.lineTo(x + r * 0.9, y - r * 0.2);
      ctx.lineTo(x + r * 0.3, y + r * 0.6);
      ctx.closePath();
      ctx.fill();
    }
  }

  const blobs: { x: number; y: number; r: number; tone: number }[] = [];
  for (let row = 0; row < map.navRows; row++) {
    for (let col = 0; col < map.navCols; col++) {
      if (map.terrain[row * map.navCols + col] !== Terrain.Forest) continue;
      const count = 1 + (rand() < 0.55 ? 1 : 0);
      for (let k = 0; k < count; k++) {
        blobs.push({
          x: map.originX + (col + rand()) * map.navCell,
          y: map.originY + (row + rand()) * map.navCell,
          r: 4.5 + rand() * 4.5,
          tone: rand(),
        });
      }
    }
  }
  blobs.sort((a, b) => a.y - b.y);

  const [shadowCanvas, sctx] = canvas2d(size, size);
  sctx.setTransform(pxPerUnit, 0, 0, pxPerUnit, extent * pxPerUnit, extent * pxPerUnit);
  sctx.fillStyle = 'rgba(8,12,4,0.75)';
  for (const b of blobs) {
    sctx.beginPath();
    sctx.arc(b.x + 3.2, b.y + 4.2, b.r * 1.08, 0, Math.PI * 2);
    sctx.fill();
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = `blur(${Math.max(2, 3 * pxPerUnit)}px)`;
  ctx.globalAlpha = 0.7;
  ctx.drawImage(shadowCanvas, 0, 0);
  ctx.restore();

  for (const b of blobs) {
    const base = mix([34, 46, 26], [56, 70, 36], b.tone);
    ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, 0, b.x - b.r * 0.2, b.y - b.r * 0.2, b.r);
    g.addColorStop(0, 'rgba(126,140,74,0.55)');
    g.addColorStop(0.55, 'rgba(90,108,52,0.2)');
    g.addColorStop(1, 'rgba(20,28,12,0.25)');
    ctx.fillStyle = g;
    ctx.fill();
  }

  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(232,212,160,0.18)';
  ctx.beginPath();
  ctx.arc(0, 0, R - 1, 0, Math.PI * 2);
  ctx.stroke();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const v = ctx.createRadialGradient(size / 2, size / 2, R * pxPerUnit * 0.45, size / 2, size / 2, size * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(0.6, 'rgba(6,8,10,0.25)');
  v.addColorStop(1, 'rgba(4,6,8,0.85)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, size, size);

  const [thumb, tctx] = canvas2d(256, 256);
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(canvas, 0, 0, 256, 256);

  return { canvas, thumb, extent, pxPerUnit };
}

function paintRoads(ctx: CanvasRenderingContext2D, map: MapDef, seed: number, terrainAt: (x: number, y: number) => number): void {
  const objs = map.objectives;
  const citadel = objs.find((o) => o.kind === 'citadel');
  const strongholds = objs.filter((o) => o.kind === 'stronghold');
  const links: [number, number, number, number][] = [];
  for (const b of objs.filter((o) => o.kind === 'base')) {
    const near = [...strongholds].sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y));
    for (const s of near.slice(0, 2)) links.push([b.x, b.y, s.x, s.y]);
  }
  if (citadel) {
    const inner = [...strongholds].sort((a, c) => Math.hypot(a.x, a.y) - Math.hypot(c.x, c.y)).slice(0, Math.ceil(strongholds.length / 2));
    for (const s of inner) links.push([s.x, s.y, citadel.x, citadel.y]);
  }
  for (const [width, style] of [
    [7, 'rgba(92,76,48,0.42)'],
    [3.2, 'rgba(160,140,96,0.32)'],
  ] as const) {
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [x0, y0, x1, y1] of links) {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.max(2, Math.floor(len / 14));
      const nx = -(y1 - y0) / len;
      const ny = (x1 - x0) / len;
      ctx.beginPath();
      let drawing = false;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const bend = Math.sin(t * Math.PI) * (noise(x0 * 0.01 + t * 3, y0 * 0.01, seed + 77) - 0.5) * 90;
        const x = x0 + (x1 - x0) * t + nx * bend;
        const y = y0 + (y1 - y0) * t + ny * bend;
        const ok = terrainAt(x, y) === Terrain.Plain || terrainAt(x, y) === Terrain.Forest;
        if (!ok) {
          drawing = false;
          continue;
        }
        if (drawing) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        drawing = true;
      }
      ctx.stroke();
    }
  }
}
