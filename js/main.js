import { $, el, makeCanvas, ctx2d, loadImage, uid, canvasToBlob, isIPad } from './util.js';
import { Doc, compositeThumb } from './doc.js';
import { defaultPreset } from './brush.js';
import { Selection } from './selection.js';
import { Viewport } from './view.js';
import { Timelapse } from './timelapse.js';
import { readZip } from './zip.js';
import { state, toast, sheet } from './appstate.js';
import { setupStudio, renderLayers, closePanels } from './studio.js';
import { syncColorUI, selectBrush, commitTransform } from './studio2.js';
import { setupInput, setupKeys } from './input.js';
import { settingsSheet } from './sheets.js';
import * as store from './store.js';

function seedPresets() {
  const mk = (name, o) => defaultPreset({ name, ...o });
  return [
    mk('Shark Pencil', { size: 0.035, spacing: 0.06, grain: 'paper', grainDepth: 0.25, shapeRoundness: 0.75, taperStart: 0.2, taperEnd: 0.18, dynamics: { ...defaultPreset().dynamics, pressureSize: 1, pressureOpacity: 0.55 } }),
    mk('Ink Fineliner', { size: 0.018, spacing: 0.03, shape: 'hard', grain: 'none', streamline: 0.55, taperStart: 0.1, taperEnd: 0.1, opacity: 1, dynamics: { ...defaultPreset().dynamics, pressureSize: 0.8, pressureOpacity: 0.1 } }),
    mk('Chunky Marker', { size: 0.12, spacing: 0.05, shape: 'hard', shapeRoundness: 0.55, grain: 'paper', grainDepth: 0.12, opacity: 0.9, dynamics: { ...defaultPreset().dynamics, pressureSize: 0.25, pressureOpacity: 0.2 } }),
    mk('Soft Airbrush', { size: 0.22, spacing: 0.04, shape: 'soft', shapeRoundness: 0.95, grain: 'noise', grainDepth: 0.08, opacity: 0.35, flow: 0.3, wetMix: 0.15, dynamics: { ...defaultPreset().dynamics, pressureSize: 0.3, pressureOpacity: 0.5 } }),
    mk('Charcoal', { size: 0.09, spacing: 0.09, shape: 'speckle', grain: 'canvas', grainDepth: 0.6, opacity: 0.85, jitter: 0.5, angleJitter: 0.4, dynamics: { ...defaultPreset().dynamics, pressureSize: 0.7, pressureOpacity: 0.7 } }),
    mk('Wet Gouache', { size: 0.1, spacing: 0.06, shape: 'soft', grain: 'paper', grainDepth: 0.2, wetMix: 0.55, wetEdges: 0.5, glaze: 0.4, opacity: 0.95, dynamics: { ...defaultPreset().dynamics, pressureSize: 0.4, pressureOpacity: 0.35 } }),
    mk('Reef Smudge', { size: 0.12, spacing: 0.03, shape: 'soft', grain: 'none', smudgePull: 0.85, opacity: 1, mode: 'smudge' }),
    mk('Fin Eraser', { size: 0.08, spacing: 0.05, shape: 'soft', grain: 'none', mode: 'erase', opacity: 1 }),
  ];
}

async function boot() {
  window.__state = state;
  state.prefs = store.loadPrefs();
  state.palettes = store.loadPalettes();
  state.primary = state.prefs.primary || state.primary;
  state.secondary = state.prefs.secondary || state.secondary;
  state.presets = store.loadPresets(seedPresets());
  state.brush = state.presets[0];

  $('#newArt').onclick = newCanvasSheet;
  $('#importArt').onclick = () => $('#importFile').click();
  $('#openSettings').onclick = settingsSheet;

  const input = el('input', { type: 'file', id: 'importFile', accept: '.paintshark,image/*', multiple: true, class: 'hidden' });
  document.body.append(input);
  input.onchange = async () => {
    for (const file of input.files) {
      if (file.name.endsWith('.paintshark')) await importDocument(file);
      else await importImage(file);
    }
    input.value = '';
    renderGallery();
  };

  await renderGallery();
  setupStudio();
  setupInput();
  setupKeys();
  state.toggleFullscreen = () => {
    state.fullscreen = !state.fullscreen;
    $('#toolRail').classList.toggle('hidden', state.fullscreen);
    document.querySelector('.bottombar').classList.toggle('hidden', state.fullscreen);
    setTimeout(() => state.view?.resize(), 40);
  };
  if ('serviceWorker' in navigator) {
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!reloading) { reloading = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (isIPad) document.documentElement.classList.add('ipad');
  state.saveDoc = saveDoc;
  state.refreshView = () => {
    if (!state.view) return;
    state.view.draw();
    requestAnimationFrame(() => state.view.request());
    setTimeout(() => state.view.request(), 90);
  };
  document.addEventListener('sheetclosed', () => state.refreshView());
  state.commitTransform = commitTransform;
  state.saveDocImpl = saveDoc;
  state.maybeAutosave = maybeAutosave;
  state.leaveStudio = leaveStudio;
}

async function renderGallery() {
  const grid = $('#galleryGrid');
  grid.innerHTML = '';
  const docs = await store.listDocs();
  $('#galleryEmpty').classList.toggle('hidden', docs.length > 0);
  for (const d of docs) {
    const card = el('button', { class: 'card' });
    const img = el('img', { alt: '', src: d.thumb ? URL.createObjectURL(d.thumb) : '' });
    card.append(img, el('div', { class: 'meta' },
      el('b', {}, d.name || 'Untitled'),
      el('span', {}, `${d.width}×${d.height} · ${new Date(d.updatedAt).toLocaleDateString()}`)));
    const del = el('button', { class: 'del', title: 'Delete' }, '✕');
    del.onclick = async (e) => {
      e.stopPropagation();
      if (confirm(`Delete “${d.name}”?`)) { await store.deleteDoc(d.id); renderGallery(); }
    };
    card.append(del);
    card.onclick = () => openDocument(d.id);
    grid.append(card);
  }
  const add = el('button', { class: 'card add' },
    el('div', {}, el('div', { style: 'font-size:32px' }, '+'), el('div', {}, 'New Canvas')));
  add.onclick = newCanvasSheet;
  grid.append(add);
}

function newCanvasSheet() {
  sheet((body, close) => {
    body.append(el('h3', {}, 'New Canvas'));
    body.append(el('p', { class: 'hint' }, 'Jeff bites. Pick a size, or go custom.'));
    const grid = el('div', { class: 'preset-grid' });
    for (const [name, w, h] of [['Square', 2048, 2048], ['Wide', 2732, 2048], ['Tall', 1620, 2160], ['4K Square', 4096, 4096], ['Sketchbook', 1536, 2048]]) {
      const b = el('button', { class: 'preset-card' }, el('b', {}, name), el('span', {}, `${w} × ${h}`));
      b.onclick = async () => { close(); await createDoc(w, h); };
      grid.append(b);
    }
    body.append(grid);
    const w = el('input', { type: 'number', value: 2048, min: 64, max: 8192 });
    const h = el('input', { type: 'number', value: 2048, min: 64, max: 8192 });
    const dpi = el('input', { type: 'number', value: 132, min: 72, max: 600 });
    const bg = el('input', { type: 'text', value: '#ffffff' });
    for (const [label, node] of [['Width', w], ['Height', h], ['DPI', dpi], ['Background', bg]]) {
      body.append(el('div', { class: 'field' }, el('label', {}, label), node));
    }
    body.append(el('div', { class: 'row' }, el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn primary',
        onclick: async () => {
          close();
          await createDoc(Math.min(8192, Math.max(64, +w.value)), Math.min(8192, Math.max(64, +h.value)),
            { dpi: +dpi.value, bgColor: bg.value });
        },
      }, 'Create')));
  });
}

async function createDoc(w = 2048, h = 2048, opts = {}) {
  const doc = new Doc({ width: w, height: h, name: 'Untitled Artwork', dpi: opts.dpi || 132, bgColor: opts.bgColor || '#ffffff' });
  await openDoc(doc);
}

async function openDocument(id) {
  const rec = await store.getDoc(id);
  if (!rec || !rec.blob) return toast('Artwork missing');
  try {
    const doc = await loadDocFromZip(rec.blob, rec);
    await openDoc(doc);
  } catch (e) { console.error(e); toast('Could not open artwork'); }
}

async function importDocument(file) {
  try {
    const doc = await loadDocFromZip(file, { name: file.name.replace(/\.paintshark$/, '') });
    await openDoc(doc);
  } catch { toast('Not a PaintShark file'); }
}

async function importImage(file) {
  if (!file.type.startsWith('image/')) return;
  const img = await loadImage(URL.createObjectURL(file));
  const doc = new Doc({ width: img.naturalWidth, height: img.naturalHeight, name: file.name.replace(/\.[^.]+$/, ''), bgColor: '#ffffff', bgAlpha: 0 });
  ctx2d(doc.active.canvas).drawImage(img, 0, 0);
  await openDoc(doc);
}

async function openDoc(doc) {
  state.doc = doc;
  state.sel = new Selection(doc);
  doc.selection = state.sel;
  state.timelapse = new Timelapse(doc);
  $('#gallery').classList.add('hidden');
  $('#studio').classList.remove('hidden');
  $('#docName').value = doc.name;
  if (!state.view) state.view = new Viewport($('#stageWrap'), $('#view'), $('#overlay'));
  state.view.setDoc(doc);
  renderLayers();
  selectBrush(state.presets[0]);
  syncColorUI();
  doc.on('layers', renderLayers);
  doc.on('selection', () => { state.view.request(); });
  doc.on('strokeEnd', () => { state.view.request(); maybeAutosave(); });
  if (state.prefs.recordTimelapse !== false) { state.timelapse.start(); state.recording = true; }
  state.view.request();
  if (!state.prefs.seenIntro) { state.prefs.seenIntro = true; store.savePrefs(state.prefs); introSheet(); }
}

function introSheet() {
  sheet((body, close) => {
    body.append(el('h3', {}, 'Welcome to the reef'));
    body.append(el('p', { class: 'hint' }, 'Two fingers = undo · Three fingers = redo · Long-press with the Pencil = eyedropper. Everything is stored on this device.'));
    body.append(el('p', { class: 'hint' }, 'Install it: Share ▸ Add to Home Screen, so your gallery survives.')); 
    body.append(el('button', { class: 'btn primary', onclick: close }, 'Start painting'));
  });
}

async function loadDocFromZip(blob, meta) {
  const file = new File([blob], 'doc.paintshark', { type: 'application/zip' });
  const entries = await readZip(file);
  const map = new Map(entries.map((e) => [e.name, e]));
  const head = JSON.parse(new TextDecoder().decode(map.get('doc.json').data));
  const doc = new Doc({ width: head.width, height: head.height, name: meta.name || head.name || 'Artwork', dpi: head.dpi, bgColor: head.bgColor, bgAlpha: head.bgAlpha });
  doc.layers = [];
  doc.id = meta.id || head.id || uid();

  const build = async (prefix) => {
    const names = [...map.keys()].filter((n) => n.startsWith(prefix) && n.endsWith('.json') && !n.slice(prefix.length).includes('/'));
    names.sort((a, b) => parseInt(a.slice(prefix.length)) - parseInt(b.slice(prefix.length)));
    const out = [];
    for (const n of names) {
      const j = JSON.parse(new TextDecoder().decode(map.get(n).data));
      const base = n.slice(0, -5);
      const l = j.type === 'group'
        ? new (await import('./doc.js')).Group(doc, { name: j.name })
        : new (await import('./doc.js')).Layer(doc, { name: j.name, type: j.type, textData: j.textData });
      l.id = j.id; l.visible = j.visible; l.opacity = j.opacity; l.blend = j.blend;
      l.alphaLock = j.alphaLock; l.clipping = j.clipping;
      if (map.has(`${base}.png`)) {
        const img = await loadImage(URL.createObjectURL(new Blob([map.get(`${base}.png`).data], { type: 'image/png' })));
        ctx2d(l.canvas).drawImage(img, 0, 0);
      }
      if (map.has(`${base}.mask.png`)) {
        const img = await loadImage(URL.createObjectURL(new Blob([map.get(`${base}.mask.png`).data], { type: 'image/png' })));
        l.mask = makeCanvas(doc.width, doc.height);
        ctx2d(l.mask).drawImage(img, 0, 0);
      }
      if (j.hasChildren) l.children = await build(`${base}/`);
      out.push(l);
    }
    return out;
  };
  doc.layers = await build('layers/');
  if (!doc.layers.length) doc.addLayer({ silent: true });
  const link = (list, parent) => list.forEach((l) => { l.group = parent; if (l.children) link(l.children, l); });
  link(doc.layers, null);
  doc.activeId = doc.layers[doc.layers.length - 1].id;
  return doc;
}

async function saveDoc(show) {
  const doc = state.doc;
  if (!doc) return;
  const blob = await doc.serialize();
  const thumb = await canvasToBlob(compositeThumb(doc, 320), 'image/jpeg', 0.72);
  const rec = (await store.getDoc(doc.id)) || {};
  await store.putDoc({ ...rec, id: doc.id, name: doc.name, width: doc.width, height: doc.height, dpi: doc.dpi }, thumb);
  const stored = await store.getDoc(doc.id);
  await store.putRaw?.({ ...stored, blob });
  doc.lastSave = Date.now();
  if (show) toast('Saved');
}

function maybeAutosave() {
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer = setTimeout(() => saveDoc(false).catch(console.error), 900);
}

async function leaveStudio() {
  await saveDoc(false).catch(() => {});
  state.timelapse?.stop();
  closePanels();
  $('#studio').classList.add('hidden');
  $('#gallery').classList.remove('hidden');
  state.doc = null;
  renderGallery();
}

boot();



