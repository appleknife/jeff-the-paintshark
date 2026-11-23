import { clamp, lerp, makeCanvas, ctx2d, hsvToRgb, rgbToHsv, uid } from './util.js';

export const BLEND_MODES = [
  ['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
  ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color Dodge'], ['color-burn', 'Color Burn'],
  ['linear-burn', 'Linear Burn'], ['hard-light', 'Hard Light'], ['soft-light', 'Soft Light'],
  ['vivid-light', 'Vivid Light'], ['pin-light', 'Pin Light'], ['hard-mix', 'Hard Mix'],
  ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['subtract', 'Subtract'],
  ['divide', 'Divide'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'],
  ['luminosity', 'Luminosity'], ['add', 'Add'], ['screen-print', 'Screen Print'], ['plus-darker', 'Plus Darker'],
  ['destination-out', 'Erase'],
];

export const NATIVE_BLENDS = new Set(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue',
  'saturation', 'color', 'luminosity', 'add']);

export const lerpCurve = (pts, t) => {
  if (!pts || pts.length === 0) return t;
  t = clamp(t);
  if (t <= pts[0].x) return pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].x) {
      const a = pts[i - 1], b = pts[i];
      const f = (t - a.x) / Math.max(1e-6, b.x - a.x);
      return lerp(a.y, b.y, f);
    }
  }
  return pts[pts.length - 1].y;
};

export const identityCurve = () => [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }];

export function defaultPreset(overrides = {}) {
  return {
    id: uid(),
    name: 'PaintShark Pencil',
    authorName: 'Jeff',
    mode: 'paint',
    shape: 'soft',
    shapeRoundness: 1,
    shapeAngle: 0,
    shapeCount: 1,
    shapeScatter: 0,
    shapeRandomise: true,
    shapeInverted: false,
    shapeAzimuth: false,
    grain: 'paper',
    grainDepth: 0.22,
    grainScale: 0.35,
    grainInverted: false,
    grainMode: 'multiply',
    textureDepth: 0.1,
    texture: null,
    grainTexture: null,
    spacing: 0.09,
    spacingJitter: 0.1,
    size: 0.09,
    minSize: 0.01,
    maxSize: 0.45,
    opacity: 1,
    flow: 1,
    jitter: 0.15,
    jitterLongitudinal: 0.1,
    scatterRoll: false,
    angleJitter: 0,
    taperStart: 0.15,
    taperEnd: 0.12,
    taperShape: 0.5,
    taperSize: 0,
    taperPressure: 1,
    streamline: 0.32,
    motionFilter: 0.25,
    wetMix: 0,
    wetEdges: 0,
    glaze: 0,
    smudgePull: 0.6,
    dynamics: {
      pressureSize: 0.85,
      pressureOpacity: 0.5,
      pressureFlow: 0,
      pressureWet: 0,
      pressureSizeCurve: identityCurve(),
      pressureOpacityCurve: identityCurve(),
      tiltSize: 0.25,
      tiltOpacity: 0,
      tiltRoundness: 0,
      speedSize: 0,
      speedOpacity: 0,
    },
    pressureResponse: 0.35,
    stamp: false,
    preview: true,
    ...overrides,
  };
}

const rngFrom = (seed) => {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
};

const tipCache = new Map();
const texCache = new Map();

export function preloadPresetTextures(presets) {
  const urls = new Set();
  for (const p of presets) {
    if (p.texture) urls.add(p.texture);
    if (p.grainTexture) urls.add(p.grainTexture);
  }
  return Promise.all([...urls].map((u) => new Promise((resolve) => {
    if (texCache.has(u)) return resolve();
    const img = new Image();
    img.onload = () => { texCache.set(u, img); resolve(); };
    img.onerror = resolve;
    img.src = u;
  }))).then(() => { clearTipCache(); });
}

const tipKey = (p) => [p.shape, p.shapeRoundness, p.hardness ?? 0.55, p.grain, p.grainDepth, p.grainScale,
  p.grainInverted, p.shapeInverted, p.textureDepth, p.texture, p.grainTexture].join('|');

export function tipCanvas(preset) {
  const key = tipKey(preset);
  if (tipCache.has(key)) return tipCache.get(key);
  const size = 256;
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const rnd = rngFrom([...key].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7));

  if (preset.shape === 'hard') {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2);
    g.fill();
  } else if (preset.shape === 'square') {
    g.fillStyle = '#fff';
    const s = size * 0.6;
    g.fillRect((size - s) / 2, (size - s) / 2, s, s);
  } else if (preset.shape === 'speckle') {
    for (let i = 0; i < 260; i++) {
      const r = 1 + rnd() * size * 0.02;
      g.globalAlpha = 0.2 + rnd() * 0.8;
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(rnd() * size, rnd() * size, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  } else {
    const fat = clamp(preset.shapeRoundness, 0.08, 1);
    const hard = clamp(preset.hardness ?? 0.55, 0.01, 0.94);
    // The original soft tip, kept exactly as it was: the gradient is built before the transform,
    // so its bright centre lands off to one side and each dab is a lopsided crescent with one
    // firm edge. Overlapping crescents are what give these brushes their streaky texture.
    // (Where it lands on the canvas is corrected in Stroke._stamp, using the tip's centroid.)
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.5);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(hard, 'rgba(255,255,255,0.95)');
    grad.addColorStop(hard + (1 - hard) * 0.6, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.save();
    g.translate(size / 2, size / 2);
    g.scale(fat, 1);
    g.beginPath();
    g.arc(0, 0, size * 0.48, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  const tipTex = preset.texture && texCache.get(preset.texture);
  if (tipTex) {
    g.clearRect(0, 0, size, size);
    const s = size * 0.94;
    g.drawImage(tipTex, (size - s) / 2, (size - s) / 2, s, s);
  }

  if (preset.grainTexture && texCache.has(preset.grainTexture) && preset.grainDepth > 0) {
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.globalAlpha = clamp(preset.grainDepth, 0, 1);
    g.drawImage(texCache.get(preset.grainTexture), 0, 0, size, size);
    g.restore();
  } else if (preset.grain && preset.grainDepth > 0) {
    const gc = makeCanvas(size, size);
    const gg = ctx2d(gc);
    const scale = Math.max(1, Math.round(size * clamp(preset.grainScale, 0.05, 1) * 0.12));
    if (preset.grain === 'canvas') {
      gg.strokeStyle = '#000';
      gg.globalAlpha = 0.55;
      for (let y = 0; y < size; y += scale) {
        gg.beginPath(); gg.moveTo(0, y); gg.lineTo(size, y); gg.stroke();
        gg.beginPath(); gg.moveTo(y, 0); gg.lineTo(y, size); gg.stroke();
      }
    } else if (preset.grain === 'spray') {
      for (let i = 0; i < 3000; i++) {
        gg.fillStyle = '#000';
        gg.globalAlpha = rnd() * 0.9;
        gg.fillRect(rnd() * size, rnd() * size, scale * 0.5, scale * 0.5);
      }
    } else if (preset.grain === 'noise') {
      const img = gg.createImageData(size, size);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = rnd() < 0.45 ? 0 : 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      gg.putImageData(img, 0, 0);
    } else {
      gg.fillStyle = '#fff';
      gg.fillRect(0, 0, size, size);
      for (let i = 0; i < 1400; i++) {
        gg.strokeStyle = 'rgba(0,0,0,.5)';
        gg.globalAlpha = 0.06 + rnd() * 0.3;
        gg.lineWidth = scale * (0.4 + rnd());
        const x = rnd() * size, y = rnd() * size, l = 2 + rnd() * scale * 4;
        gg.beginPath(); gg.moveTo(x, y); gg.lineTo(x + l, y + (rnd() - 0.5) * l); gg.stroke();
      }
    }
    gg.globalAlpha = 1;
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = clamp(preset.grainDepth, 0, 1);
    g.drawImage(gc, 0, 0);
    g.restore();
  }

  if (preset.shapeInverted || preset.grainInverted) {
    const tmp = makeCanvas(size, size);
    const tg = ctx2d(tmp);
    tg.fillStyle = '#fff';
    tg.fillRect(0, 0, size, size);
    tg.globalCompositeOperation = 'destination-out';
    tg.drawImage(c, 0, 0);
    g.clearRect(0, 0, size, size);
    g.drawImage(tmp, 0, 0);
  }
  measureCentroid(c);
  if (tipCache.size > 40) tipCache.delete(tipCache.keys().next().value);
  tipCache.set(key, c);
  return c;
}

/** Where the paint in a tip actually sits, as an offset from the tip's centre (in tip pixels). */
function measureCentroid(c) {
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
  let sx = 0, sy = 0, s = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const a = d[(y * c.width + x) * 4 + 3];
    sx += a * x; sy += a * y; s += a;
  }
  c.cx = s ? sx / s - (c.width - 1) / 2 : 0;
  c.cy = s ? sy / s - (c.height - 1) / 2 : 0;
}

export function clearTipCache() { tipCache.clear(); tintCache.clear(); }

const tintCache = new Map();

export function tintedTip(preset, color) {
  const base = tipCanvas(preset);
  if (!color) return base;
  const key = `${tipKey(preset)}|${color.join(',')}`;
  if (tintCache.has(key)) return tintCache.get(key);
  const c = makeCanvas(base.width, base.height);
  const g = ctx2d(c);
  g.drawImage(base, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${color[3] ?? 1})`;
  g.fillRect(0, 0, c.width, c.height);
  c.cx = base.cx; c.cy = base.cy;
  if (tintCache.size > 30) tintCache.delete(tintCache.keys().next().value);
  tintCache.set(key, c);
  return c;
}

export class Stroke {
  constructor(env) {
    this.brush = env.brush;
    this.color = env.color || [0, 0, 0];
    this.mode = env.mode || this.brush.mode || 'paint';
    this.doc = env.doc;
    this.layer = env.layer;
    this.selection = env.selection || null;
    this.symmetry = env.symmetry || 'off';
    // On-screen zoom when the stroke started. Tapers are measured on screen, so a stroke looks
    // the same whether you're zoomed out or zoomed right in.
    this.zoom = env.zoom || 0.35;
    this._lastSize = null;
    this.enabled = true;
    this.last = null;
    this.smooth = null;
    this.prevSmooth = null;
    this.totalLength = 0;
    this.tip = this.mode === 'erase' ? tipCanvas(this.brush) : (this.color ? tintedTip(this.brush, this.color) : tipCanvas(this.brush));
    // One shared, reused buffer per document instead of a new full-size canvas per stroke.
    this.strokeCanvas = this.doc.strokeBuffer();
    this.sg = ctx2d(this.strokeCanvas);
    this.bbox = null;
    // The tip is already squashed by shapeRoundness; don't squash it a second time here.
    this.baseAspect = 1;
  }

  _grow(x, y, r) {
    const b = this.bbox;
    if (!b) { this.bbox = { x0: x - r, y0: y - r, x1: x + r, y1: y + r }; return; }
    if (x - r < b.x0) b.x0 = x - r;
    if (y - r < b.y0) b.y0 = y - r;
    if (x + r > b.x1) b.x1 = x + r;
    if (y + r > b.y1) b.y1 = y + r;
  }

  _pressureScale(p, tiltMag, speed) {
    const d = this.brush.dynamics;
    const resp = clamp(1.6 - this.brush.pressureResponse, 0.2, 1.6);
    const pp = Math.pow(clamp(p), resp);
    let size = 1 + (lerpCurve(d.pressureSizeCurve, pp) - 0.5) * 2 * d.pressureSize;
    size *= 1 + tiltMag * d.tiltSize - clamp(speed / 3000) * d.speedSize;
    let alpha = clamp(1 - (1 - lerpCurve(d.pressureOpacityCurve, pp)) * d.pressureOpacity);
    alpha *= clamp(1 - speed / 4000 * d.speedOpacity);
    return { size: clamp(size, 0.08, 2.4), alpha: clamp(alpha, 0.02, 1) };
  }

  _stamp(x, y, pressure, tilt, azimuth, speed, taper) {
    const b = this.brush;
    const { size: ps, alpha: pa } = this._pressureScale(pressure, tilt, speed);
    const base = b.size * this.doc.width;
    let size = Math.max(0.6, base * ps);
    const taperMul = Math.max(0, 1 - taper);
    if (b.taperStart > 0 || b.taperEnd > 0) {
      size *= lerp(1, taperMul, clamp(Math.max(b.taperSize || 0, b.taperPressure || 0)));
    }
    this._lastSize = size;
    const opacity = clamp(b.opacity * pa * (b.flow || 1), 0, 1);
    const angle = (b.shapeAngle * Math.PI) + (b.shapeAzimuth && tilt > 0.02 ? azimuth : 0);
    const scatter = b.shapeScatter * base * 2;
    const reach = size * 0.75 + scatter + b.jitter * size * 0.2 + 2;

    const drawOne = (sx, sy, rot) => {
      this._grow(sx, sy, reach);
      for (let i = 0; i < Math.max(1, Math.round(b.shapeCount || 1)); i++) {
        let dx = 0, dy = 0;
        if (scatter > 0) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * scatter;
          dx = Math.cos(a) * r; dy = Math.sin(a) * r;
        }
        if (b.jitter > 0) {
          const j = b.jitter * size * 0.35;
          dx += (Math.random() - 0.5) * j;
          dy += (Math.random() - 0.5) * j;
        }
        this.sg.save();
        this.sg.globalAlpha = opacity;
        this.sg.translate(sx + dx, sy + dy);
        this.sg.rotate(rot);
        this.sg.scale(1, this.baseAspect);
        // Shift the dab so the painted part of the tip (not its bounding box) sits on the pen.
        const k = size / this.tip.width;
        this.sg.drawImage(this.tip, -size / 2 - (this.tip.cx || 0) * k, -size / 2 - (this.tip.cy || 0) * k, size, size);
        this.sg.restore();
      }
    };

    const rot = angle + (b.angleJitter ? (Math.random() - 0.5) * b.angleJitter * Math.PI : 0);
    if (this.mode === 'smudge') {
      this._grow(x, y, size + 2);
      this._smudge(x, y, size, opacity, rot);
    } else {
      if (b.wetMix > 0 && this.layer) this._wet(x, y, size, b.wetMix);
      drawOne(x, y, rot);
      this._mirror(drawOne, x, y, rot);
    }
  }

  _wet(x, y, size, mix) {
    const lc = this.layer.canvas;
    const s = Math.max(2, size * 0.8);
    const g = this.sg;
    g.save();
    g.globalAlpha = clamp(mix * 0.6, 0, 0.85);
    g.beginPath();
    g.arc(x, y, s * 0.42, 0, Math.PI * 2);
    g.clip();
    g.drawImage(lc, 0, 0);
    g.restore();
  }

  _smudge(x, y, size, opacity, rot) {
    const lc = this.layer.canvas;
    const s = Math.max(3, size);
    const g = this.sg;
    g.save();
    g.globalAlpha = clamp(opacity * clamp(this.brush.smudgePull, 0.05, 1));
    g.beginPath();
    g.arc(x, y, s * 0.5, 0, Math.PI * 2);
    g.clip();
    const dx = this.last ? x - this.last.x : 0, dy = this.last ? y - this.last.y : 0;
    g.drawImage(lc, -dx * 0.9, -dy * 0.9);
    g.restore();
  }

  _mirror(draw, x, y, rot) {
    if (this.symmetry === 'off') return;
    const w = this.doc.width, h = this.doc.height;
    if (this.symmetry === 'x') draw(w - x, y, -rot);
    else if (this.symmetry === 'y') draw(x, h - y, Math.PI - rot);
    else if (this.symmetry === 'quad') {
      draw(w - x, y, -rot);
      draw(x, h - y, Math.PI - rot);
      draw(w - x, h - y, rot + Math.PI);
    } else if (this.symmetry === 'radial' || this.symmetry === 'rotational') {
      const cx = w / 2, cy = h / 2, r = Math.hypot(x - cx, y - cy);
      const a0 = Math.atan2(y - cy, x - cx);
      const n = 6;
      for (let i = 1; i < n; i++) {
        const a = a0 + (i * Math.PI * 2) / n;
        draw(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rot + (i * Math.PI * 2) / n);
      }
      // Radial symmetry also mirrors each spoke; rotational only repeats it.
      if (this.symmetry === 'radial') {
        const m = Math.atan2(y - cy, -(x - cx));
        for (let i = 0; i < n; i++) {
          const a = m + (i * Math.PI * 2) / n;
          draw(cx + Math.cos(a) * r, cy + Math.sin(a) * r, -rot + (i * Math.PI * 2) / n);
        }
      }
    }
  }

  begin(pt) {
    const p = { ...pt, t: performance.now() };
    this.smooth = { ...p };
    this.prevSmooth = { ...p };
    this.last = p;
    this.totalLength = 0;
    this.origin = p;
    this.moved = false;
    this.sg.globalCompositeOperation = 'source-over';
    this._stamp(p.x, p.y, p.pressure, p.tilt, p.azimuth, 0, this._taperAmount(0));
  }

  move(pt) {
    if (!this.smooth) return;
    const p = { ...pt, t: performance.now() };
    this.raw = { ...pt };
    const s = this.brush.streamline;
    const mf = this.brush.motionFilter;
    this.smooth.x = lerp(this.smooth.x, p.x, 1 - s * 0.82);
    this.smooth.y = lerp(this.smooth.y, p.y, 1 - s * 0.82);
    this.smooth.pressure = lerp(this.smooth.pressure, p.pressure, 1 - mf * 0.7);
    this.smooth.tilt = lerp(this.smooth.tilt, p.tilt, 1 - mf * 0.5);
    this.smooth.azimuth = p.azimuth;
    this.smooth.t = p.t;
    this.totalLength += Math.hypot(this.smooth.x - this.prevSmooth.x, this.smooth.y - this.prevSmooth.y);
    this.prevSmooth = { ...this.smooth };

    // `last` is the position of the last stamp. It only advances when a stamp is placed, so
    // slow, short pencil moves accumulate until they cover one spacing step. (Previously it
    // jumped to the pointer every event, so slow strokes dropped every stamp and left gaps.)
    const from = this.last;
    const to = this.smooth;
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    const spacing = Math.max(0.35, this.brush.spacing * Math.max(1, this.brush.size * this.doc.width));
    const speed = dist / Math.max(1, to.t - from.t);
    let travelled = 0;
    let stamped = false;
    for (;;) {
      const step = spacing * (1 + (Math.random() - 0.5) * (this.brush.spacingJitter || 0));
      if (travelled + step > dist) break;
      travelled += step;
      const f = travelled / dist;
      const x = from.x + dx * f, y = from.y + dy * f;
      const taper = this._taperAmount(this.totalLength - (dist - travelled));
      this._stamp(x, y, to.pressure, to.tilt, to.azimuth, speed, taper);
      stamped = true;
    }
    if (stamped) {
      this.moved = true;
      const f = travelled / dist;
      this.last = { ...to, x: from.x + dx * f, y: from.y + dy * f };
    }
  }

  _taperAmount(len) {
    const b = this.brush;
    // Taper length in screen pixels (about 340 px at full taper), converted to canvas pixels.
    // It used to be a fraction of the canvas width, so zoomed in, whole strokes stayed thin specks.
    const startLen = b.taperStart * Math.min(this.doc.width * 0.5, 340 / this.zoom);
    if (startLen > 0 && len < startLen) return 1 - len / startLen;
    return 0;
  }

  end() {
    // Finish the line up to where the pen lifted (it may lag behind because of streamline).
    if (this.raw && this.brush.streamline > 0) {
      for (let i = 0; i < 6; i++) this.move({ ...this.raw });
    }
    // A tap with a tapered brush would otherwise leave nothing (the first stamp is fully tapered).
    if (!this.moved && this.origin && this._taperAmount(0) > 0) {
      const o = this.origin;
      this._stamp(o.x, o.y, o.pressure, o.tilt, o.azimuth, 0, 0.5);
    }
    this.commit();
  }

  /** Throw the stroke away without touching the layer (e.g. a second finger turned it into a gesture). */
  cancel() {
    this.enabled = false;
    this.sg.clearRect(0, 0, this.doc.width, this.doc.height);
  }

  commit() {
    if (!this.enabled) return;
    this.enabled = false;
    if (!this.bbox) return;
    const b = this.bbox;
    this.doc.pushUndo(this.layer, { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });
    const lc = this.layer.canvas;
    const lctx = ctx2d(lc);
    lctx.save();
    if (this.layer.alphaLock) lctx.globalCompositeOperation = 'source-atop';
    if (this.mode === 'erase') lctx.globalCompositeOperation = 'destination-out';
    if (this.selection) {
      const tg = this.sg;
      tg.save();
      tg.setTransform(1, 0, 0, 1, 0, 0);
      tg.globalAlpha = 1;
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(this.selection.maskCanvas(), 0, 0);
      tg.restore();
    }
    lctx.drawImage(this.strokeCanvas, 0, 0);
    lctx.restore();
    this.doc.emit('strokeEnd', { layer: this.layer });
  }
}

export function sampleCompositeColor(doc, x, y) {
  const c = doc.compositeCanvas();
  const d = ctx2d(c, { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

export function shiftHsv(rgb, dh, ds, dv) {
  const [h, s, v] = rgbToHsv(...rgb);
  return hsvToRgb(h + dh, clamp(s + ds), clamp(v + dv));
}


