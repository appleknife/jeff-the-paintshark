import { makeCanvas, ctx2d, uid, clamp, rgbToHex } from './util.js';
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
    this.canvas = makeCanvas(doc.width, doc.height);
  }
  thumb(size = 64) {
    const c = makeCanvas(size, size * (this.doc.height / this.doc.width));
    const g = ctx2d(c);
    g.fillStyle = '#2a2a2e';
    g.fillRect(0, 0, c.width, c.height);
    if (this.canvas) g.drawImage(this.canvas, 0, 0, c.width, c.height);
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
    this._compositeOverride = null;
    this.undoStack = [];
    this.redoStack = [];
    this.undoLimit = 24;
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

  addLayer(opts = {}, above) {
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
      this.pushStructureUndo();
      this.activeId = layer.id;
      this.emit('layers');
    }
    return layer;
  }

  groupSelected(ids) {
    const sel = ids.map((i) => this.findLayer(i)).filter(Boolean);
    if (!sel.length) return;
    const idx = this.layers.indexOf(sel[sel.length - 1]);
    const g = new Group(this);
    this.layers.splice(idx + 1, 0, g);
    for (const l of sel) {
      const li = this.layers.indexOf(l);
      if (li >= 0) {
        this.layers.splice(li, 1);
        l.group = g;
        g.children.push(l);
      }
    }
    this.activeId = g.id;
    this.pushStructureUndo();
    this.emit('layers');
  }

  duplicateLayer(layer = this.active) {
    if (!layer) return;
    const copy = new Layer(this, { name: `${layer.name} copy`, type: layer.type, textData: layer.textData });
    const g = ctx2d(copy.canvas);
    g.drawImage(layer.canvas, 0, 0);
    copy.opacity = layer.opacity;
    copy.blend = layer.blend;
    copy.alphaLock = layer.alphaLock;
    copy.clipping = layer.clipping;
    const list = this.parentList(layer);
    list.splice(list.indexOf(layer) + 1, 0, copy);
    copy.group = layer.group;
    this.activeId = copy.id;
    this.pushStructureUndo();
    this.emit('layers');
    return copy;
  }

  removeLayer(layer = this.active) {
    if (!layer || this.layers.length + (layer.group ? 1 : 0) <= 1 && !layer.group) return;
    const list = this.parentList(layer);
    if (list.length <= 1 && list === this.layers) return;
    list.splice(list.indexOf(layer), 1);
    if (this.activeId === layer.id) this.activeId = list[Math.max(0, list.length - 1)]?.id || null;
    this.pushStructureUndo();
    this.emit('layers');
  }

  layerFlatList() {
    const out = [];
    const walk = (list) => { for (const l of list) { out.push(l); if (l.children) walk(l.children); } };
    walk(this.layers);
    return out.reverse();
  }

  pushUndo(layer) {
    if (!layer || !layer.canvas) return;
    const snap = makeCanvas(this.width, this.height);
    ctx2d(snap).drawImage(layer.canvas, 0, 0);
    this.undoStack.push({ kind: 'pixels', layerId: layer.id, canvas: snap });
    if (this.undoStack.length > this.undoLimit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  pushStructureUndo() {
    const snap = {
      kind: 'structure',
      layers: this.serializeLayers(true),
      activeId: this.activeId,
    };
    this.undoStack.push(snap);
    if (this.undoStack.length > this.undoLimit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    this.redoStack.push({ kind: 'redo-pixels', target: snap });
    if (snap.kind === 'pixels') {
      const l = this.findLayer(snap.layerId);
      if (l) {
        const now = makeCanvas(this.width, this.height);
        ctx2d(now).drawImage(l.canvas, 0, 0);
        this.redoStack.push({ kind: 'pixels', layerId: l.id, canvas: now });
        const g = ctx2d(l.canvas);
        g.clearRect(0, 0, this.width, this.height);
        g.drawImage(snap.canvas, 0, 0);
      }
    } else {
      this.restoreLayers(snap.layers);
      this.activeId = snap.activeId;
    }
    this.emit('layers');
    return true;
  }

  redo() {
    const snap = this.redoStack.pop();
    if (!snap) return false;
    if (snap.kind === 'redo-pixels') return this.redo();
    if (snap.kind === 'pixels') {
      const l = this.findLayer(snap.layerId);
      if (l) {
        this.undoStack.push({ kind: 'pixels', layerId: l.id, canvas: makeCanvas(1, 1) });
        const g = ctx2d(l.canvas);
        g.clearRect(0, 0, this.width, this.height);
        g.drawImage(snap.canvas, 0, 0);
      }
    }
    this.emit('layers');
    return true;
  }

  serializeLayers(withPixels) {
    const ser = (list) => list.map((l) => ({
      id: l.id, type: l.type, name: l.name, visible: l.visible, opacity: l.opacity,
      blend: l.blend, alphaLock: l.alphaLock, clipping: l.clipping, textData: l.textData,
      children: l.children ? ser(l.children) : null,
      png: withPixels && l.canvas ? l.canvas.toDataURL('image/png') : null,
      mask: l.mask ? l.mask.toDataURL('image/png') : null,
    }));
    return ser(this.layers);
  }

  restoreLayers(list) {
    const build = (arr, group) => {
      const out = [];
      for (const d of arr) {
        const l = d.type === 'group' ? new Group(this, { name: d.name }) : new Layer(this, { name: d.name, type: d.type, textData: d.textData });
        l.id = d.id;
        l.visible = d.visible; l.opacity = d.opacity; l.blend = d.blend;
        l.alphaLock = d.alphaLock; l.clipping = d.clipping; l.group = group;
        if (d.children) l.children = build(d.children, l);
        if (d.png) {
          const img = new Image();
          img.onload = () => { const g = ctx2d(l.canvas); g.clearRect(0, 0, this.width, this.height); g.drawImage(img, 0, 0); this.emit('layers'); };
          img.src = d.png;
        }
        out.push(l);
      }
      return out;
    };
    this.layers = build(list, null);
  }

  compositeCanvas() {
    if (!this._dirty && this._comp) return this._comp;
    this.render(this._comp, null);
    this._dirty = false;
    return this._comp;
  }

  render(target, activeStroke) {
    const g = ctx2d(target);
    g.save();
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, this.width, this.height);
    if (this.bgAlpha > 0) {
      g.globalAlpha = this.bgAlpha;
      g.fillStyle = this.bgColor;
      g.fillRect(0, 0, this.width, this.height);
      g.globalAlpha = 1;
    }
    this._renderList(g, this.layers, activeStroke, null);
    g.restore();
  }

  _scratch() {
    if (!this._pool) this._pool = [];
    const i = this._poolIdx = (this._poolIdx || 0);
    this._poolIdx = i + 1;
    if (!this._pool[i] || this._pool[i].width !== this.width || this._pool[i].height !== this.height) {
      this._pool[i] = makeCanvas(this.width, this.height);
    }
    const c = this._pool[i];
    const g = ctx2d(c);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, this.width, this.height);
    return c;
  }

  _renderList(g, list, activeStroke, clipBase) {
    this._poolIdx = 0;
    for (const layer of list) {
      if (!layer.visible || layer.opacity <= 0) continue;
      const stroking = activeStroke && activeStroke.layer === layer;
      const needsTemp = !!layer.children || !!layer.mask || stroking || layer.clipping;
      let src = layer.canvas;

      if (layer.children) {
        const tmp = this._scratch();
        const tg = ctx2d(tmp);
        this._renderList(tg, layer.children, activeStroke, null);
        if (layer.mask) {
          tg.globalCompositeOperation = 'destination-in';
          tg.drawImage(layer.mask, 0, 0);
          tg.globalCompositeOperation = 'source-over';
        }
        this._drawBlended(g, tmp, layer, clipBase);
        clipBase = layer.clipping ? (clipBase || tmp) : null;
        continue;
      }

      if (needsTemp) {
        const tmp = this._scratch();
        const tg = ctx2d(tmp);
        tg.drawImage(layer.canvas, 0, 0);
        if (stroking) {
          tg.globalCompositeOperation = activeStroke.mode === 'erase' ? 'destination-out' : 'source-over';
          tg.drawImage(activeStroke.strokeCanvas, 0, 0);
          tg.globalCompositeOperation = 'source-over';
        }
        if (layer.mask) {
          tg.globalCompositeOperation = 'destination-in';
          tg.drawImage(layer.mask, 0, 0);
          tg.globalCompositeOperation = 'source-over';
        }
        src = tmp;
      }

      this._drawBlended(g, src, layer, clipBase);
      if (!layer.clipping) clipBase = src;
    }
  }

  _layerBelow(layer) {
    const list = this.parentList(layer);
    const i = list.indexOf(layer);
    for (let j = i - 1; j >= 0; j--) if (list[j].visible) return list[j];
    return null;
  }

  _drawBlended(g, srcCanvas, layer, clipBase) {
    const mode = layer.blend;
    const alpha = layer.opacity;
    if (mode === 'destination-out') {
      g.save(); g.globalAlpha = alpha; g.globalCompositeOperation = 'destination-out';
      g.drawImage(srcCanvas, 0, 0); g.restore();
      return;
    }
    if (mode === 'normal') {
      g.save(); g.globalAlpha = alpha; g.drawImage(srcCanvas, 0, 0); g.restore();
      return;
    }
    if (NATIVE_BLENDS.has(mode)) {
      g.save(); g.globalAlpha = alpha;
      g.globalCompositeOperation = mode === 'add' ? 'lighter' : mode;
      g.drawImage(srcCanvas, 0, 0); g.restore();
      return;
    }
    const bd = g.getImageData(0, 0, this.width, this.height);
    const sd = ctx2d(srcCanvas).getImageData(0, 0, this.width, this.height);
    const B = bd.data, S = sd.data;
    const mix = (bv, sv) => {
      switch (mode) {
        case 'add': return bv + sv;
        case 'subtract': return bv - sv;
        case 'divide': return sv === 0 ? 1 : bv / sv;
        case 'linear-burn': case 'plus-darker': return bv + sv - 1;
        case 'vivid-light': return sv <= 0.5 ? 2 * sv + bv - 1 : 1 - 2 * (1 - sv) * (1 - bv);
        case 'pin-light': return sv <= 0.5 ? Math.min(bv, 2 * sv) : Math.max(bv, 2 * sv - 1);
        case 'hard-mix': return bv + sv >= 1 ? 1 : 0;
        case 'screen-print': return 1 - (1 - bv) * (1 - sv);
        default: return sv;
      }
    };
    for (let i = 0; i < S.length; i += 4) {
      const sa = (S[i + 3] / 255) * alpha;
      if (sa === 0) continue;
      const br = B[i] / 255, bg = B[i + 1] / 255, bb = B[i + 2] / 255;
      const sr = S[i] / 255, sg = S[i + 1] / 255, sb = S[i + 2] / 255;
      B[i] = (B[i] + (clamp(mix(br, sr)) * 255 - B[i]) * sa);
      B[i + 1] = (B[i + 1] + (clamp(mix(bg, sg)) * 255 - B[i + 1]) * sa);
      B[i + 2] = (B[i + 2] + (clamp(mix(bb, sb)) * 255 - B[i + 2]) * sa);
      B[i + 3] = Math.min(255, B[i + 3] + (255 - B[i + 3]) * sa);
    }
    g.putImageData(bd, 0, 0);
  }

  flatten() {
    const out = makeCanvas(this.width, this.height);
    this.render(out, null);
    return out;
  }

  resize(w, h) {
    for (const l of this.layerFlatList()) {
      const nc = makeCanvas(w, h);
      ctx2d(nc).drawImage(l.canvas, 0, 0);
      l.canvas = nc;
    }
    this.width = w; this.height = h;
    this._comp = makeCanvas(w, h);
    this._dirty = true;
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
        if (!l.children) entries.push({ name: `${base}.png`, data: await new Promise((r) => l.canvas.toBlob(r, 'image/png')) });
        if (l.mask) entries.push({ name: `${base}.mask.png`, data: await new Promise((r) => l.mask.toBlob(r, 'image/png')) });
        if (l.children) await walk(l.children, `${base}/`);
      }
    };
    await walk(this.layers, 'layers/');
    return writeZipSafe(entries);
  }
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
