import { ctx2d, clamp, makeCanvas } from './util.js';

export class Viewport {
  constructor(stage, viewCanvas, overlay) {
    this.stage = stage;
    this.canvas = viewCanvas;
    this.overlay = overlay;
    this.ctx = ctx2d(viewCanvas);
    this.octx = ctx2d(overlay);
    this.doc = null;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.minZoom = 0.05;
    this.maxZoom = 12;
    this.hud = null;
    this.hudSize = 0;
    this.activeStroke = null;
    this.selPreview = null;
    this.showAnts = true;
    this._raf = null;
    this._checker = null;
    this._dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.onPointer = null;
    this.onWheelZoom = null;
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(stage);
    this.resize();
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    const wasHidden = !(this.w > 1 && this.h > 1);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    for (const c of [this.canvas, this.overlay]) {
      c.width = Math.round(this.w * this._dpr);
      c.height = Math.round(this.h * this._dpr);
    }
    this.ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    this.octx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    this._checker = null;
    // Coming back from the gallery the studio was hidden (0×0); fit once it has a real size.
    if (wasHidden && this.doc && this.w > 1 && this.h > 1) this.fit();
    this.request();
  }

  checker() {
    if (this._checker) return this._checker;
    const c = makeCanvas(16, 16);
    const g = ctx2d(c);
    g.fillStyle = '#3a3d46';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#2c2f36';
    g.fillRect(0, 0, 8, 8);
    g.fillRect(8, 8, 8, 8);
    this._checker = this.ctx.createPattern(c, 'repeat');
    return this._checker;
  }

  setDoc(doc) {
    this.doc = doc;
    this.activeStroke = null;
    this.selPreview = null;
    this.hud = null;
    this.resize(); // the stage may have just been un-hidden; measure it now, not later
    this.fit();
  }

  fit() {
    if (!this.doc) return;
    const pad = 40;
    this.zoom = clamp(Math.min((this.w - pad) / this.doc.width, (this.h - pad) / this.doc.height), 0.02, 1);
    this.panX = (this.w - this.doc.width * this.zoom) / 2;
    this.panY = (this.h - this.doc.height * this.zoom) / 2;
    this.request();
  }

  toDoc(sx, sy) {
    return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom };
  }
  toScreen(dx, dy) {
    return { x: dx * this.zoom + this.panX, y: dy * this.zoom + this.panY };
  }

  zoomAt(sx, sy, factor) {
    const before = this.toDoc(sx, sy);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const after = this.toDoc(sx, sy);
    this.panX += (after.x - before.x) * this.zoom;
    this.panY += (after.y - before.y) * this.zoom;
    this.request();
  }

  request() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this.draw(); });
  }

  draw() {
    const g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);
    g.fillStyle = '#0a0b0d';
    g.fillRect(0, 0, this.w, this.h);
    if (!this.doc) return;
    const d = this.doc;
    const w = d.width * this.zoom, h = d.height * this.zoom;

    g.save();
    g.translate(this.panX, this.panY);
    g.scale(this.zoom, this.zoom);
    g.fillStyle = this.checker();
    g.fillRect(0, 0, d.width, d.height);
    if (d.bgAlpha > 0) {
      g.globalAlpha = d.bgAlpha;
      g.fillStyle = d.bgColor;
      g.fillRect(0, 0, d.width, d.height);
      g.globalAlpha = 1;
    }
    // The document reuses one composite buffer (saves a full-size canvas on iPad).
    const comp = d.renderView(this.activeStroke && this.activeStroke.enabled ? this.activeStroke : null);
    g.imageSmoothingQuality = 'high';
    g.drawImage(comp, 0, 0);
    if (this.showAnts && d.selection && d.selection.active) {
      const ants = d.selection.antsPath();
      g.lineWidth = 1.5 / this.zoom;
      g.strokeStyle = 'rgba(0,0,0,.8)';
      g.stroke(ants);
      g.setLineDash([5 / this.zoom, 5 / this.zoom]);
      g.strokeStyle = 'rgba(255,255,255,.95)';
      g.stroke(ants);
      g.setLineDash([]);
    }
    g.restore();

    d.zoom = this.zoom;

    g.strokeStyle = 'rgba(255,255,255,.18)';
    g.lineWidth = 1;
    g.strokeRect(this.panX - 0.5, this.panY - 0.5, w + 1, h + 1);

    // Overlay: clear once, then guides, selection-in-progress and brush cursor.
    // (The cursor used to clear the overlay right after the guides were drawn, so guides never showed.)
    this.octx.clearRect(0, 0, this.w, this.h);
    this._drawGuides();
    this._drawSelPreview();
    this._drawHud();
  }

  _drawSelPreview() {
    const sp = this.selPreview;
    if (!sp || !sp.points.length) return;
    const o = this.octx;
    const pts = sp.points.map((p) => this.toScreen(p.x, p.y));
    o.save();
    o.beginPath();
    if (sp.mode === 'rect' || sp.mode === 'ellipse') {
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
      if (sp.mode === 'rect') o.rect(x0, y0, x1 - x0, y1 - y0);
      else o.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0, 0, Math.PI * 2);
    } else {
      o.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) o.lineTo(p.x, p.y);
    }
    o.fillStyle = 'rgba(61,139,253,.12)';
    o.fill();
    o.lineWidth = 1.5;
    o.strokeStyle = 'rgba(0,0,0,.7)';
    o.stroke();
    o.setLineDash([5, 5]);
    o.strokeStyle = '#fff';
    o.stroke();
    o.restore();
  }

  _drawHud() {
    const o = this.octx;
    if (!this.hud || !this.hudSize) return;
    const p = this.toScreen(this.hud.x, this.hud.y);
    const r = Math.max(2, (this.hudSize * this.zoom) / 2);
    o.strokeStyle = 'rgba(255,255,255,.92)';
    o.lineWidth = 1.4;
    o.beginPath();
    o.arc(p.x, p.y, r, 0, Math.PI * 2);
    o.stroke();
    o.strokeStyle = 'rgba(0,0,0,.55)';
    o.lineWidth = 1;
    o.beginPath();
    o.arc(p.x, p.y, r + 1.2, 0, Math.PI * 2);
    o.stroke();
  }

  _drawGuides() {
    const o = this.octx;
    const d = this.doc;
    if (!d || d.guide.type === 'off') return;
    const g0 = this.toScreen(0, 0), g1 = this.toScreen(d.width, d.height);
    o.save();
    o.globalAlpha = d.guide.opacity;
    o.strokeStyle = d.guide.color;
    o.lineWidth = d.guide.size;
    o.beginPath();
    const step = 64 * this.zoom;
    if (d.guide.type === 'grid' || d.guide.type === 'isometric') {
      if (d.guide.type === 'grid') {
        for (let x = g0.x; x < g1.x; x += step) { o.moveTo(x, g0.y); o.lineTo(x, g1.y); }
        for (let y = g0.y; y < g1.y; y += step) { o.moveTo(g0.x, y); o.lineTo(g1.x, y); }
      } else {
        const s = step * 1.15;
        for (let x = g0.x - (g1.y - g0.y); x < g1.x; x += s * 2) {
          o.moveTo(x, g1.y); o.lineTo(x + (g1.y - g0.y), g0.y);
          o.moveTo(x, g1.y); o.lineTo(x - (g1.y - g0.y), g0.y);
        }
      }
    }
    if (d.guide.type === 'perspective') {
      const vx = g0.x + (g1.x - g0.x) * 0.5, vy = g0.y + (g1.y - g0.y) * 0.32;
      for (let i = 0; i <= 10; i++) {
        const bx = g0.x + ((g1.x - g0.x) * i) / 10;
        o.moveTo(vx, vy); o.lineTo(bx, g1.y);
      }
      o.moveTo(g0.x, vy); o.lineTo(g1.x, vy);
    }
    if (d.guide.type === 'symmetry') {
      if (d.symmetry === 'x' || d.symmetry === 'quad') { const m = (g0.x + g1.x) / 2; o.moveTo(m, g0.y); o.lineTo(m, g1.y); }
      if (d.symmetry === 'y' || d.symmetry === 'quad') { const m = (g0.y + g1.y) / 2; o.moveTo(g0.x, m); o.lineTo(g1.x, m); }
      if (d.symmetry === 'radial' || d.symmetry === 'rotational') {
        const cx = (g0.x + g1.x) / 2, cy = (g0.y + g1.y) / 2, r = Math.hypot(g1.x - g0.x, g1.y - g0.y);
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          o.moveTo(cx, cy); o.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
      }
    }
    o.stroke();
    o.restore();
  }
}


