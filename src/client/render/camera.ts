export const MIN_ZOOM = 0.22;
export const MAX_ZOOM = 5;
const FRICTION_PER_FRAME = 0.9;
const KEY_PAN_PX_PER_S = 900;
const CLICK_SLOP_PX = 5;

export interface CameraHooks {
  onClick(screenX: number, screenY: number): void;
  onUserPan(): void;
}

interface Glide {
  x: number;
  y: number;
  zoom: number;
}

export class Camera {
  x = 0;
  y = 0;
  zoom = 0.6;
  width = 1;
  height = 1;
  private vx = 0;
  private vy = 0;
  private zoomTarget = this.zoom;
  private zoomAnchor: { sx: number; sy: number } | null = null;
  private glide: Glide | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragTrail: { x: number; y: number; t: number }[] = [];
  private downAt: { x: number; y: number } | null = null;
  private pinchDist = 0;
  private keys = new Set<string>();
  private limit = 1000;
  private detach: () => void;

  constructor(
    private el: HTMLElement,
    private hooks: CameraHooks,
  ) {
    const opts = { passive: false } as const;
    const down = (e: PointerEvent) => this.down(e);
    const move = (e: PointerEvent) => this.move(e);
    const up = (e: PointerEvent) => this.up(e);
    const wheel = (e: WheelEvent) => this.wheel(e);
    const dbl = (e: MouseEvent) => this.focusAt(e.offsetX, e.offsetY);
    const kd = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        this.keys.add(k);
        this.glide = null;
        this.hooks.onUserPan();
      }
      if (k === '=' || k === '+') this.zoomBy(1.25);
      if (k === '-') this.zoomBy(0.8);
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
    const blur = () => this.keys.clear();
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, opts);
    el.addEventListener('dblclick', dbl);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    this.detach = () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('dblclick', dbl);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
    };
  }

  destroy(): void {
    this.detach();
  }

  fitZoom(radius: number): number {
    return Math.max(MIN_ZOOM, Math.min(this.width, this.height) / (radius * 2.25));
  }

  fit(radius: number): void {
    this.limit = radius * 1.08;
    this.x = 0;
    this.y = 0;
    this.zoom = this.zoomTarget = this.fitZoom(radius);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.x + (sx - this.width / 2) / this.zoom, y: this.y + (sy - this.height / 2) / this.zoom };
  }

  toScreen(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.x) * this.zoom + this.width / 2, y: (y - this.y) * this.zoom + this.height / 2 };
  }

  bounds(pad = 20): { minX: number; minY: number; maxX: number; maxY: number; contains(x: number, y: number): boolean } {
    const hw = this.width / 2 / this.zoom + pad;
    const hh = this.height / 2 / this.zoom + pad;
    const minX = this.x - hw;
    const maxX = this.x + hw;
    const minY = this.y - hh;
    const maxY = this.y + hh;
    return { minX, minY, maxX, maxY, contains: (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY };
  }

  panTo(x: number, y: number, zoom = this.zoom): void {
    this.glide = { x, y, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) };
    this.vx = this.vy = 0;
  }

  follow(x: number, y: number, dtMs: number): void {
    if (this.pointers.size) return;
    const k = 1 - Math.pow(0.04, dtMs / 1000);
    this.x += (x - this.x) * k;
    this.y += (y - this.y) * k;
  }

  zoomBy(factor: number, sx = this.width / 2, sy = this.height / 2): void {
    this.glide = null;
    this.zoomTarget = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoomTarget * factor));
    this.zoomAnchor = { sx, sy };
  }

  update(dtMs: number): void {
    const dt = Math.min(64, dtMs);
    const frames = dt / 16.67;
    if (this.glide) {
      const k = 1 - Math.pow(0.0025, dt / 1000);
      this.x += (this.glide.x - this.x) * k;
      this.y += (this.glide.y - this.y) * k;
      this.zoom += (this.glide.zoom - this.zoom) * k;
      this.zoomTarget = this.zoom;
      if (Math.abs(this.glide.x - this.x) < 0.5 && Math.abs(this.glide.y - this.y) < 0.5 && Math.abs(this.glide.zoom - this.zoom) < 0.002) this.glide = null;
    } else if (Math.abs(this.zoomTarget - this.zoom) > 1e-4) {
      const anchor = this.zoomAnchor ?? { sx: this.width / 2, sy: this.height / 2 };
      const before = this.toWorld(anchor.sx, anchor.sy);
      this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.pow(0.001, dt / 1000));
      const after = this.toWorld(anchor.sx, anchor.sy);
      this.x += before.x - after.x;
      this.y += before.y - after.y;
    }
    if (!this.pointers.size && (this.vx || this.vy)) {
      this.x += this.vx * frames;
      this.y += this.vy * frames;
      const f = Math.pow(FRICTION_PER_FRAME, frames);
      this.vx *= f;
      this.vy *= f;
      if (Math.abs(this.vx) < 0.01 && Math.abs(this.vy) < 0.01) this.vx = this.vy = 0;
    }
    if (this.keys.size) {
      const step = (KEY_PAN_PX_PER_S * dt) / 1000 / this.zoom;
      if (this.keys.has('w') || this.keys.has('arrowup')) this.y -= step;
      if (this.keys.has('s') || this.keys.has('arrowdown')) this.y += step;
      if (this.keys.has('a') || this.keys.has('arrowleft')) this.x -= step;
      if (this.keys.has('d') || this.keys.has('arrowright')) this.x += step;
    }
    const d = Math.hypot(this.x, this.y);
    if (d > this.limit) {
      this.x *= this.limit / d;
      this.y *= this.limit / d;
    }
  }

  private focusAt(sx: number, sy: number): void {
    const p = this.toWorld(sx, sy);
    this.hooks.onUserPan();
    this.panTo(p.x, p.y, Math.max(this.zoom * 1.6, 1.8));
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.el.setPointerCapture?.(e.pointerId);
    this.glide = null;
    this.vx = this.vy = 0;
    if (this.pointers.size === 1) {
      this.downAt = p;
      this.dragTrail = [{ ...p, t: performance.now() }];
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      this.downAt = null;
    }
  }

  private move(e: PointerEvent): void {
    const last = this.pointers.get(e.pointerId);
    if (!last) return;
    const p = this.local(e);
    if (this.pointers.size === 1) {
      if (this.downAt && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > CLICK_SLOP_PX) {
        this.downAt = null;
        this.hooks.onUserPan();
      }
      if (!this.downAt) {
        this.x -= (p.x - last.x) / this.zoom;
        this.y -= (p.y - last.y) / this.zoom;
        this.zoomTarget = this.zoom;
      }
      this.dragTrail.push({ ...p, t: performance.now() });
      if (this.dragTrail.length > 6) this.dragTrail.shift();
    } else if (this.pointers.size === 2) {
      this.pointers.set(e.pointerId, p);
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const mx = (a!.x + b!.x) / 2;
      const my = (a!.y + b!.y) / 2;
      if (this.pinchDist > 0) {
        const before = this.toWorld(mx, my);
        this.zoom = this.zoomTarget = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (this.zoom * dist) / this.pinchDist));
        const after = this.toWorld(mx, my);
        this.x += before.x - after.x;
        this.y += before.y - after.y;
      }
      this.pinchDist = dist;
      this.hooks.onUserPan();
      return;
    }
    this.pointers.set(e.pointerId, p);
  }

  private up(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      if (this.downAt) {
        this.hooks.onClick(this.downAt.x, this.downAt.y);
      } else if (this.dragTrail.length >= 2) {
        const a = this.dragTrail[0]!;
        const b = this.dragTrail[this.dragTrail.length - 1]!;
        const dt = Math.max(1, b.t - a.t);
        if (performance.now() - b.t < 80) {
          this.vx = (-(b.x - a.x) / dt) * 16.67 / this.zoom;
          this.vy = (-(b.y - a.y) / dt) * 16.67 / this.zoom;
        }
      }
      this.downAt = null;
    }
    if (this.pointers.size === 1) {
      const [only] = [...this.pointers.values()];
      this.dragTrail = [{ ...only!, t: performance.now() }];
    }
    this.pinchDist = 0;
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const p = { x: e.offsetX, y: e.offsetY };
    const scale = e.deltaMode === 1 ? 40 : 1;
    this.zoomBy(Math.exp(-e.deltaY * scale * 0.0016), p.x, p.y);
  }
}
