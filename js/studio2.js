import { $, el, clamp, makeCanvas, ctx2d, rgbToHsv, hsvToRgb, rgbToHex, hexToRgb } from './util.js';
import { clearTipCache } from './brush.js';
import { TransformSession } from './transform.js';
import { state, toast } from './appstate.js';
import * as store from './store.js';

let hsv = [22, 0.72, 1];

export function setupColor() {
  const wheel = $('#wheel');
  const sv = $('#svBox');
  const drawWheel = () => {
    const s = wheel.clientWidth || 240;
    wheel.width = s; wheel.height = s;
    const g = ctx2d(wheel);
    const r = s / 2;
    for (let a = 0; a < 360; a += 2) {
      g.beginPath();
      g.moveTo(r, r);
      g.arc(r, r, r - 2, (a * Math.PI) / 180, ((a + 2.6 * Math.PI) / 180));
      g.closePath();
      g.fillStyle = `hsl(${a} 100% 50%)`;
      g.fill();
    }
    g.globalCompositeOperation = 'destination-in';
    g.beginPath(); g.arc(r, r, r - 2, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';
    const a = (hsv[0] * Math.PI) / 180 - Math.PI / 2;
    g.strokeStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.arc(r, r, r - 12, 0, Math.PI * 2); g.stroke();
    g.beginPath();
    g.arc(r + Math.cos(a) * (r - 12), r + Math.sin(a) * (r - 12), 6, 0, Math.PI * 2);
    g.fillStyle = `hsl(${hsv[0]} 100% 50%)`;
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.fill(); g.stroke();
  };
  const drawSv = () => {
    const w = sv.clientWidth || 240;
    sv.width = w; sv.height = 62;
    const g = ctx2d(sv);
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(1, `hsl(${hsv[0]} 100% 50%)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, 62);
    const vg = g.createLinearGradient(0, 0, 0, 62);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, 62);
    g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(hsv[1] * w, (1 - hsv[2]) * 62, 5, 0, Math.PI * 2); g.fill(); g.stroke();
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
  hsv = [h, s, v];
  if (full) {
    $('#hue').value = h;
    $('#sat').value = s * 100;
    $('#val').value = v * 100;
    $('#alpha').value = state.alpha * 100;
    state._drawWheel?.();
    state._drawSv?.();
  }
  $('#primaryWell').style.background = state.primary;
  $('#secondaryWell').style.background = state.secondary;
  $('#primaryWell').style.opacity = state.alpha;
  renderSwatches();
}

function renderSwatches() {
  const wrap = $('#swatches');
  wrap.innerHTML = '';
  const palette = state.palettes[state.paletteIndex] || state.palettes[0];
  if (!palette) return;
  wrap.append(el('div', { style: 'width:100%;display:flex;gap:6px;align-items:center;margin-bottom:4px' },
    el('b', { style: 'font-size:11px' }, palette.name),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn small ghost', onclick: () => { state.paletteIndex = (state.paletteIndex + 1) % state.palettes.length; renderSwatches(); } }, 'Next')));
  for (const c of palette.colors) {
    const s = el('button', { class: 'swatch', style: { background: c } });
    s.onclick = () => { state.primary = c; syncColorUI(); saveColors(); };
    wrap.append(s);
  }
}

function saveColors() {
  state.prefs.primary = state.primary;
  state.prefs.secondary = state.secondary;
  store.savePrefs(state.prefs);
}

export function selectBrush(p) {
  state.brush = { ...p };
  $('#sizeSlider').value = Math.round(state.brush.size * 1000);
  $('#sizeVal').textContent = `${Math.round(state.brush.size * 1000)}%`;
  $('#opacitySlider').value = Math.round(state.brush.opacity * 100);
  $('#opacityVal').textContent = `${Math.round(state.brush.opacity * 100)}%`;
  state.brush.mode = state.tool === 'erase' ? 'erase' : state.tool === 'smudge' ? 'smudge' : 'paint';
  clearTipCache();
}

/* ---------- transform ---------- */

let transformBase = null;

export function startTransform() {
  const doc = state.doc;
  const l = doc?.active;
  if (!l) return;
  state.transform = new TransformSession(doc, l, state.sel);
  state.view.transform = state.transform;
  transformBase = makeCanvas(doc.width, doc.height);
  ctx2d(transformBase).drawImage(l.canvas, 0, 0);
  if (state.sel.active) state.sel.applyToCanvas(transformBase);
  const bar = el('div', { id: 'transformBar', class: 'layer-opts',
    style: 'position:absolute;bottom:10px;left:50%;transform:translateX(-50%);z-index:8;background:#17181d;border:1px solid #2b2e37;border-radius:10px;display:flex;gap:6px;padding:6px' });
  bar.append(
    el('button', { class: 'btn small primary', onclick: commitTransform }, 'Done'),
    el('button', { class: 'btn small', onclick: () => { state.transform?.ensureWarp(); } }, 'Warp'),
    el('button', { class: 'btn small', onclick: () => {
      const t = state.transform;
      if (t) { t.tx = 0; t.ty = 0; t.scaleX = 1; t.scaleY = 1; t.rotate = 0; t.warp = null; }
      state.view.request();
    } }, 'Reset'),
    el('button', { class: 'btn small', onclick: cancelTransform }, 'Cancel'));
  $('#stageWrap').append(bar);
}

export function commitTransform() {
  const t = state.transform;
  if (!t) return;
  $('#transformBar')?.remove();
  t.doc.pushUndo(t.layer);
  const g = ctx2d(t.layer.canvas);
  g.clearRect(0, 0, t.doc.width, t.doc.height);
  g.drawImage(transformBase, 0, 0);
  t.commit();
  state.transform = null;
  state.view.transform = null;
  if (state.tool === 'transform') state.setTool?.('brush');
}

function cancelTransform() {
  const t = state.transform;
  if (!t) return;
  const g = ctx2d(t.layer.canvas);
  g.clearRect(0, 0, t.doc.width, t.doc.height);
  g.drawImage(transformBase, 0, 0);
  state.transform = null;
  $('#transformBar')?.remove();
  state.setTool?.('brush');
}

/* ---------- text ---------- */

export function placeText({ text, font, size }) {
  const doc = state.doc;
  if (!doc || !text.trim()) return;
  doc.pushStructureUndo();
  const l = doc.addLayer({ name: 'Text', type: 'text', textData: { text, font, size, color: state.primary } });
  const g = ctx2d(l.canvas);
  const px = Math.max(8, size * (doc.width / 760));
  g.fillStyle = state.primary;
  g.globalAlpha = state.alpha;
  g.font = `600 ${px}px ${font}`;
  g.textBaseline = 'top';
  const maxW = doc.width * 0.8;
  let line = '', y = doc.height * 0.25;
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, doc.width * 0.1, y);
      y += px * 1.3;
      line = word;
    } else line = test;
  }
  if (line) g.fillText(line, doc.width * 0.1, y);
  g.globalAlpha = 1;
  state.setTool?.('brush');
  state.refreshView?.();
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

