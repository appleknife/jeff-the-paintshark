import { makeCanvas, ctx2d, clamp } from './util.js';

export class Selection {
  constructor(doc) {
    this.doc = doc;
    this.canvas = makeCanvas(doc.width, doc.height);
    this.ctx = ctx2d(this.canvas);
    this.active = false;
    this.mode = 'freehand';
    this.op = 'new';
    this.feather = 0;
    this.threshold = 0.22;
    this._ants = null;
    this._points = [];
  }

  maskCanvas() { return this.canvas; }

  _path2d(points) {
    const p = new Path2D();
    if (!points.length) return p;
    p.moveTo(points[0].x, points[0].y);
    for (const pt of points.slice(1)) p.lineTo(pt.x, pt.y);
    p.closePath();
    return p;
  }

  begin(points) {
    this._points = [...points];
    if (this.op === 'new') { this.ctx.clearRect(0, 0, this.doc.width, this.doc.height); this.active = false; }
  }

  addPoint(pt) { this._points.push(pt); }

  commit(points = this._points) {
    if (!points.length) return;
    const tmp = makeCanvas(this.doc.width, this.doc.height);
    const g = ctx2d(tmp);
    g.fillStyle = '#fff';
    if (this.mode === 'rect' || this.mode === 'ellipse' || this.mode === 'freehand') {
      if (this.mode === 'rect') {
        const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
        const x = Math.min(...xs), y = Math.min(...ys);
        g.fillRect(x, y, Math.max(...xs) - x, Math.max(...ys) - y);
      } else if (this.mode === 'ellipse') {
        const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        g.beginPath();
        g.ellipse(cx, cy, (Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...ys) - Math.min(...ys)) / 2, 0, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fill(this._path2d(points));
      }
    }
    if (this.feather > 0) {
      g.filter = `blur(${this.feather}px)`;
      g.drawImage(tmp, 0, 0);
      g.filter = 'none';
    }
    const main = this.ctx;
    main.save();
    if (this.op === 'add') main.globalCompositeOperation = 'source-over';
    else if (this.op === 'sub') main.globalCompositeOperation = 'destination-out';
    else if (this.op === 'intersect') {
      const keep = makeCanvas(this.doc.width, this.doc.height);
      ctx2d(keep).drawImage(tmp, 0, 0);
      const kg = ctx2d(keep);
      kg.globalCompositeOperation = 'destination-in';
      kg.drawImage(this.canvas, 0, 0);
      main.clearRect(0, 0, this.doc.width, this.doc.height);
      main.drawImage(keep, 0, 0);
      main.restore();
      this.active = true;
      this._ants = null;
      this.doc.emit('selection');
      return;
    }
    main.drawImage(tmp, 0, 0);
    main.restore();
    this.active = true;
    this._ants = null;
    this.doc.emit('selection');
  }

  autoSelect(x, y) {
    const src = this.doc.compositeCanvas();
    const img = ctx2d(src).getImageData(0, 0, this.doc.width, this.doc.height);
    const mask = new ImageData(this.doc.width, this.doc.height);
    const tol = Math.max(1, this.threshold * 255);
    const i0 = (Math.round(y) * this.doc.width + Math.round(x)) * 4;
    const r0 = img.data[i0], g0 = img.data[i0 + 1], b0 = img.data[i0 + 2], a0 = img.data[i0 + 3];
    const seen = new Uint8Array(this.doc.width * this.doc.height);
    const stack = [Math.round(y) * this.doc.width + Math.round(x)];
    while (stack.length) {
      const idx = stack.pop();
      if (seen[idx]) continue;
      seen[idx] = 1;
      const o = idx * 4;
      const d = Math.max(
        Math.abs(img.data[o] - r0), Math.abs(img.data[o + 1] - g0),
        Math.abs(img.data[o + 2] - b0), Math.abs(img.data[o + 3] - a0));
      if (d > tol) continue;
      mask.data[o] = 255; mask.data[o + 1] = 255; mask.data[o + 2] = 255; mask.data[o + 3] = 255;
      const px = idx % this.doc.width;
      if (px > 0) stack.push(idx - 1);
      if (px < this.doc.width - 1) stack.push(idx + 1);
      if (idx >= this.doc.width) stack.push(idx - this.doc.width);
      if (idx < seen.length - this.doc.width) stack.push(idx + this.doc.width);
    }
    const tmp = makeCanvas(this.doc.width, this.doc.height);
    ctx2d(tmp).putImageData(mask, 0, 0);
    const main = this.ctx;
    main.save();
    if (this.op === 'new') main.clearRect(0, 0, this.doc.width, this.doc.height);
    if (this.op === 'sub') main.globalCompositeOperation = 'destination-out';
    main.drawImage(tmp, 0, 0);
    main.restore();
    this.active = true;
    this._ants = null;
    this.doc.emit('selection');
  }

  invert() {
    const tmp = makeCanvas(this.doc.width, this.doc.height);
    const g = ctx2d(tmp);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, this.doc.width, this.doc.height);
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(this.canvas, 0, 0);
    this.ctx.clearRect(0, 0, this.doc.width, this.doc.height);
    this.ctx.drawImage(tmp, 0, 0);
    this.active = true;
    this._ants = null;
    this.doc.emit('selection');
  }

  clear() {
    this.ctx.clearRect(0, 0, this.doc.width, this.doc.height);
    this.active = false;
    this._ants = null;
    this.doc.emit('selection');
  }

  bounds() {
    const d = this.ctx.getImageData(0, 0, this.doc.width, this.doc.height).data;
    let x0 = this.doc.width, y0 = this.doc.height, x1 = -1, y1 = -1;
    for (let y = 0; y < this.doc.height; y++) {
      for (let x = 0; x < this.doc.width; x++) {
        if (d[(y * this.doc.width + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  antsCanvas() {
    if (this._ants) return this._ants;
    const c = makeCanvas(this.doc.width, this.doc.height);
    const g = ctx2d(c);
    const d = this.ctx.getImageData(0, 0, this.doc.width, this.doc.height).data;
    g.strokeStyle = 'rgba(255,255,255,.9)';
    g.lineWidth = 1.4;
    const w = this.doc.width;
    g.beginPath();
    for (let y = 0; y < this.doc.height; y++) {
      for (let x = 0; x < w; x++) {
        const a = d[(y * w + x) * 4 + 3];
        if (a < 8) continue;
        const l = x > 0 ? d[(y * w + x - 1) * 4 + 3] : 0;
        const r = x < w - 1 ? d[(y * w + x + 1) * 4 + 3] : 0;
        const u = y > 0 ? d[((y - 1) * w + x) * 4 + 3] : 0;
        const dn = y < this.doc.height - 1 ? d[((y + 1) * w + x) * 4 + 3] : 0;
        if (l < 8) { g.moveTo(x, y); g.lineTo(x, y + 1); }
        if (r < 8) { g.moveTo(x + 1, y); g.lineTo(x + 1, y + 1); }
        if (u < 8) { g.moveTo(x, y); g.lineTo(x + 1, y); }
        if (dn < 8) { g.moveTo(x, y + 1); g.lineTo(x + 1, y + 1); }
      }
    }
    g.stroke();
    this._ants = c;
    return c;
  }

  clipTo(ctx) {
    const tmp = makeCanvas(this.doc.width, this.doc.height);
    const g = ctx2d(tmp);
    g.drawImage(ctx.canvas, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(this.canvas, 0, 0);
    const main = ctx2d(ctx.canvas);
    main.clearRect(0, 0, this.doc.width, this.doc.height);
    main.drawImage(tmp, 0, 0);
    return tmp;
  }

  applyToCanvas(canvas) {
    const g = ctx2d(canvas);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(this.canvas, 0, 0);
    g.globalCompositeOperation = 'source-over';
  }

  thresholdMask(t) {
    const img = this.ctx.getImageData(0, 0, this.doc.width, this.doc.height);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] >= t * 255 ? 255 : 0;
    this.ctx.putImageData(img, 0, 0);
    this._ants = null;
  }
}

export const isEmptySelection = (sel) => !sel || !sel.active;
