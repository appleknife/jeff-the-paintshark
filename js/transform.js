import { makeCanvas, ctx2d, clamp, lerp, releaseCanvas } from './util.js';

/**
 * Free transform / warp of the selected pixels (or the whole layer).
 * On start the moving pixels are lifted out of the layer into `src`; the document renders
 * the session live on top of the remaining pixels (doc.liveTransform). commit() stamps the
 * result back, cancel() restores the untouched original.
 */
export class TransformSession {
  constructor(doc, layer, selection) {
    this.doc = doc;
    this.layer = layer;
    this.selection = selection && selection.active ? selection : null;
    const lg = ctx2d(layer.canvas);
    this.orig = lg.getImageData(0, 0, doc.width, doc.height);
    this.src = makeCanvas(doc.width, doc.height);
    const g = ctx2d(this.src);
    g.drawImage(layer.canvas, 0, 0);
    if (this.selection) this.selection.applyToCanvas(this.src);
    // Lift the moving pixels out of the layer.
    lg.save();
    if (this.selection) {
      lg.globalCompositeOperation = 'destination-out';
      lg.drawImage(this.selection.canvas, 0, 0);
    } else {
      lg.clearRect(0, 0, doc.width, doc.height);
    }
    lg.restore();
    this.bounds = (this.selection && this.selection.bounds()) || { x: 0, y: 0, w: doc.width, h: doc.height };
    this.done = false;
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
    // Warp points live in the untranslated space.
    px -= this.tx; py -= this.ty;
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

  render(target, src = this.src) {
    const g = ctx2d(target);
    const prevSrc = this.src;
    this.src = src;
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
    this.src = prevSrc;
  }

  get changed() {
    return this.tx !== 0 || this.ty !== 0 || this.scaleX !== 1 || this.scaleY !== 1 || this.rotate !== 0
      || (this.warp && this.warp.some((row) => row.some((p) => p.ox || p.oy)));
  }

  /** Draw the source triangle (u,v) onto the destination triangle (p) with an affine map. */
  _tri(g, p0, p1, p2, u0, v0, u1, v1, u2, v2) {
    const d1x = u1 - u0, d1y = v1 - v0, d2x = u2 - u0, d2y = v2 - v0;
    const det = d1x * d2y - d2x * d1y;
    if (Math.abs(det) < 1e-9) return;
    const q1x = p1.x - p0.x, q1y = p1.y - p0.y, q2x = p2.x - p0.x, q2y = p2.y - p0.y;
    const a = (q1x * d2y - q2x * d1y) / det;
    const c = (q2x * d1x - q1x * d2x) / det;
    const b = (q1y * d2y - q2y * d1y) / det;
    const d = (q2y * d1x - q1y * d2x) / det;
    const e = p0.x - a * u0 - c * v0;
    const f = p0.y - b * u0 - d * v0;
    g.save();
    g.beginPath();
    g.moveTo(p0.x, p0.y);
    g.lineTo(p1.x, p1.y);
    g.lineTo(p2.x, p2.y);
    g.closePath();
    g.clip();
    g.transform(a, b, c, d, e, f);
    const W = this.src.width, H = this.src.height;
    const x0 = clamp(Math.floor(Math.min(u0, u1, u2)) - 1, 0, W), y0 = clamp(Math.floor(Math.min(v0, v1, v2)) - 1, 0, H);
    const x1 = clamp(Math.ceil(Math.max(u0, u1, u2)) + 1, 0, W), y1 = clamp(Math.ceil(Math.max(v0, v1, v2)) + 1, 0, H);
    if (x1 > x0 && y1 > y0) g.drawImage(this.src, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    g.restore();
  }

  commit() {
    if (this.done) return;
    this.done = true;
    if (!this.changed) { this.cancel(true); return; }
    const W = this.doc.width, H = this.doc.height;
    this.doc.pushUndoData(this.layer, this.orig);
    const g = ctx2d(this.layer.canvas);
    g.save();
    if (this.layer.alphaLock) g.globalCompositeOperation = 'source-atop';
    this.render(this.layer.canvas);
    g.restore();
    if (this.selection) {
      // Move the selection along with the pixels.
      const moved = makeCanvas(W, H);
      this.render(moved, this.selection.canvas);
      this.selection.setMask(moved);
      releaseCanvas(moved);
    }
    this._free();
    this.doc.emit('strokeEnd', { layer: this.layer });
  }

  cancel(silent = false) {
    this.done = true;
    if (this.orig) ctx2d(this.layer.canvas).putImageData(this.orig, 0, 0);
    this._free();
    if (!silent) this.doc.emit('layers');
  }

  _free() {
    releaseCanvas(this.src);
    this.orig = null;
  }
}

export const LIQUIFY_MODES = ['push', 'twirl-left', 'twirl-right', 'pinch', 'bloat', 'crystals', 'edges'];

/** Distort `layer` around (x, y). For push, (mx, my) is how far the finger moved. */
export function liquify(layer, x, y, radius, amount, mode, mx = 0, my = 0) {
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
      if (mode === 'push') {
        const k = f * clamp(amount * 2, 0.05, 1);
        sx = gx - mx * k; sy = gy - my * k;
      }
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
