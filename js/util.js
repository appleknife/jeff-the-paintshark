export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0, h = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

export const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

export function hexToRgb(hex) {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360 / 60;
  const i = Math.floor(h), f = h - i;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  const c = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
  return c.map((x) => Math.round(x * 255));
}

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

export const fmt = (v, digits = 0) => Number(v).toFixed(digits);

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// iOS Safari frees canvas backing memory lazily and caps the total (~384 MB), so
// temporary canvases are shrunk to zero as soon as they are no longer needed.
export function releaseCanvas(c) {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}

export const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

// Safari caps a single canvas at 16,777,216 pixels and all canvases together at ~384 MB.
export const MAX_CANVAS_AREA = 16777216;
export const CANVAS_BUDGET = isAppleMobile ? 300 * 1024 * 1024 : 2048 * 1024 * 1024;

export function fitArea(w, h, max = MAX_CANVAS_AREA) {
  if (w * h <= max) return [w, h];
  const k = Math.sqrt(max / (w * h));
  return [Math.max(1, Math.floor(w * k)), Math.max(1, Math.floor(h * k))];
}

let filterOk = null;
// Safari does not support CanvasRenderingContext2D.filter; detect it so callers can fall back.
export function canvasFilterSupported() {
  if (filterOk !== null) return filterOk;
  try {
    const g = document.createElement('canvas').getContext('2d');
    g.filter = 'blur(2px)';
    filterOk = g.filter === 'blur(2px)';
  } catch { filterOk = false; }
  return filterOk;
}

// Approximate gaussian blur: three box-blur passes on premultiplied RGBA, in place.
export function blurImageData(img, radius) {
  const r = Math.max(0, Math.round(radius)); // 3 box passes of radius r ≈ gaussian sigma r
  if (!r) return img;
  const { width: w, height: h, data } = img;
  const buf = new Float32Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    buf[i] = data[i] * a; buf[i + 1] = data[i + 1] * a; buf[i + 2] = data[i + 2] * a; buf[i + 3] = data[i + 3];
  }
  const tmp = new Float32Array(buf.length);
  const pass = (src, dst, len, count, stride, step) => {
    const norm = 1 / (2 * r + 1);
    for (let line = 0; line < count; line++) {
      const base = line * stride;
      for (let ch = 0; ch < 4; ch++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += src[base + Math.min(len - 1, Math.max(0, k)) * step + ch];
        for (let x = 0; x < len; x++) {
          dst[base + x * step + ch] = acc * norm;
          const add = Math.min(len - 1, x + r + 1), sub = Math.max(0, x - r);
          acc += src[base + add * step + ch] - src[base + sub * step + ch];
        }
      }
    }
  };
  for (let p = 0; p < 3; p++) {
    pass(buf, tmp, w, h, w * 4, 4);
    pass(tmp, buf, h, w, 4, w * 4);
  }
  for (let i = 0; i < data.length; i += 4) {
    const a = buf[i + 3];
    const k = a > 0 ? 255 / a : 0;
    data[i] = buf[i] * k; data[i + 1] = buf[i + 1] * k; data[i + 2] = buf[i + 2] * k; data[i + 3] = a;
  }
  return img;
}

// Draw `src` blurred into `dst` (same size), natively where possible.
export function drawBlurred(dst, src, radius) {
  const g = ctx2d(dst);
  if (radius <= 0) { g.drawImage(src, 0, 0); return; }
  if (canvasFilterSupported()) {
    g.filter = `blur(${radius}px)`;
    g.drawImage(src, 0, 0);
    g.filter = 'none';
    return;
  }
  const img = ctx2d(src).getImageData(0, 0, src.width, src.height);
  blurImageData(img, radius);
  const t = document.createElement('canvas');
  t.width = src.width; t.height = src.height;
  ctx2d(t).putImageData(img, 0, 0);
  g.drawImage(t, 0, 0);
  releaseCanvas(t);
}

export function ctx2d(canvas, opts = {}) {
  return canvas.getContext('2d', { alpha: true, willReadFrequently: true, ...opts });
}

export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

export const isIPad = /iPad|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;

export function download(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((res) => canvas.toBlob(res, type, quality));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

