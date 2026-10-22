import { CanvasSource, Texture } from 'pixi.js';
import { UnitKind } from '../../sim/api.ts';
import { canvas2d } from './paint.ts';

function toTexture(canvas: HTMLCanvasElement): Texture {
  return new Texture({ source: new CanvasSource({ resource: canvas, autoGenerateMipmaps: true, scaleMode: 'linear' }) });
}

const OUTLINE = '#15130f';

function draw(size: number, paint: (ctx: CanvasRenderingContext2D, s: number) => void): Texture {
  const [c, ctx] = canvas2d(size, size);
  ctx.translate(size / 2, size / 2);
  paint(ctx, size);
  return toTexture(c);
}

function infantry(ctx: CanvasRenderingContext2D): void {
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(30, 0);
  ctx.lineTo(18, -6);
  ctx.lineTo(18, 6);
  ctx.closePath();
  ctx.fillStyle = '#e9e9e9';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, 21, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(40,36,30,0.45)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = '#bdbdbd';
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function archer(ctx: CanvasRenderingContext2D): void {
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(26, 0);
  ctx.lineTo(-16, -22);
  ctx.lineTo(-6, 0);
  ctx.lineTo(-16, 22);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(-2, -9);
  ctx.lineTo(2, 0);
  ctx.lineTo(-2, 9);
  ctx.closePath();
  ctx.fillStyle = 'rgba(40,36,30,0.35)';
  ctx.fill();
}

function cavalry(ctx: CanvasRenderingContext2D): void {
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(30, 0);
  ctx.lineTo(0, -13);
  ctx.lineTo(-28, 0);
  ctx.lineTo(0, 13);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(22, 0);
  ctx.lineTo(-20, 0);
  ctx.strokeStyle = 'rgba(40,36,30,0.45)';
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(8, 0, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#c4c4c4';
  ctx.fill();
}

export interface Textures {
  units: Record<UnitKind, Texture>;
  shadow: Texture;
  hex: Texture;
  soft: Texture;
  ring: Texture;
  spark: Texture;
  arrow: Texture;
  mark: Texture;
}

export const UNIT_TEXTURE_PX = 64;
export const HEX_TEXTURE_RADIUS = 64;

export function makeTextures(): Textures {
  const hexR = HEX_TEXTURE_RADIUS;
  const hw = Math.ceil(Math.sqrt(3) * hexR);
  const [hc, hctx] = canvas2d(hw, hexR * 2);
  hctx.translate(hw / 2, hexR);
  const hexPath = (r: number) => {
    hctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = ((60 * i - 30) * Math.PI) / 180;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) hctx.moveTo(x, y);
      else hctx.lineTo(x, y);
    }
    hctx.closePath();
  };
  hexPath(hexR + 0.6);
  hctx.fillStyle = 'rgba(255,255,255,0.72)';
  hctx.fill();
  hexPath(hexR - 5);
  hctx.strokeStyle = 'rgba(255,255,255,0.55)';
  hctx.lineWidth = 9;
  hctx.stroke();

  return {
    units: {
      [UnitKind.Infantry]: draw(UNIT_TEXTURE_PX, infantry),
      [UnitKind.Archer]: draw(UNIT_TEXTURE_PX, archer),
      [UnitKind.Cavalry]: draw(UNIT_TEXTURE_PX, cavalry),
    },
    shadow: draw(64, (ctx) => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
      g.addColorStop(0, 'rgba(0,0,0,0.55)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.3)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-32, -32, 64, 64);
    }),
    hex: toTexture(hc),
    soft: draw(64, (ctx) => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 31);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-32, -32, 64, 64);
    }),
    ring: draw(128, (ctx) => {
      ctx.beginPath();
      ctx.arc(0, 0, 56, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 12;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,1)';
      ctx.lineWidth = 4;
      ctx.stroke();
    }),
    spark: draw(32, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 === 0 ? 15 : 3;
        const a = (i * Math.PI) / 4;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    }),
    arrow: draw(32, (ctx) => {
      ctx.strokeStyle = '#f4ead2';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-13, 0);
      ctx.lineTo(10, 0);
      ctx.stroke();
      ctx.fillStyle = '#f4ead2';
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.lineTo(8, -3.5);
      ctx.lineTo(8, 3.5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,170,120,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-13, -3);
      ctx.lineTo(-9, 0);
      ctx.lineTo(-13, 3);
      ctx.stroke();
    }),
    mark: draw(32, (ctx) => {
      ctx.fillStyle = 'rgba(28,20,14,0.85)';
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.arc(Math.cos(i * 1.7) * 5, Math.sin(i * 2.3) * 5, 4 + (i % 3) * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }),
  };
}
