import { $, el, clamp, makeCanvas, ctx2d, rgbToHsv, hsvToRgb, rgbToHex, hexToRgb } from './util.js';
import { clearTipCache } from './brush.js';
import { TransformSession } from './transform.js';
import { state, toast } from './appstate.js';
import * as store from './store.js';
import * as sfx from './sfx.js';

let hsv = [22, 0.72, 1];

export function setupColor() {
  const wheel = $('#wheel');
  const sv = $('#svBox');
  // Hue ring with the current colour shown in the middle.
  const drawWheel = () => {
    const css = wheel.clientWidth || 196;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    wheel.width = css * dpr; wheel.height = css * dpr;
    const g = ctx2d(wheel);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = css / 2, ring = 22, mid = r - ring / 2 - 2;
    g.clearRect(0, 0, css, css);
    g.save();
    g.beginPath();
    g.arc(r, r, r - 2, 0, Math.PI * 2);
    g.arc(r, r, r - 2 - ring, 0, Math.PI * 2, true);
    g.clip('evenodd');
    if (g.createConicGradient) {
      // Hue 0 at 12 o'clock, increasing clockwise (matches the picker maths).
      const cg = g.createConicGradient(-Math.PI / 2, r, r);
      for (let h = 0; h <= 360; h += 30) cg.addColorStop(h / 360, `hsl(${h} 100% 50%)`);
      g.fillStyle = cg;
      g.fillRect(0, 0, css, css);
    } else {
      for (let a = 0; a < 360; a += 2) {
        const start = ((a - 90) * Math.PI) / 180;
        g.beginPath(); g.moveTo(r, r); g.arc(r, r, r, start, start + (2.6 * Math.PI) / 180); g.closePath();
        g.fillStyle = `hsl(${a} 100% 50%)`; g.fill();
      }
    }
    g.restore();
    const a = (hsv[0] * Math.PI) / 180 - Math.PI / 2;
    const kx = r + Math.cos(a) * mid, ky = r + Math.sin(a) * mid;
    g.beginPath();
    g.arc(kx, ky, ring / 2 + 2, 0, Math.PI * 2);
    g.fillStyle = `hsl(${hsv[0]} 100% 50%)`;
    g.fill();
    g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
    g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.arc(kx, ky, ring / 2 + 3.5, 0, Math.PI * 2); g.stroke();
  };
  const drawSv = () => {
    const w = sv.clientWidth || 284, h = sv.clientHeight || 72;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    sv.width = w * dpr; sv.height = h * dpr;
    const g = ctx2d(sv);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(1, `hsl(${hsv[0]} 100% 50%)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const vg = g.createLinearGradient(0, 0, 0, h);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
    const x = hsv[1] * w, y = (1 - hsv[2]) * h;
    g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2);
    g.fillStyle = state.primary; g.fill();
    g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
    g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.arc(x, y, 10.5, 0, Math.PI * 2); g.stroke();
  };
  const pick = (e, canvas, fn) => {
    const r = canvas.getBoundingClientRect();
    fn(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height));
  };
  let picking = false;
  wheel.onpointerdown = (e) => {
    picking = true; wheel.setPointerCapture(e.pointerId);
    pick(e, wheel, (x, y) => { hsv[0] = ((Math.atan2(y - 0.5, x - 0.5) * 180) / Math.PI + 90 + 360) % 360; applyHsv(); });
  };
  wheel.onpointermove = (e) => { if (picking) pick(e, wheel, (x, y) => { hsv[0] = ((Math.atan2(y - 0.5, x - 0.5) * 180) / Math.PI + 90 + 360) % 360; applyHsv(); }); };
  wheel.onpointerup = () => { picking = false; };
  sv.onpointerdown = (e) => { picking = true; sv.setPointerCapture(e.pointerId); pick(e, sv, (x, y) => { hsv[1] = x; hsv[2] = 1 - y; applyHsv(); }); };
  sv.onpointermove = (e) => { if (picking) pick(e, sv, (x, y) => { hsv[1] = x; hsv[2] = 1 - y; applyHsv(); }); };
  sv.onpointerup = () => { picking = false; };
  $('#hue').oninput = (e) => { hsv[0] = +e.target.value; applyHsv(); };
  $('#sat').oninput = (e) => { hsv[1] = +e.target.value / 100; applyHsv(); };
  $('#val').oninput = (e) => { hsv[2] = +e.target.value / 100; applyHsv(); };
  $('#alpha').oninput = (e) => { state.alpha = +e.target.value / 100; syncColorUI(); };
  state._drawWheel = drawWheel;
  state._drawSv = drawSv;

  setupColor.swap = () => {
    [state.primary, state.secondary] = [state.secondary, state.primary];
    syncColorUI();
    saveColors();
  };
  setupColor.addSwatch = () => {
    const p = state.palettes[state.paletteIndex] || state.palettes[0];
    if (!p) return;
    if (!p.colors.includes(state.primary)) p.colors.push(state.primary);
    store.savePalettes(state.palettes);
    renderSwatches();
  };
}

function applyHsv() {
  const [r, g, b] = hsvToRgb(hsv[0], hsv[1], hsv[2]);
  state.primary = rgbToHex(r, g, b);
  syncColorUI(false);
  state._drawWheel?.();
  state._drawSv?.();
  saveColors();
}

export function syncColorUI(full = true) {
  const [r, g, b] = hexToRgb(state.primary);
  const [h, s, v] = rgbToHsv(r, g, b);
  // While dragging the picker keep its own hue/sat (a grey would otherwise snap the hue to red).
  if (full) hsv = [h, s, v];
  if (!full) {
    $('#hue').value = Math.round(hsv[0]); $('#sat').value = hsv[1] * 100; $('#val').value = hsv[2] * 100;
  }
  if (full) {
    $('#hue').value = Math.round(h);
    $('#sat').value = s * 100;
    $('#val').value = v * 100;
    $('#alpha').value = state.alpha * 100;
    state._drawWheel?.();
    state._drawSv?.();
  }
  $('#primaryWell').style.background = state.primary;
  const sw = $('#wheelSwatch');
  if (sw) sw.style.background = state.primary;
  // Slider tracks show the colour each slider produces.
  const root = $('#colorPanel');
  root.style.setProperty('--sat-a', rgbToHex(...hsvToRgb(hsv[0], 0, hsv[2])));
  root.style.setProperty('--sat-b', rgbToHex(...hsvToRgb(hsv[0], 1, hsv[2])));
  root.style.setProperty('--val-b', rgbToHex(...hsvToRgb(hsv[0], hsv[1], 1)));
  root.style.setProperty('--alpha-b', state.primary);
  $('#secondaryWell').style.background = state.secondary;
  $('#primaryWell').style.opacity = state.alpha;
  renderSwatches();
}

function renderSwatches() {
  const wrap = $('#swatches');
  wrap.innerHTML = '';
  const palette = state.palettes[state.paletteIndex] || state.palettes[0];
  if (!palette) return;
  wrap.append(el('div', { class: 'swatch-head' },
    el('b', {}, palette.name),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn small ghost', onclick: () => { state.paletteIndex = (state.paletteIndex + 1) % state.palettes.length; renderSwatches(); } }, 'Next')));
  for (const c of palette.colors) {
    const s = el('button', { class: 'swatch' + (c.toLowerCase() === state.primary.toLowerCase() ? ' on' : ''), style: { background: c }, 'aria-label': c });
    s.dataset.sfx = 'pick';
    s.onclick = () => { state.primary = c; syncColorUI(); saveColors(); };
    wrap.append(s);
  }
}

function saveColors() {
  state.prefs.primary = state.primary;
  state.prefs.secondary = state.secondary;
  store.savePrefs(state.prefs);
}

export function syncBrushSliders() {
  const size = Math.round(state.brush.size * 1000);
  $('#sizeSlider').value = size;
  $('#sizeVal').textContent = String(size);
  $('#opacitySlider').value = Math.round(state.brush.opacity * 100);
  $('#opacityVal').textContent = `${Math.round(state.brush.opacity * 100)}%`;
  const soft = state.brush.shape === 'hard' ? 0 : Math.round((1 - clamp(state.brush.hardness ?? 0.55, 0.01, 0.94)) * 100);
  $('#softSlider').value = soft;
  $('#softVal').textContent = `${soft}%`;
}

export function selectBrush(p) {
  // Deep copy so Brush Studio tweaks don't silently edit the saved preset's nested settings.
  state.brush = JSON.parse(JSON.stringify(p));
  syncBrushSliders();
  const bn = $('#brushName');
  if (bn) bn.textContent = state.brush.name || 'Brushes';
  state.brush.mode = state.tool === 'erase' ? 'erase' : state.tool === 'smudge' ? 'smudge' : 'paint';
  clearTipCache();
}

/* ---------- transform ---------- */

export function startTransform() {
  const doc = state.doc;
  const l = doc?.paintable;
  if (!l) { toast('Pick a paint layer to transform'); return false; }
  if (!doc.canAllocate(1)) { toast('Not enough canvas memory to transform'); return false; }
  state.transform = new TransformSession(doc, l, state.sel);
  doc.liveTransform = state.transform;
  const bar = el('div', { id: 'transformBar' });
  bar.append(
    el('button', { class: 'btn small primary', 'data-sfx': 'none', onclick: commitTransform }, 'Done'),
    el('button', { class: 'btn small', onclick: (e) => { state.transform?.ensureWarp(); e.currentTarget.classList.add('on'); sfx.play('toggleOn'); } }, 'Warp'),
    el('button', { class: 'btn small', onclick: () => {
      const t = state.transform;
      if (t) { t.tx = 0; t.ty = 0; t.scaleX = 1; t.scaleY = 1; t.rotate = 0; t.warp = null; }
      state.view.request();
    } }, 'Reset'),
    el('button', { class: 'btn small ghost', 'data-sfx': 'none', onclick: () => cancelTransform() }, 'Cancel'));
  $('#studio').append(bar);
  state.view.request();
  return true;
}

function endTransform(t) {
  $('#transformBar')?.remove();
  state.transform = null;
  state.transformDrag = null;
  if (t.doc.liveTransform === t) t.doc.liveTransform = null;
}

export function commitTransform() {
  const t = state.transform;
  if (!t) return;
  endTransform(t);
  t.commit();
  sfx.play('success');
  state.view?.request();
  state.quietTools = true;
  if (state.tool === 'transform') state.setTool?.('brush');
  state.quietTools = false;
}

export function cancelTransform() {
  const t = state.transform;
  if (!t) return;
  endTransform(t);
  t.cancel();
  sfx.play('close');
  state.view?.request();
  state.quietTools = true;
  if (state.tool === 'transform') state.setTool?.('brush');
  state.quietTools = false;
}

/* ---------- text ---------- */

export function placeText({ text, font, size }) {
  const doc = state.doc;
  if (!doc || !text.trim()) return;
  const l = doc.addLayer({ name: 'Text', type: 'text', textData: { text, font, size, color: state.primary } });
  if (!l) return;
  const g = ctx2d(l.canvas);
  const px = Math.max(8, size * (doc.width / 760));
  g.fillStyle = state.primary;
  g.globalAlpha = state.alpha;
  g.font = `600 ${px}px ${font}`;
  g.textBaseline = 'top';
  const maxW = doc.width * 0.8;
  let line = '', y = doc.height * 0.25;
  // Respect the line breaks typed in the box, then word-wrap each paragraph.
  for (const para of text.split('\n')) {
    line = '';
    for (const word of para.split(/[ \t]+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (g.measureText(test).width > maxW && line) {
        g.fillText(line, doc.width * 0.1, y);
        y += px * 1.3;
        line = word;
      } else line = test;
    }
    if (line) g.fillText(line, doc.width * 0.1, y);
    y += px * 1.3;
  }
  g.globalAlpha = 1;
  state.setTool?.('brush');
  state.refreshView?.();
  sfx.play('add');
  toast('Text layer added');
}

/* ---------- reference ---------- */

let refTimer = 0;
export function toggleReference() {
  const pane = $('#refPane');
  pane.classList.toggle('hidden');
  clearInterval(refTimer);
  if (pane.classList.contains('hidden')) return;
  const drawRef = () => {
    const c = $('#refCanvas');
    const doc = state.doc;
    if (!doc) return;
    const w = c.clientWidth || 300;
    const h = Math.round(w * (doc.height / doc.width));
    c.width = w; c.height = h;
    const g = ctx2d(c);
    g.fillStyle = doc.bgCss();
    g.fillRect(0, 0, w, h);
    g.drawImage(doc.compositeCanvas(), 0, 0, w, h);
  };
  drawRef();
  refTimer = setInterval(drawRef, 900);
}

