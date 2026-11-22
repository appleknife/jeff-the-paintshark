import { makeCanvas, ctx2d, releaseCanvas, drawBlurred } from './util.js';

export class Selection {
  constructor(doc) {
    this.doc = doc;
    this._canvas = null; // allocated on first use to save canvas memory
    this.active = false;
    this.mode = 'freehand';
    this.op = 'new';
    this.feather = 0;
    this.threshold = 0.22;
    this._ants = null;
    this._points = [];
  }

  get allocated() { return !!this._canvas; }

  get canvas() {
    if (!this._canvas) this._canvas = makeCanvas(this.doc.width, this.doc.height);
    return this._canvas;
  }

  get ctx() { return ctx2d(this.canvas); }

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
  }

  addPoint(pt) { this._points.push(pt); }

  _changed() {
    this._ants = null;
    this.doc.emit('selection');
  }

  /** Combine `shape` (a full-size canvas, white = selected) into the selection using this.op. */
  _combine(shape) {
    const main = this.ctx;
    main.save();
    if (this.op === 'new' || !this.active) {
      main.clearRect(0, 0, this.doc.width, this.doc.height);
      main.drawImage(shape, 0, 0);
    } else if (this.op === 'add') {
      main.drawImage(shape, 0, 0);
    } else if (this.op === 'sub') {
      main.globalCompositeOperation = 'destination-out';
      main.drawImage(shape, 0, 0);
    } else if (this.op === 'intersect') {
      main.globalCompositeOperation = 'destination-in';
      main.drawImage(shape, 0, 0);
    }
    main.restore();
    this.active = this.op === 'sub' || this.op === 'intersect' ? !!this.bounds() : true;
    this._changed();
  }

  commit(points = this._points) {
    if (!points.length) return;
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
    // A tap (or a scribble too small to enclose anything) clears the selection, like Procreate.
    if (bw < 3 || bh < 3 || (this.mode === 'freehand' && points.length < 3)) {
      if (this.op === 'new') this.clear();
      return;
    }
    const tmp = makeCanvas(this.doc.width, this.doc.height);
    const g = ctx2d(tmp);
    g.fillStyle = '#fff';
    if (this.mode === 'rect') {
      g.fillRect(Math.min(...xs), Math.min(...ys), bw, bh);
    } else if (this.mode === 'ellipse') {
      g.beginPath();
      g.ellipse(Math.min(...xs) + bw / 2, Math.min(...ys) + bh / 2, bw / 2, bh / 2, 0, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fill(this._path2d(points));
    }
    let shape = tmp;
    if (this.feather > 0) {
      shape = makeCanvas(this.doc.width, this.doc.height);
      drawBlurred(shape, tmp, this.feather);
      releaseCanvas(tmp);
    }
    this._combine(shape);
    releaseCanvas(shape);
  }

  autoSelect(x, y) {
    const W = this.doc.width, H = this.doc.height;
    const sx = Math.round(x), sy = Math.round(y);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
    const src = this.doc.compositeCanvas();
    const img = ctx2d(src).getImageData(0, 0, W, H);
    const mask = new ImageData(W, H);
    const tol = Math.max(1, this.threshold * 255);
    const i0 = (sy * W + sx) * 4;
    const r0 = img.data[i0], g0 = img.data[i0 + 1], b0 = img.data[i0 + 2], a0 = img.data[i0 + 3];
    const seen = new Uint8Array(W * H);
    const stack = [sy * W + sx];
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
      const px = idx % W;
      if (px > 0) stack.push(idx - 1);
      if (px < W - 1) stack.push(idx + 1);
      if (idx >= W) stack.push(idx - W);
      if (idx < seen.length - W) stack.push(idx + W);
    }
    const tmp = makeCanvas(W, H);
    ctx2d(tmp).putImageData(mask, 0, 0);
    this._combine(tmp);
    releaseCanvas(tmp);
  }

  invert() {
    const tmp = makeCanvas(this.doc.width, this.doc.height);
    const g = ctx2d(tmp);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, this.doc.width, this.doc.height);
    if (this.active) {
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(this.canvas, 0, 0);
    }
    const main = this.ctx;
    main.clearRect(0, 0, this.doc.width, this.doc.height);
    main.drawImage(tmp, 0, 0);
    releaseCanvas(tmp);
    this.active = !!this.bounds();
    this._changed();
  }

  clear() {
    if (this._canvas) ctx2d(this._canvas).clearRect(0, 0, this.doc.width, this.doc.height);
    this.active = false;
    this._changed();
  }

  /** Replace the mask with `canvas` (used when a transform moves the selected pixels). */
  setMask(canvas) {
    const main = this.ctx;
    main.clearRect(0, 0, this.doc.width, this.doc.height);
    main.drawImage(canvas, 0, 0);
    this.active = !!this.bounds();
    this._changed();
  }

  bounds() {
    if (!this._canvas) return null;
    const W = this.doc.width, H = this.doc.height;
    const d = this.ctx.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      const row = y * W * 4;
      for (let x = 0; x < W; x++) {
        if (d[row + x * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /** Outline of the selection as a vector path (no extra full-size canvas needed). */
  antsPath() {
    if (this._ants) return this._ants;
    const p = new Path2D();
    if (!this._canvas) return (this._ants = p);
    const W = this.doc.width, H = this.doc.height;
    const d = this.ctx.getImageData(0, 0, W, H).data;
    const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] >= 128;
    // Merge horizontal runs and vertical runs of edge pixels into long segments.
    for (let y = 0; y <= H; y++) {
      let start = -1;
      for (let x = 0; x <= W; x++) {
        const edge = x < W && on(x, y) !== on(x, y - 1);
        if (edge && start < 0) start = x;
        if (!edge && start >= 0) { p.moveTo(start, y); p.lineTo(x, y); start = -1; }
      }
    }
    for (let x = 0; x <= W; x++) {
      let start = -1;
      for (let y = 0; y <= H; y++) {
        const edge = y < H && on(x, y) !== on(x - 1, y);
        if (edge && start < 0) start = y;
        if (!edge && start >= 0) { p.moveTo(x, start); p.lineTo(x, y); start = -1; }
      }
    }
    this._ants = p;
    return p;
  }

  applyToCanvas(canvas) {
    const g = ctx2d(canvas);
    g.save();
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(this.canvas, 0, 0);
    g.restore();
  }

  dispose() {
    releaseCanvas(this._canvas);
    this._canvas = null;
  }
}

export const isEmptySelection = (sel) => !sel || !sel.active;
