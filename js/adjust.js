import { makeCanvas, ctx2d, clamp, rgbToHsv, hsvToRgb, drawBlurred, releaseCanvas } from './util.js';

// Channel values live in Uint8ClampedArrays, which clamp to 0–255 by themselves.
// (clamp() defaults to 0–1, which turned every pixel black in several filters.)

export const ADJUSTMENTS = [
  { id: 'hsb', name: 'Hue, Saturation, Brightness', color: true },
  { id: 'color-balance', name: 'Color Balance' },
  { id: 'curves', name: 'Curves' },
  { id: 'gradient-map', name: 'Gradient Map' },
  { id: 'blur', name: 'Gaussian Blur' },
  { id: 'motion-blur', name: 'Motion Blur' },
  { id: 'perspective-blur', name: 'Perspective Blur' },
  { id: 'sharpen', name: 'Sharpen' },
  { id: 'noise', name: 'Noise' },
  { id: 'halftone', name: 'Halftone' },
  { id: 'glitch', name: 'Glitch' },
  { id: 'chromatic', name: 'Chromatic Aberration' },
  { id: 'glow', name: 'Bloom' },
  { id: 'gradient', name: 'Gradient' },
];

const DEFAULT_PARAMS = {
  hsb: { h: 0, s: 0, b: 0 },
  'color-balance': { shadows: 0, midtones: 0, highlights: 0, preserve: true },
  curves: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
  'gradient-map': { a: '#1b2a6b', b: '#ffb347' },
  blur: { radius: 12 },
  'motion-blur': { radius: 16, angle: 0 },
  'perspective-blur': { focus: 0.5, radius: 18 },
  sharpen: { amount: 0.6 },
  noise: { amount: 0.18, color: true },
  halftone: { size: 5, angle: 45 },
  glitch: { amount: 0.2, slices: 16 },
  chromatic: { amount: 3 },
  glow: { radius: 18, threshold: 0.65, strength: 0.6 },
  gradient: { angle: 90, a: '#ffffff', b: '#000000', opacity: 1 },
};

export const defaultParams = (kind) => JSON.parse(JSON.stringify(DEFAULT_PARAMS[kind] || {}));

const lutFrom = (points) => {
  const lut = new Uint8ClampedArray(256);
  const pts = [...points].sort((a, b) => a.x - b.x);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let y = x;
    if (pts.length) {
      if (x <= pts[0].x) y = pts[0].y;
      else if (x >= pts[pts.length - 1].x) y = pts[pts.length - 1].y;
      else for (let j = 1; j < pts.length; j++) {
        if (x <= pts[j].x) {
          const a = pts[j - 1], b = pts[j];
          y = a.y + (b.y - a.y) * ((x - a.x) / Math.max(1e-6, b.x - a.x));
          break;
        }
      }
    }
    lut[i] = clamp(y) * 255;
  }
  return lut;
};

export function applyAdjustment(doc, layer, kind, params, selection = null) {
  const w = doc.width, h = doc.height;
  const canvas = layer.canvas;
  const g = ctx2d(canvas);

  const pixelPass = (fn) => {
    const img = g.getImageData(0, 0, w, h);
    fn(img.data, w, h);
    g.putImageData(img, 0, 0);
  };

  const source = makeCanvas(w, h);
  ctx2d(source).drawImage(canvas, 0, 0);

  switch (kind) {
    case 'hsb': {
      const hue = params.h / 360, sat = params.s / 100, bri = params.b / 100;
      pixelPass((d) => {
        for (let i = 0; i < d.length; i += 4) {
          if (!d[i + 3]) continue;
          let [hh, ss, vv] = rgbToHsv(d[i], d[i + 1], d[i + 2]);
          hh = (hh / 360 + hue) * 360;
          ss = clamp(ss + sat);
          vv = clamp(vv + bri);
          const [r, gg, b] = hsvToRgb(hh, ss, vv);
          d[i] = r; d[i + 1] = gg; d[i + 2] = b;
        }
      });
      break;
    }
    case 'color-balance': {
      pixelPass((d) => {
        const sh = params.shadows / 100, mid = params.midtones / 100, hi = params.highlights / 100;
        for (let i = 0; i < d.length; i += 4) {
          const l = (d[i] + d[i + 1] + d[i + 2]) / 765;
          const wsh = Math.pow(1 - l, 2), whi = Math.pow(l, 2), wmid = 1 - wsh - whi;
          const amt = (sh * wsh + mid * wmid + hi * whi) * 90;
          d[i] = d[i] + amt * 0.65;
          d[i + 1] = d[i + 1] + amt * 0.15;
          d[i + 2] = d[i + 2] - amt * 0.55;
        }
      });
      break;
    }
    case 'curves': {
      const lut = lutFrom(params.points || []);
      pixelPass((d) => { for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; } });
      break;
    }
    case 'gradient-map': {
      const { a, b } = params;
      const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
      const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
      pixelPass((d) => {
        for (let i = 0; i < d.length; i += 4) {
          if (!d[i + 3]) continue;
          const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
          d[i] = pa[0] + (pb[0] - pa[0]) * l;
          d[i + 1] = pa[1] + (pb[1] - pa[1]) * l;
          d[i + 2] = pa[2] + (pb[2] - pa[2]) * l;
        }
      });
      break;
    }
    case 'blur': {
      // Safari has no ctx.filter, so drawBlurred falls back to a software blur.
      g.clearRect(0, 0, w, h);
      drawBlurred(canvas, source, params.radius);
      break;
    }
    case 'sharpen': {
      const blurred = makeCanvas(w, h);
      const bg = ctx2d(blurred);
      drawBlurred(blurred, source, 2);
      const a = g.getImageData(0, 0, w, h);
      const b = bg.getImageData(0, 0, w, h);
      releaseCanvas(blurred);
      for (let i = 0; i < a.data.length; i += 4) {
        for (let c = 0; c < 3; c++) a.data[i + c] = a.data[i + c] + (a.data[i + c] - b.data[i + c]) * params.amount * 2.4;
      }
      g.putImageData(a, 0, 0);
      break;
    }
    case 'noise': {
      pixelPass((d) => {
        for (let i = 0; i < d.length; i += 4) {
          if (!d[i + 3]) continue;
          if (params.color) {
            d[i] = d[i] + (Math.random() - 0.5) * 255 * params.amount;
            d[i + 1] = d[i + 1] + (Math.random() - 0.5) * 255 * params.amount;
            d[i + 2] = d[i + 2] + (Math.random() - 0.5) * 255 * params.amount;
          } else {
            const n = (Math.random() - 0.5) * 255 * params.amount;
            d[i] = d[i] + n; d[i + 1] = d[i + 1] + n; d[i + 2] = d[i + 2] + n;
          }
        }
      });
      break;
    }
    case 'halftone': {
      // Dots on a rotated grid; each samples the pixel under its own centre.
      const size = Math.max(2, params.size);
      const data = ctx2d(source).getImageData(0, 0, w, h).data;
      g.clearRect(0, 0, w, h);
      const rad = (params.angle * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const reach = Math.hypot(w, h) / 2 + size;
      g.save();
      g.translate(w / 2, h / 2);
      g.rotate(rad);
      for (let y = -reach; y < reach; y += size) {
        for (let x = -reach; x < reach; x += size) {
          const ix = Math.round(w / 2 + x * cos - y * sin), iy = Math.round(h / 2 + x * sin + y * cos);
          if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
          const o = (iy * w + ix) * 4;
          if (data[o + 3] < 8) continue;
          const l = 1 - (data[o] * 0.3 + data[o + 1] * 0.59 + data[o + 2] * 0.11) / 255;
          const r = (size / 2) * Math.sqrt(Math.max(0.08, l)) * 1.15;
          g.fillStyle = `rgba(${data[o]},${data[o + 1]},${data[o + 2]},${data[o + 3] / 255})`;
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.restore();
      break;
    }
    case 'glitch': {
      pixelPass((d, ww, hh) => {
        const slices = Math.max(1, Math.round(params.slices));
        const sh = Math.max(1, Math.floor(hh / slices));
        for (let s = 0; s < slices; s++) {
          if (Math.random() > 0.55) continue;
          const off = Math.round((Math.random() - 0.5) * ww * params.amount);
          const y0 = s * sh;
          const row = new Uint8ClampedArray(d.subarray(y0 * ww * 4, Math.min(d.length, (y0 + sh) * ww * 4)));
          for (let y = y0; y < Math.min(hh, y0 + sh); y++) {
            for (let x = 0; x < ww; x++) {
              const srcX = ((x - off) % ww + ww) % ww;
              const o = (y * ww + x) * 4;
              const so = ((y - y0) * ww + srcX) * 4;
              d[o] = row[so]; d[o + 1] = row[so + 1]; d[o + 2] = row[so + 2]; d[o + 3] = row[so + 3];
            }
          }
        }
      });
      break;
    }
    case 'chromatic': {
      const a = Math.round(params.amount);
      const out = makeCanvas(w, h);
      const og = ctx2d(out);
      og.globalCompositeOperation = 'lighter';
      og.fillStyle = 'rgba(0,0,0,1)';
      releaseCanvas(out);
      const rC = makeCanvas(w, h), bC = makeCanvas(w, h);
      ctx2d(rC).drawImage(source, a, 0);
      ctx2d(bC).drawImage(source, -a, 0);
      g.clearRect(0, 0, w, h);
      const rd = ctx2d(rC).getImageData(0, 0, w, h).data;
      const bd = ctx2d(bC).getImageData(0, 0, w, h).data;
      const gd = ctx2d(source).getImageData(0, 0, w, h).data;
      const outImg = g.createImageData(w, h);
      for (let i = 0; i < outImg.data.length; i += 4) {
        outImg.data[i] = rd[i];
        outImg.data[i + 1] = gd[i + 1];
        outImg.data[i + 2] = bd[i + 2];
        outImg.data[i + 3] = gd[i + 3];
      }
      g.putImageData(outImg, 0, 0);
      releaseCanvas(rC); releaseCanvas(bC);
      break;
    }
    case 'glow': {
      const bright = makeCanvas(w, h);
      const bg = ctx2d(bright);
      const img = g.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const l = (img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11) / 255;
        const keep = l > params.threshold ? 255 : 0;
        img.data[i + 3] = keep ? 255 : 0;
      }
      bg.putImageData(img, 0, 0);
      const halo = makeCanvas(w, h);
      g.globalCompositeOperation = 'screen';
      g.globalAlpha = params.strength;
      for (let i = 1; i <= 3; i++) {
        ctx2d(halo).clearRect(0, 0, w, h);
        drawBlurred(halo, bright, params.radius * i * 0.4);
        g.drawImage(halo, 0, 0);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      releaseCanvas(halo); releaseCanvas(bright);
      break;
    }
    case 'motion-blur': {
      g.clearRect(0, 0, w, h);
      const steps = 18;
      g.globalAlpha = 1 / steps * 2.2;
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1) - 0.5;
        const dx = Math.cos((params.angle * Math.PI) / 180) * params.radius * t;
        const dy = Math.sin((params.angle * Math.PI) / 180) * params.radius * t;
        g.drawImage(source, dx, dy);
      }
      g.globalAlpha = 1;
      break;
    }
    case 'perspective-blur': {
      // Sharp in the focus band, blurred towards the top and bottom (tilt-shift).
      const blurred = makeCanvas(w, h);
      drawBlurred(blurred, source, params.radius * 0.5);
      const fade = makeCanvas(w, h);
      const fg = ctx2d(fade);
      fg.drawImage(source, 0, 0);
      const grad = fg.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(clamp(params.focus - 0.18), 'rgba(0,0,0,1)');
      grad.addColorStop(clamp(params.focus + 0.18), 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      fg.globalCompositeOperation = 'destination-in';
      fg.fillStyle = grad;
      fg.fillRect(0, 0, w, h);
      g.clearRect(0, 0, w, h);
      g.drawImage(blurred, 0, 0);
      // Mask the blurred copy out where the sharp band is fully opaque, then lay the band on top.
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(fade, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.drawImage(fade, 0, 0);
      releaseCanvas(blurred); releaseCanvas(fade);
      break;
    }
    case 'gradient': {
      const rad = (params.angle * Math.PI) / 180;
      const x = Math.cos(rad) * w, y = Math.sin(rad) * h;
      const grad = g.createLinearGradient(w / 2 - x / 2, h / 2 - y / 2, w / 2 + x / 2, h / 2 + y / 2);
      grad.addColorStop(0, params.a);
      grad.addColorStop(1, params.b);
      g.save();
      g.globalAlpha = params.opacity;
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.restore();
      break;
    }
    default: break;
  }
  if (selection) {
    // Only the selected area changes: put the untouched pixels back outside it.
    const keep = makeCanvas(w, h);
    const kg = ctx2d(keep);
    kg.drawImage(source, 0, 0);
    kg.globalCompositeOperation = 'destination-out';
    kg.drawImage(selection.canvas, 0, 0);
    g.save();
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(selection.canvas, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.drawImage(keep, 0, 0);
    g.restore();
    releaseCanvas(keep);
  }
  releaseCanvas(source);
  doc.emit('strokeEnd', { layer });
}
