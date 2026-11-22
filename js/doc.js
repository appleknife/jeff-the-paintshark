import { makeCanvas, ctx2d, uid, clamp, releaseCanvas, CANVAS_BUDGET, isAppleMobile } from './util.js';
import { NATIVE_BLENDS } from './brush.js';

let layerSeq = 1;

export class Layer {
  constructor(doc, opts = {}) {
    this.doc = doc;
    this.id = uid();
    this.type = opts.type || 'paint';
    this.name = opts.name || `Layer ${layerSeq++}`;
    this.visible = true;
    this.opacity = 1;
    this.blend = 'normal';
    this.alphaLock = false;
    this.clipping = false;
    this.group = null;
    this.mask = null;
    this.children = null;
    this.textData = opts.textData || null;
    // Groups are rendered from their children, so they don't need a full-size canvas.
    this.canvas = this.type === 'group' ? makeCanvas(1, 1) : makeCanvas(doc.width, doc.height);
  }
  thumb(size = 64) {
    const c = makeCanvas(size, size * (this.doc.height / this.doc.width));
    const g = ctx2d(c);
    g.fillStyle = '#2a2a2e';
    g.fillRect(0, 0, c.width, c.height);
    if (this.canvas && !this.children) g.drawImage(this.canvas, 0, 0, c.width, c.height);
    return c;
  }
}

export class Group extends Layer {
  constructor(doc, opts = {}) {
    super(doc, { ...opts, type: 'group', name: opts.name || 'Group' });
    this.children = [];
  }
}

const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

const UNDO_BYTES = isAppleMobile ? 192 * 1024 * 1024 : 640 * 1024 * 1024;
const HIDDEN_BASE = Symbol('hidden clip base');

export class Doc {
  constructor(opts = {}) {
    this.id = opts.id || uid();
    this.name = opts.name || 'Untitled Artwork';
    this.width = opts.width || 2048;
    this.height = opts.height || 2048;
    this.dpi = opts.dpi || 132;
    this.bgColor = opts.bgColor || '#ffffff';
    this.bgAlpha = opts.bgAlpha ?? 1;
    this.layers = [];
    this.activeId = null;
    this.selection = null;
    this.symmetry = 'off';
    this.guide = { type: 'off', color: '#4da3ff', opacity: 0.5, size: 1, perspective: false };
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.frame = 0;
    this.onion = { enabled: false, before: 1, after: 1, opacity: 0.4, color: '#ff5a5a' };
    this.timelapse = [];
    this.lastSave = 0;
    this._listeners = new Map();
    this._dirty = true;
    this._comp = makeCanvas(this.width, this.height);
    this._free = [];
    this._poolCount = 0;
    this._strokeBuf = null;
    this.liveTransform = null;
    this.undoStack = [];
    this.redoStack = [];
    this.undoLimit = 40;
    this._batch = null;
    this.addLayer({ silent: true });
    this.activeId = this.layers[0].id;
    this.createdAt = Date.now();
    this.dirtyMeta = false;
  }

  on(evt, fn) {
    if (!this._listeners.has(evt)) this._listeners.set(evt, new Set());
    this._listeners.get(evt).add(fn);
    return () => this._listeners.get(evt).delete(fn);
  }
  emit(evt, data) {
    this._dirty = true;
    this.dirtyMeta = true;
    for (const fn of this._listeners.get(evt) || []) fn(data);
  }

  get active() {
    return this.findLayer(this.activeId);
  }

  /** The active layer if pixels can be painted on it (not a group). */
  get paintable() {
    const l = this.active;
    return l && !l.children ? l : null;
  }

  findLayer(id) {
    const walk = (list) => {
      for (const l of list) {
        if (l.id === id) return l;
        if (l.children) {
          const r = walk(l.children);
          if (r) return r;
        }
      }
      return null;
    };
    return walk(this.layers);
  }

  parentList(layer) {
    if (!layer) return this.layers;
    if (layer.group) return layer.group.children;
    return this.layers;
  }

  /* ---------- canvas memory budget ---------- */

  canvasBytes() {
    const px = this.width * this.height * 4;
    let n = 2 + this._poolCount + (this._strokeBuf ? 1 : 0) + (this.selection?.allocated ? 1 : 0);
    for (const l of this.layerFlatList()) {
      if (!l.children) n++;
      if (l.mask) n++;
    }
    return n * px;
  }

  /** True if `count` more full-size canvases fit in the browser's canvas memory. */
  canAllocate(count = 1) {
    return this.canvasBytes() + count * this.width * this.height * 4 <= CANVAS_BUDGET;
  }

  addLayer(opts = {}, above) {
    if (!opts.silent && opts.type !== 'group' && !this.canAllocate(2)) { this.emit('limit'); return null; }
    if (!opts.silent) this.pushStructureUndo();
    const actual = above === undefined ? this.active : above;
    const layer = opts.type === 'group' ? new Group(this, opts) : new Layer(this, opts);
    if (actual) {
      const list = this.parentList(actual);
      list.splice(list.indexOf(actual) + 1, 0, layer);
      layer.group = actual.group;
    } else {
      this.layers.push(layer);
    }
    if (!opts.silent) {
      this.activeId = layer.id;
      this.emit('layers');
    }
    return layer;
  }

  groupSelected(ids) {
    const sel = ids.map((i) => this.findLayer(i)).filter(Boolean);
    if (!sel.length) return;
    const list = this.parentList(sel[0]);
    if (sel.some((l) => this.parentList(l) !== list)) return;
    this.pushStructureUndo();
    const parent = sel[0].group;
    const idx = Math.max(...sel.map((l) => list.indexOf(l)));
    const g = new Group(this);
    g.group = parent;
    list.splice(idx + 1, 0, g);
    for (const l of [...sel].sort((a, b) => list.indexOf(a) - list.indexOf(b))) {
      list.splice(list.indexOf(l), 1);
      l.group = g;
      g.children.push(l);
    }
    this.activeId = g.id;
    this.emit('layers');
  }

  duplicateLayer(layer = this.active) {
    if (!layer) return null;
    if (layer.children) return null;
    if (!this.canAllocate(2 + (layer.mask ? 1 : 0))) { this.emit('limit'); return null; }
    this.pushStructureUndo();
    const copy = new Layer(this, { name: `${layer.name} copy`, type: layer.type, textData: layer.textData });
    ctx2d(copy.canvas).drawImage(layer.canvas, 0, 0);
    copy.opacity = layer.opacity;
    copy.blend = layer.blend;
    copy.alphaLock = layer.alphaLock;
    copy.clipping = layer.clipping;
    copy.visible = layer.visible;
    if (layer.mask) {
      copy.mask = makeCanvas(this.width, this.height);
      ctx2d(copy.mask).drawImage(layer.mask, 0, 0);
    }
    const list = this.parentList(layer);
    list.splice(list.indexOf(layer) + 1, 0, copy);
    copy.group = layer.group;
    this.activeId = copy.id;
    this.emit('layers');
    return copy;
  }

  removeLayer(layer = this.active) {
    if (!layer) return false;
    const list = this.parentList(layer);
    // Always keep at least one layer at the top level.
    if (list === this.layers && list.length <= 1) return false;
    this.pushStructureUndo();
    const i = list.indexOf(layer);
    list.splice(i, 1);
    if (this.activeId === layer.id || !this.findLayer(this.activeId)) {
      const next = list[Math.max(0, i - 1)] || layer.group || this.layers[this.layers.length - 1];
      this.activeId = next?.id || null;
    }
    this.emit('layers');
    return true;
  }

  layerFlatList() {
    const out = [];
    const walk = (list) => { for (const l of list) { out.push(l); if (l.children) walk(l.children); } };
    walk(this.layers);
    return out.reverse();
  }

  /* ---------- undo / redo ----------
   * Every entry is applied by _apply(), which returns its own inverse, so undo and redo
   * are the same operation on opposite stacks. Pixel entries keep ImageData (JS heap, not
   * the capped canvas memory) for just the changed rectangle. Call pushUndo /
   * pushStructureUndo BEFORE making the change. */

  pushUndo(layer, rect) {
    if (!layer || !layer.canvas || layer.children) return;
    const r = this._clipRect(rect);
    if (!r) return;
    const data = ctx2d(layer.canvas).getImageData(r.x, r.y, r.w, r.h);
    this._pushEntry({ kind: 'pixels', layer, x: r.x, y: r.y, data });
  }

  /** Record pixels captured earlier (e.g. before a transform cut the layer). */
  pushUndoData(layer, data, x = 0, y = 0) {
    this._pushEntry({ kind: 'pixels', layer, x, y, data });
  }

  pushStructureUndo() {
    this._pushEntry({ kind: 'structure', tree: this._snapTree(), activeId: this.activeId });
  }

  /** Group every undo entry pushed inside fn() into one step. */
  batch(fn) {
    const outer = this._batch;
    const items = [];
    this._batch = items;
    try { return fn(); } finally {
      this._batch = outer;
      if (items.length) this._pushEntry(items.length === 1 ? items[0] : { kind: 'batch', items });
    }
  }

  _clipRect(rect) {
    const W = this.width, H = this.height;
    if (!rect) return { x: 0, y: 0, w: W, h: H };
    const x0 = clamp(Math.floor(rect.x), 0, W), y0 = clamp(Math.floor(rect.y), 0, H);
    const x1 = clamp(Math.ceil(rect.x + rect.w), 0, W), y1 = clamp(Math.ceil(rect.y + rect.h), 0, H);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  _pushEntry(e) {
    if (this._batch) { this._batch.push(e); return; }
    this.undoStack.push(e);
    this.redoStack.length = 0;
    this._trim();
  }

  _bytes(e) {
    if (e.kind === 'pixels') return e.data.data.length;
    if (e.kind === 'batch') return e.items.reduce((a, i) => a + this._bytes(i), 0);
    return 1024;
  }

  _trim() {
    let total = 0;
    for (const s of [this.undoStack, this.redoStack]) for (const e of s) total += this._bytes(e);
    while (this.undoStack.length > 1 && (this.undoStack.length > this.undoLimit || total > UNDO_BYTES)) {
      total -= this._bytes(this.undoStack.shift());
    }
  }

  _apply(e) {
    if (e.kind === 'pixels') {
      const g = ctx2d(e.layer.canvas);
      const cur = g.getImageData(e.x, e.y, e.data.width, e.data.height);
      g.putImageData(e.data, e.x, e.y);
      return { ...e, data: cur };
    }
    if (e.kind === 'structure') {
      const inv = { kind: 'structure', tree: this._snapTree(), activeId: this.activeId };
      this._restoreTree(e.tree);
      this.activeId = this.findLayer(e.activeId) ? e.activeId : this.layers[this.layers.length - 1].id;
      return inv;
    }
    const items = [];
    for (let i = e.items.length - 1; i >= 0; i--) items.push(this._apply(e.items[i]));
    return { kind: 'batch', items };
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return false;
    this.redoStack.push(this._apply(e));
    this.emit('layers');
    return true;
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.undoStack.push(this._apply(e));
    this._trim();
    this.emit('layers');
    return true;
  }

  _snapTree() {
    const snap = (list) => list.map((l) => ({
      layer: l, name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend,
      alphaLock: l.alphaLock, clipping: l.clipping, mask: l.mask,
      children: l.children ? snap(l.children) : null,
    }));
    return snap(this.layers);
  }

  _restoreTree(tree) {
    const build = (arr, group) => arr.map((n) => {
      const l = n.layer;
      l.name = n.name; l.visible = n.visible; l.opacity = n.opacity; l.blend = n.blend;
      l.alphaLock = n.alphaLock; l.clipping = n.clipping; l.mask = n.mask; l.group = group;
      if (n.children) l.children = build(n.children, l);
      return l;
    });
    this.layers = build(tree, null);
  }

  /* ---------- compositing ---------- */

  compositeCanvas() {
    this.render(this._comp, null);
    this._dirty = false;
    return this._comp;
  }

  /** Composite including the in-progress stroke / transform, for the viewport. */
  renderView(activeStroke) {
    this.render(this._comp, activeStroke);
    return this._comp;
  }

  strokeBuffer() {
    if (!this._strokeBuf || this._strokeBuf.width !== this.width || this._strokeBuf.height !== this.height) {
      this._strokeBuf = makeCanvas(this.width, this.height);
    }
    const g = ctx2d(this._strokeBuf);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, this.width, this.height);
    return this._strokeBuf;
  }

  render(target, activeStroke) {
    const g = ctx2d(target);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, this.width, this.height);
    if (this.bgAlpha > 0) {
      g.globalAlpha = this.bgAlpha;
      g.fillStyle = this.bgColor;
      g.fillRect(0, 0, this.width, this.height);
      g.globalAlpha = 1;
    }
    this._renderList(g, this.layers, activeStroke);
    g.restore();
  }

  _acquire() {
    let c = this._free.pop();
    if (!c || c.width !== this.width || c.height !== this.height) {
      c = makeCanvas(this.width, this.height);
      this._poolCount++;
    }
    const g = ctx2d(c);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, this.width, this.height);
    return c;
  }

  _release(c) { if (c) this._free.push(c); }

  _renderList(g, list, activeStroke) {
    // clipBase: pixels of the nearest non-clipping layer below, which clipping layers are cut to.
    let clipBase = null, baseOwned = false;
    const dropBase = () => { if (baseOwned) this._release(clipBase); clipBase = null; baseOwned = false; };

    for (const layer of list) {
      const clipped = layer.clipping && clipBase !== null;
      if (!layer.visible || layer.opacity <= 0) {
        if (!layer.clipping) { dropBase(); clipBase = HIDDEN_BASE; }
        continue;
      }
      if (clipped && clipBase === HIDDEN_BASE) continue;

      let src = layer.canvas, owned = false;
      if (layer.children) {
        src = this._acquire(); owned = true;
        this._renderList(ctx2d(src), layer.children, activeStroke);
      } else {
        const stroking = activeStroke && activeStroke.layer === layer;
        const live = this.liveTransform && this.liveTransform.layer === layer;
        if (layer.mask || stroking || live || clipped) {
          src = this._acquire(); owned = true;
          const tg = ctx2d(src);
          tg.drawImage(layer.canvas, 0, 0);
          if (live) this.liveTransform.render(src);
          if (stroking) this._previewStroke(tg, activeStroke, layer);
        }
      }
      if (owned) {
        const tg = ctx2d(src);
        if (layer.mask) {
          tg.globalCompositeOperation = 'destination-in';
          tg.drawImage(layer.mask, 0, 0);
        }
        if (clipped) {
          tg.globalCompositeOperation = 'destination-in';
          tg.drawImage(clipBase, 0, 0);
        }
        tg.globalCompositeOperation = 'source-over';
      }

      this._drawBlended(g, src, layer);

      if (!layer.clipping) { dropBase(); clipBase = src; baseOwned = owned; }
      else if (owned) this._release(src);
    }
    dropBase();
  }

  /** Show the stroke the way commit() will apply it: selection, alpha lock and erase included. */
  _previewStroke(tg, stroke, layer) {
    let buf = stroke.strokeCanvas, tmp = null;
    if (stroke.selection) {
      tmp = this._acquire();
      const sg = ctx2d(tmp);
      sg.drawImage(buf, 0, 0);
      sg.globalCompositeOperation = 'destination-in';
      sg.drawImage(stroke.selection.maskCanvas(), 0, 0);
      sg.globalCompositeOperation = 'source-over';
      buf = tmp;
    }
    tg.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : layer.alphaLock ? 'source-atop' : 'source-over';
    tg.drawImage(buf, 0, 0);
    tg.globalCompositeOperation = 'source-over';
    this._release(tmp);
  }

  _layerBelow(layer) {
    const list = this.parentList(layer);
    const i = list.indexOf(layer);
    for (let j = i - 1; j >= 0; j--) if (list[j].visible && !list[j].children) return list[j];
    return null;
  }

  _drawBlended(g, srcCanvas, layer) {
    const mode = layer.blend;
    const alpha = layer.opacity;
    if (mode === 'destination-out' || mode === 'normal' || NATIVE_BLENDS.has(mode)) {
      g.save();
      g.globalAlpha = alpha;
      g.globalCompositeOperation = mode === 'add' ? 'lighter' : mode === 'normal' ? 'source-over' : mode;
      g.drawImage(srcCanvas, 0, 0);
      g.restore();
      return;
    }
    const bd = g.getImageData(0, 0, this.width, this.height);
    const sd = ctx2d(srcCanvas).getImageData(0, 0, this.width, this.height);
    const B = bd.data, S = sd.data;
    const mix = (bv, sv) => {
      switch (mode) {
        case 'subtract': return bv - sv;
        case 'divide': return sv === 0 ? 1 : bv / sv;
        case 'linear-burn': case 'plus-darker': return bv + sv - 1;
        case 'vivid-light':
          if (sv <= 0.5) return sv === 0 ? 0 : 1 - (1 - bv) / (2 * sv);
          return sv === 1 ? 1 : bv / (2 * (1 - sv));
        case 'pin-light': return sv <= 0.5 ? Math.min(bv, 2 * sv) : Math.max(bv, 2 * sv - 1);
        case 'hard-mix': return bv + sv >= 1 ? 1 : 0;
        case 'screen-print': return 1 - (1 - bv) * (1 - sv);
        default: return sv;
      }
    };
    for (let i = 0; i < S.length; i += 4) {
      const sa = (S[i + 3] / 255) * alpha;
      if (sa === 0) continue;
      const ba = B[i + 3] / 255;
      const br = B[i] / 255, bg = B[i + 1] / 255, bb = B[i + 2] / 255;
      const sr = S[i] / 255, sg = S[i + 1] / 255, sb = S[i + 2] / 255;
      // Where the backdrop is transparent the source shows through unblended.
      const mr = clamp(mix(br, sr)) * ba + sr * (1 - ba);
      const mg = clamp(mix(bg, sg)) * ba + sg * (1 - ba);
      const mb = clamp(mix(bb, sb)) * ba + sb * (1 - ba);
      const oa = sa + ba * (1 - sa);
      B[i] = ((mr * sa + br * ba * (1 - sa)) / oa) * 255;
      B[i + 1] = ((mg * sa + bg * ba * (1 - sa)) / oa) * 255;
      B[i + 2] = ((mb * sa + bb * ba * (1 - sa)) / oa) * 255;
      B[i + 3] = oa * 255;
    }
    g.putImageData(bd, 0, 0);
  }

  flatten() {
    const out = makeCanvas(this.width, this.height);
    this.render(out, null);
    return out;
  }

  resize(w, h) {
    const grow = (c) => { const nc = makeCanvas(w, h); ctx2d(nc).drawImage(c, 0, 0); releaseCanvas(c); return nc; };
    for (const l of this.layerFlatList()) {
      if (!l.children) l.canvas = grow(l.canvas);
      if (l.mask) l.mask = grow(l.mask);
    }
    this.width = w; this.height = h;
    releaseCanvas(this._comp);
    this._comp = makeCanvas(w, h);
    for (const c of this._free) releaseCanvas(c);
    this._free = []; this._poolCount = 0;
    this.undoStack = []; this.redoStack = [];
    this._dirty = true;
  }

  /** Free every canvas this document owns (call when closing it). */
  dispose() {
    for (const l of this.layerFlatList()) { releaseCanvas(l.canvas); releaseCanvas(l.mask); }
    for (const c of this._free) releaseCanvas(c);
    releaseCanvas(this._comp);
    releaseCanvas(this._strokeBuf);
    this.selection?.dispose?.();
    this._free = [];
    this.undoStack = []; this.redoStack = [];
  }

  bgCss() { return this.bgAlpha > 0 ? hexA(this.bgColor, this.bgAlpha) : 'transparent'; }

  async serialize() {
    const entries = [];
    const meta = {
      app: 'paintshark', version: 1, id: this.id, name: this.name,
      width: this.width, height: this.height, dpi: this.dpi,
      bgColor: this.bgColor, bgAlpha: this.bgAlpha, activeId: this.activeId,
      createdAt: this.createdAt, format: 'rgba-png',
    };
    entries.push({ name: 'doc.json', data: new Blob([JSON.stringify(meta)]) });
    const walk = async (list, prefix) => {
      for (let i = 0; i < list.length; i++) {
        const l = list[i];
        const base = `${prefix}${i}_${l.id}`;
        entries.push({ name: `${base}.json`, data: new Blob([JSON.stringify({
          id: l.id, type: l.type, name: l.name, visible: l.visible, opacity: l.opacity,
          blend: l.blend, alphaLock: l.alphaLock, clipping: l.clipping, textData: l.textData,
          hasChildren: !!l.children,
        })]) });
        if (!l.children) entries.push({ name: `${base}.png`, data: await canvasBlob(l.canvas) });
        if (l.mask) entries.push({ name: `${base}.mask.png`, data: await canvasBlob(l.mask) });
        if (l.children) await walk(l.children, `${base}/`);
      }
    };
    await walk(this.layers, 'layers/');
    return writeZipSafe(entries);
  }
}

function canvasBlob(c) {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Canvas could not be encoded'))), 'image/png'));
}

async function writeZipSafe(entries) {
  const { writeZip } = await import('./zip.js');
  return writeZip(entries);
}

export function layerThumbOf(layer) { return layer.thumb(); }

export function compositeThumb(doc, width = 160) {
  const h = Math.round(width * (doc.height / doc.width));
  const c = makeCanvas(width, h);
  const g = ctx2d(c);
  g.fillStyle = doc.bgCss();
  g.fillRect(0, 0, width, h);
  g.drawImage(doc.compositeCanvas(), 0, 0, width, h);
  return c;
}

export const thumbDataUrl = (doc, w = 160) => compositeThumb(doc, w).toDataURL('image/jpeg', 0.7);
