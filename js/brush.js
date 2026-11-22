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

export function tipCanvas(preset) {
  const key = [preset.shape, preset.shapeRoundness, preset.grain, preset.grainDepth, preset.grainScale,
    preset.grainInverted, preset.shapeInverted, preset.textureDepth].join('|');
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
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.5);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.82, 'rgba(255,255,255,0.55)');
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

  if (preset.grain && preset.grainDepth > 0) {
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
  if (tipCache.size > 40) tipCache.delete(tipCache.keys().next().value);
  tipCache.set(key, c);
  return c;
}

export function clearTipCache() { tipCache.clear(); tintCache.clear(); }

const tintCache = new Map();

export function tintedTip(preset, color) {
  const base = tipCanvas(preset);
  if (!color) return base;
  const key = `${preset.shape}|${preset.grain}|${preset.grainDepth}|${preset.shapeRoundness}|${color.join(',')}`;
  if (tintCache.has(key)) return tintCache.get(key);
  const c = makeCanvas(base.width, base.height);
  const g = ctx2d(c);
  g.drawImage(base, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${color[3] ?? 1})`;
  g.fillRect(0, 0, c.width, c.height);
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
    this.enabled = true;
    this.last = null;
    this.smooth = null;
    this.distance = 0;
    this.taperPos = 0;
    this.totalLength = 0;
    this.tip = this.mode === 'erase' ? tipCanvas(this.brush) : (this.color ? tintedTip(this.brush, this.color) : tipCanvas(this.brush));
    this.strokeCanvas = makeCanvas(this.doc.width, this.doc.height);
    this.sg = ctx2d(this.strokeCanvas);
    this._wetColor = null;
    this.baseAspect = this.brush.stamp ? 1 : clamp(this.brush.shapeRoundness, 0.1, 1);
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
    const opacity = clamp(b.opacity * pa * (b.flow || 1), 0, 1);
    const angle = (b.shapeAngle * Math.PI) + (b.shapeAzimuth && tilt > 0.02 ? azimuth : 0);
    const scatter = b.shapeScatter * base * 2;

    const drawOne = (sx, sy, rot) => {
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
        this.sg.drawImage(this.tip, -size / 2, -size / 2, size, size);
        this.sg.restore();
      }
    };

    const rot = angle + (b.angleJitter ? (Math.random() - 0.5) * b.angleJitter * Math.PI : 0);
    if (this.mode === 'smudge') this._smudge(x, y, size, opacity, rot);
    else {
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
    if (this.symmetry.includes('x')) draw(w - x, y, -rot);
    if (this.symmetry.includes('y')) draw(x, h - y, Math.PI - rot);
    if (this.symmetry.includes('quad')) { draw(w - x, h - y, rot + Math.PI); }
    if (this.symmetry === 'radial' || this.symmetry === 'rotational') {
      const cx = w / 2, cy = h / 2, r = Math.hypot(x - cx, y - cy);
      const a0 = Math.atan2(y - cy, x - cx);
      const n = 6;
      for (let i = 1; i < n; i++) {
        const a = a0 + (i * Math.PI * 2) / n;
        draw(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rot + (i * Math.PI * 2) / n);
      }
    }
  }

  begin(pt) {
    const p = { ...pt, t: performance.now() };
    this.smooth = { ...p };
    this.last = p;
    this.taperPos = 0;
    this.totalLength = 0;
    this.sg.globalCompositeOperation = 'source-over';
    this._stamp(p.x, p.y, p.pressure, p.tilt, p.azimuth, 0, 0);
  }

  move(pt) {
    if (!this.smooth) return;
    const p = { ...pt, t: performance.now() };
    const s = this.brush.streamline;
    const mf = this.brush.motionFilter;
    this.smooth.x = lerp(this.smooth.x, p.x, 1 - s * 0.82);
    this.smooth.y = lerp(this.smooth.y, p.y, 1 - s * 0.82);
    this.smooth.pressure = lerp(this.smooth.pressure, p.pressure, 1 - mf * 0.7);
    this.smooth.tilt = lerp(this.smooth.tilt, p.tilt, 1 - mf * 0.5);
    this.smooth.azimuth = p.azimuth;
    const from = this.last;
    const to = this.smooth;
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) return;
    const spacing = Math.max(0.35, this.brush.spacing * Math.max(1, this.brush.size * this.doc.width));
    const speed = dist / Math.max(1, p.t - from.t);
    this.totalLength += dist;
    let travelled = 0;
    while (travelled + spacing <= dist) {
      travelled += spacing * (1 + (Math.random() - 0.5) * (this.brush.spacingJitter || 0));
      const f = travelled / dist;
      const x = from.x + dx * f, y = from.y + dy * f;
      const taper = this._taperAmount(this.totalLength);
      this._stamp(x, y, to.pressure, to.tilt, to.azimuth, speed, taper);
    }
    this.last = { ...to };
  }

  _taperAmount(len) {
    const b = this.brush;
    const startLen = b.taperStart * this.doc.width * 0.5;
    const endLen = b.taperEnd * this.doc.width * 0.5;
    let t = 0;
    if (startLen > 0 && len < startLen) t = Math.max(t, 1 - len / startLen);
    if (endLen > 0) {
      this._endLen = endLen;
    }
    return t;
  }

  end() {
    if (this._endLen > 0 && this.last) {
      const n = 8;
      for (let i = 1; i <= n; i++) {
        const f = 1 - i / (n + 1);
        this._stamp(this.last.x, this.last.y, this.last.pressure, this.last.tilt, this.last.azimuth, 0, 1 - f);
      }
    }
    this.commit();
  }

  commit() {
    this.doc.pushUndo(this.layer);
    const lc = this.layer.canvas;
    const lctx = ctx2d(lc);
    lctx.save();
    if (this.layer.alphaLock) lctx.globalCompositeOperation = 'source-atop';
    if (this.mode === 'erase') lctx.globalCompositeOperation = 'destination-out';
    if (this.selection) {
      const mask = this.selection.maskCanvas();
      const tmp = this.strokeCanvas;
      const tg = ctx2d(tmp);
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(mask, 0, 0);
      tg.globalCompositeOperation = 'source-over';
    }
    if (this.layer.opacity < 1) lctx.globalAlpha = 1;
    lctx.drawImage(this.strokeCanvas, 0, 0);
    lctx.restore();
    this.doc.emit('strokeEnd', { layer: this.layer });
    this.enabled = false;
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


