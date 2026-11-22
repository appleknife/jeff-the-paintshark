import { makeCanvas, ctx2d, clamp, lerp } from './util.js';

export class TransformSession {
  constructor(doc, layer, selection) {
    this.doc = doc;
    this.layer = layer;
    this.selection = selection && selection.active ? selection : null;
    this.src = makeCanvas(doc.width, doc.height);
    const g = ctx2d(this.src);
    g.drawImage(layer.canvas, 0, 0);
    if (this.selection) this.selection.applyToCanvas(this.src);
    this.bounds = this.selection ? this.selection.bounds() : { x: 0, y: 0, w: doc.width, h: doc.height };
    if (!this.bounds) this.bounds = { x: 0, y: 0, w: doc.width, h: doc.height };
    this.tx = 0; this.ty = 0; this.scaleX = 1; this.scaleY = 1; this.rotate = 0;
    this.warp = null;
    this.grid = 8;
    this.snap = true;
    this.mode = 'free';
  }

  get center() {
    return { x: this.bounds.x + this.bounds.w / 2, y: this.bounds.y + this.bounds.h / 2 };
  }

  ensureWarp() {
    if (this.warp) return;
    const n = this.grid;
    const c = this.center;
    this.warp = [];
    for (let y = 0; y <= n; y++) {
      const row = [];
      for (let x = 0; x <= n; x++) {
        row.push({
          u: x / n, v: y / n,
          sx: lerp(this.bounds.x, this.bounds.x + this.bounds.w, x / n),
          sy: lerp(this.bounds.y, this.bounds.y + this.bounds.h, y / n),
          ox: 0, oy: 0,
        });
      }
      this.warp.push(row);
    }
    this.warpCenter = c;
  }

  warpPointAt(px, py, radius = 300) {
    this.ensureWarp();
    const n = this.grid;
    let best = null, bd = Infinity;
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) {
      const p = this.warp[y][x];
      const d = Math.hypot(p.sx + p.ox - px, p.sy + p.oy - py);
      if (d < bd) { bd = d; best = p; }
    }
    return { point: best, dist: bd };
  }

  dragWarp(px, py, dx, dy, radius = 220) {
    this.ensureWarp();
    for (const row of this.warp) for (const p of row) {
      const d = Math.hypot(p.sx + p.ox - px, p.sy + p.oy - py);
      if (d > radius) continue;
      const w = 1 - d / radius;
      p.ox += dx * w * w;
      p.oy += dy * w * w;
    }
  }

  _mapUv(u, v) {
    const n = this.grid;
    if (!this.warp) {
      const x = lerp(this.bounds.x, this.bounds.x + this.bounds.w, u);
      const y = lerp(this.bounds.y, this.bounds.y + this.bounds.h, v);
      return { x, y };
    }
    const fx = u * n, fy = v * n;
    const x0 = Math.min(n - 1, Math.floor(fx)), y0 = Math.min(n - 1, Math.floor(fy));
    const tx = fx - x0, ty = fy - y0;
    const a = this.warp[y0][x0], b = this.warp[y0][x0 + 1];
    const c = this.warp[y0 + 1][x0], d = this.warp[y0 + 1][x0 + 1];
    return {
      x: lerp(lerp(a.sx + a.ox, b.sx + b.ox, tx), lerp(c.sx + c.ox, d.sx + d.ox, tx), ty),
      y: lerp(lerp(a.sy + a.oy, b.sy + b.oy, tx), lerp(c.sy + c.oy, d.sy + d.oy, tx), ty),
    };
  }

  render(target) {
    const g = ctx2d(target);
    const c = this.center;
    g.save();
    g.translate(c.x + this.tx, c.y + this.ty);
    g.rotate(this.rotate);
    g.scale(this.scaleX, this.scaleY);
    g.translate(-c.x, -c.y);

    if (this.warp) {
      const n = this.grid, steps = 2;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          for (let sy = 0; sy < steps; sy++) {
            for (let sx = 0; sx < steps; sx++) {
              const u0 = (x + sx / steps) / n, u1 = (x + (sx + 1) / steps) / n;
              const v0 = (y + sy / steps) / n, v1 = (y + (sy + 1) / steps) / n;
              const p0 = this._mapUv(u0, v0), p1 = this._mapUv(u1, v0);
              const p2 = this._mapUv(u1, v1), p3 = this._mapUv(u0, v1);
              const su0 = u0 * this.bounds.w + this.bounds.x, su1 = u1 * this.bounds.w + this.bounds.x;
              const sv0 = v0 * this.bounds.h + this.bounds.y, sv1 = v1 * this.bounds.h + this.bounds.y;
              this._tri(g, p0, p1, p2, su0, sv0, su1, sv0, su1, sv1);
              this._tri(g, p0, p2, p3, su0, sv0, su1, sv1, su0, sv1);
            }
          }
        }
      }
    } else {
      g.drawImage(this.src, this.bounds.x, this.bounds.y, this.bounds.w, this.bounds.h,
        this.bounds.x, this.bounds.y, this.bounds.w, this.bounds.h);
    }
    g.restore();
  }

  _tri(g, p0, p1, p2, u0, v0, u1, v1, u2, v2) {
    const src = this.src;
    g.save();
    g.beginPath();
    g.moveTo(p0.x, p0.y);
    g.lineTo(p1.x, p1.y);
    g.lineTo(p2.x, p2.y);
    g.closePath();
    g.clip();
    const x0 = Math.min(u0, u1, u2), y0 = Math.min(v0, v1, v2);
    const x1 = Math.max(u0, u1, u2), y1 = Math.max(v0, v1, v2);
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    const m = new DOMMatrix();
    m.a = (u1 - u0) / w; m.b = (v1 - v0) / w;
    m.c = (u2 - u0) / h; m.d = (v2 - v0) / h;
    m.e = u0 - (x0 / w) * (u1 - u0) - (y0 / h) * (u2 - u0);
    m.f = v0 - (x0 / w) * (v1 - v0) - (y0 / h) * (v2 - v0);
    g.setTransform(m);
    g.drawImage(src, x0, y0, w, h, x0, y0, w, h);
    g.restore();
  }

  commit() {
    const tmp = makeCanvas(this.doc.width, this.doc.height);
    this.render(tmp);
    const g = ctx2d(this.layer.canvas);
    g.save();
    if (this.selection) {
      const erase = makeCanvas(this.doc.width, this.doc.height);
      ctx2d(erase).drawImage(this.layer.canvas, 0, 0);
      ctx2d(erase).globalCompositeOperation = 'destination-out';
      ctx2d(erase).drawImage(this.selection.canvas, 0, 0);
      g.clearRect(0, 0, this.doc.width, this.doc.height);
      g.drawImage(erase, 0, 0);
    } else {
      g.clearRect(0, 0, this.doc.width, this.doc.height);
    }
    if (this.selection) {
      const masked = makeCanvas(this.doc.width, this.doc.height);
      ctx2d(masked).drawImage(tmp, 0, 0);
      this.selection.applyToCanvas(masked);
      g.drawImage(masked, 0, 0);
    } else {
      g.drawImage(tmp, 0, 0);
    }
    if (this.layer.alphaLock) {
      const base = makeCanvas(this.doc.width, this.doc.height);
      const bg = ctx2d(base);
      bg.drawImage(this.layer.canvas, 0, 0);
    }
    g.restore();
    this.doc.emit('strokeEnd', { layer: this.layer });
  }
}

export const LIQUIFY_MODES = ['push', 'twirl-left', 'twirl-right', 'pinch', 'bloat', 'crystals', 'edges'];

export function liquify(layer, x, y, radius, amount, mode) {
  const w = layer.canvas.width, h = layer.canvas.height;
  const x0 = clamp(Math.floor(x - radius), 0, w - 1);
  const y0 = clamp(Math.floor(y - radius), 0, h - 1);
  const x1 = clamp(Math.ceil(x + radius), 0, w - 1);
  const y1 = clamp(Math.ceil(y + radius), 0, h - 1);
  if (x1 <= x0 || y1 <= y0) return;
  const g = ctx2d(layer.canvas);
  const img = g.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  const src = new Uint8ClampedArray(img.data);
  const dw = img.width, dh = img.height;
  const out = img.data;
  for (let py = 0; py < dh; py++) {
    for (let px = 0; px < dw; px++) {
      const gx = x0 + px, gy = y0 + py;
      const dx = gx - x, dy = gy - y;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const f = 1 - d / radius;
      let sx = gx, sy = gy;
      if (mode === 'push') { sx = gx - amount * f * 8; sy = gy - amount * f * 8; }
      else if (mode === 'twirl-left' || mode === 'twirl-right') {
        const a = (mode === 'twirl-left' ? -1 : 1) * amount * f * 0.35;
        const ca = Math.cos(a), sa = Math.sin(a);
        sx = x + dx * ca - dy * sa; sy = y + dx * sa + dy * ca;
      } else if (mode === 'pinch' || mode === 'bloat') {
        const k = mode === 'pinch' ? 1 + amount * f * 0.6 : 1 - amount * f * 0.6;
        sx = x + dx * k; sy = y + dy * k;
      } else if (mode === 'crystals') {
        const a = (Math.round(Math.atan2(dy, dx) / (Math.PI / 3)) * Math.PI / 3) * f * amount;
        sx = x + Math.cos(a) * d; sy = y + Math.sin(a) * d;
      } else if (mode === 'edges') {
        const edge = Math.abs(f - 0.5) < 0.2 ? 1 : 0;
        sx = gx + dx * edge * amount * f * 0.4; sy = gy + dy * edge * amount * f * 0.4;
      }
      const lx = clamp(sx - x0, 0, dw - 1.001), ly = clamp(sy - y0, 0, dh - 1.001);
      const ix = Math.floor(lx), iy = Math.floor(ly), fx = lx - ix, fy = ly - iy;
      const o = (py * dw + px) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const s00 = src[(iy * dw + ix) * 4 + ch];
        const s10 = src[(iy * dw + ix + 1) * 4 + ch];
        const s01 = src[((iy + 1) * dw + ix) * 4 + ch];
        const s11 = src[((iy + 1) * dw + ix + 1) * 4 + ch];
        out[o + ch] = (s00 * (1 - fx) + s10 * fx) * (1 - fy) + (s01 * (1 - fx) + s11 * fx) * fy;
      }
    }
  }
  g.putImageData(img, x0, y0);
}
