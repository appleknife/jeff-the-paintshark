import { $, el, makeCanvas, ctx2d, loadImage, uid, canvasToBlob, isIPad, fitArea, releaseCanvas, installRangeFill } from './util.js';
import { Doc, compositeThumb } from './doc.js';
import { defaultPreset } from './brush.js';
import { Selection } from './selection.js';
import { Viewport } from './view.js';
import { Timelapse } from './timelapse.js';
import { readZip } from './zip.js';
import { state, toast, sheet, gestures } from './appstate.js';
import { setupStudio, renderLayers, closePanels, setTool } from './studio.js';
import { syncColorUI, selectBrush, commitTransform } from './studio2.js';
import { setupInput, setupKeys } from './input.js';
import { settingsSheet } from './sheets.js';
import * as store from './store.js';
import * as sfx from './sfx.js';
import { ask } from './appstate.js';

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
  installRangeFill();
  state.prefs = store.loadPrefs();
  sfx.install({ prefs: state.prefs });
  state.palettes = store.loadPalettes();
  state.primary = state.prefs.primary || state.primary;
  state.secondary = state.prefs.secondary || state.secondary;
  state.presets = store.loadPresets(seedPresets());
  state.brush = state.presets[0];
  // Gesture choices made in Settings were saved but never read back.
  if (state.prefs.gestures) {
    for (const k of Object.keys(gestures)) if (state.prefs.gestures[k]) gestures[k] = state.prefs.gestures[k];
  }

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
    // A new version took over. Reload to use it, but never yank the page out from under an
    // open canvas (that lost the last strokes): wait until the user is back in the gallery.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      if (state.doc) { state.reloadPending = true; return; }
      reloading = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (isIPad) document.documentElement.classList.add('ipad');
  // Ask the browser not to evict the gallery under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
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

let galleryUrls = [];
let galleryToken = 0;

async function renderGallery() {
  const token = ++galleryToken;
  const docs = await store.listDocs();
  if (token !== galleryToken) return; // a newer render started meanwhile
  const grid = $('#galleryGrid');
  grid.innerHTML = '';
  for (const u of galleryUrls) URL.revokeObjectURL(u);
  galleryUrls = [];
  $('#galleryEmpty').classList.toggle('hidden', docs.length > 0);
  for (const d of docs) {
    const card = el('div', { class: 'card', role: 'button', tabindex: 0 });
    const src = d.thumb ? URL.createObjectURL(d.thumb) : '';
    if (src) galleryUrls.push(src);
    const img = el('img', { alt: '', src });
    const when = new Date(d.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    card.append(el('div', { class: 'art' }, img), el('div', { class: 'meta' },
      el('b', {}, d.name || 'Untitled'),
      el('span', {}, `${when}, ${d.width} × ${d.height}`)));
    card.onkeydown = (e) => { if (e.key === 'Enter') card.click(); };
    const del = el('button', { class: 'del', title: 'Delete', 'aria-label': `Delete ${d.name || 'artwork'}` }, '✕');
    del.dataset.sfx = 'none';
    del.onclick = async (e) => {
      e.stopPropagation();
      if (await ask(`Delete “${d.name || 'Untitled'}”?`, 'This removes it from this iPad. Export a .paintshark copy first if you want to keep it.', 'Delete', { danger: true })) {
        await store.deleteDoc(d.id);
        renderGallery();
      }
    };
    card.querySelector('.art').append(del);
    card.dataset.sfx = 'open';
    card.onclick = () => openDocument(d.id);
    grid.append(card);
  }
  const add = el('button', { class: 'card add' });
  add.innerHTML = '<div class="art"><div style="display:grid;justify-items:center"><svg><use href="#i-add"/></svg>New canvas</div></div>';
  add.onclick = newCanvasSheet;
  grid.append(add);
}

function newCanvasSheet() {
  sheet((body, close) => {
    body.append(el('h3', {}, 'New canvas'));
    body.append(el('p', { class: 'hint' }, 'Pick a size, or set your own below.'));
    const grid = el('div', { class: 'preset-grid size-grid' });
    for (const [name, w, h] of [['Square', 2048, 2048], ['Wide', 2732, 2048], ['Tall', 1620, 2160], ['4K Square', 4096, 4096], ['Sketchbook', 1536, 2048]]) {
      const k = 34 / Math.max(w, h);
      const shape = el('i', { class: 'size-shape', style: `width:${Math.round(w * k)}px;height:${Math.round(h * k)}px` });
      const b = el('button', { class: 'preset-card', 'data-sfx': 'none' }, el('div', { class: 'size-box' }, shape), el('b', {}, name), el('span', {}, `${w} × ${h}`));
      b.onclick = async () => { close(); await createDoc(w, h); };
      grid.append(b);
    }
    body.append(grid);
    const w = el('input', { type: 'number', value: 2048, min: 64, max: 8192 });
    const h = el('input', { type: 'number', value: 2048, min: 64, max: 8192 });
    const dpi = el('input', { type: 'number', value: 132, min: 72, max: 600 });
    const bg = el('input', { type: 'color', value: '#ffffff', class: 'color-input' });
    body.append(el('h4', { class: 'sheet-section' }, 'Custom'));
    body.append(el('div', { class: 'field-grid' },
      ...[['Width', w], ['Height', h], ['DPI', dpi], ['Paper', bg]].map(([label, node]) => el('div', { class: 'field' }, el('label', {}, label), node))));
    body.append(el('div', { class: 'row sheet-actions' },
      el('button', {
        class: 'btn primary',
        'data-sfx': 'none',
        onclick: async () => {
          close();
          let cw = Math.min(8192, Math.max(64, Math.round(+w.value) || 2048));
          let ch = Math.min(8192, Math.max(64, Math.round(+h.value) || 2048));
          // Safari can't allocate a canvas over 16.7 megapixels (e.g. 8192×8192 just fails).
          const [fw, fh] = fitArea(cw, ch);
          if (fw !== cw || fh !== ch) toast(`Too big for Safari — using ${fw} × ${fh}`, 2600);
          cw = fw; ch = fh;
          const color = /^#[0-9a-f]{6}$/i.test(bg.value) ? bg.value : '#ffffff';
          await createDoc(cw, ch, { dpi: +dpi.value || 132, bgColor: color });
        },
      }, 'Create')));
  });
}

async function createDoc(w = 2048, h = 2048, opts = {}) {
  const doc = new Doc({ width: w, height: h, name: 'Untitled Artwork', dpi: opts.dpi || 132, bgColor: opts.bgColor || '#ffffff' });
  sfx.play('splash');
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
    // A fresh id, so importing a copy never overwrites the artwork it was exported from.
    const doc = await loadDocFromZip(file, { name: file.name.replace(/\.paintshark$/, ''), id: uid() });
    await openDoc(doc);
  } catch { toast('Not a PaintShark file'); }
}

async function importImage(file) {
  if (!file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  let img;
  try { img = await loadImage(url); } catch { toast(`Could not read ${file.name}`); return; } finally { URL.revokeObjectURL(url); }
  let [w, h] = fitArea(img.naturalWidth, img.naturalHeight);
  const k = Math.min(1, 8192 / Math.max(w, h));
  w = Math.max(1, Math.floor(w * k)); h = Math.max(1, Math.floor(h * k));
  const doc = new Doc({ width: w, height: h, name: file.name.replace(/\.[^.]+$/, ''), bgColor: '#ffffff', bgAlpha: 0 });
  const g = ctx2d(doc.active.canvas);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  await openDoc(doc);
}

async function openDoc(doc) {
  if (state.doc && state.doc !== doc) await closeCurrentDoc();
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
  state.quietTools = true;
  setTool('brush');
  state.quietTools = false;
  doc.on('layers', () => { renderLayers(); maybeAutosave(); });
  doc.on('selection', () => { state.view.request(); });
  doc.on('limit', () => { sfx.play('error'); toast('Layer limit reached for this canvas size on this device', 2600); });
  let thumbTimer = 0;
  doc.on('strokeEnd', () => {
    state.view.request();
    maybeAutosave();
    state.timelapse?.mark();
    // Refresh layer thumbnails after painting (throttled).
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => { if (state.doc === doc && !$('#sidePanel').classList.contains('hidden')) renderLayers(); }, 400);
  });
  if (state.prefs.recordTimelapse !== false) { state.timelapse.start(); state.recording = true; }
  state.view.request();
  if (!state.prefs.seenIntro) { state.prefs.seenIntro = true; store.savePrefs(state.prefs); introSheet(); }
}

function introSheet() {
  sheet((body, close) => {
    body.append(el('h3', {}, 'Welcome to the reef'));
    body.append(el('p', { class: 'hint' }, 'A few shortcuts worth knowing:'));
    const tips = el('ul', { class: 'tips' });
    for (const [k, v] of [['Tap with two fingers', 'Undo'], ['Tap with three fingers', 'Redo'], ['Touch and hold with the Pencil', 'Pick a colour'], ['Pinch', 'Zoom and move the canvas']]) {
      tips.append(el('li', {}, el('span', {}, k), el('b', {}, v)));
    }
    body.append(tips);
    body.append(el('p', { class: 'hint' }, 'Your paintings stay on this iPad. Add the app to your Home Screen (Share, then Add to Home Screen) so the gallery is kept safe.'));
    body.append(el('div', { class: 'row sheet-actions' }, el('button', { class: 'btn primary', onclick: close }, 'Start painting')));
  });
}

async function loadDocFromZip(blob, meta) {
  const file = new File([blob], 'doc.paintshark', { type: 'application/zip' });
  const entries = await readZip(file);
  const map = new Map(entries.map((e) => [e.name, e]));
  const head = JSON.parse(new TextDecoder().decode(map.get('doc.json').data));
  const doc = new Doc({ width: head.width, height: head.height, name: meta.name || head.name || 'Artwork', dpi: head.dpi, bgColor: head.bgColor, bgAlpha: head.bgAlpha });
  const placeholder = doc.layers;
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
      l.id = j.id; l.visible = j.visible !== false; l.opacity = j.opacity ?? 1; l.blend = j.blend || 'normal';
      l.alphaLock = !!j.alphaLock; l.clipping = !!j.clipping;
      if (map.has(`${base}.png`)) {
        const img = await blobImage(map.get(`${base}.png`).data);
        ctx2d(l.canvas).drawImage(img, 0, 0);
      }
      if (map.has(`${base}.mask.png`)) {
        const img = await blobImage(map.get(`${base}.mask.png`).data);
        l.mask = makeCanvas(doc.width, doc.height);
        ctx2d(l.mask).drawImage(img, 0, 0);
      }
      if (j.hasChildren) l.children = await build(`${base}/`);
      out.push(l);
    }
    return out;
  };
  doc.layers = await build('layers/');
  for (const l of placeholder) releaseCanvas(l.canvas);
  if (!doc.layers.length) doc.addLayer({ silent: true });
  const link = (list, parent) => list.forEach((l) => { l.group = parent; if (l.children) link(l.children, l); });
  link(doc.layers, null);
  doc.activeId = doc.findLayer(head.activeId) ? head.activeId : doc.layers[doc.layers.length - 1].id;
  if (head.createdAt) doc.createdAt = head.createdAt;
  return doc;
}

async function blobImage(bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
}

// Saves run one at a time, in order, so two autosaves never interleave their writes.
let saveChain = Promise.resolve();

function saveDoc(show, doc = state.doc) {
  if (!doc) return Promise.resolve();
  const run = saveChain.then(async () => {
    const blob = await doc.serialize();
    const tc = compositeThumb(doc, 320);
    const thumb = await canvasToBlob(tc, 'image/jpeg', 0.72);
    releaseCanvas(tc);
    const rec = (await store.getDoc(doc.id)) || {};
    // One write with the document and its thumbnail together.
    await store.putRaw({ ...rec, id: doc.id, name: doc.name, width: doc.width, height: doc.height, dpi: doc.dpi, thumb, blob });
    doc.lastSave = Date.now();
    if (show) { sfx.play('success'); toast('Saved'); }
  });
  saveChain = run.catch((e) => {
    console.error(e);
    toast('Saving failed — export a .paintshark copy to be safe', 3200);
  });
  return run;
}

function maybeAutosave() {
  clearTimeout(state.autosaveTimer);
  const doc = state.doc;
  state.autosaveTimer = setTimeout(() => saveDoc(false, doc).catch(() => {}), 900);
}

async function closeCurrentDoc() {
  const doc = state.doc;
  if (!doc) return;
  if (state.stroke) { state.stroke.end(); state.stroke = null; }
  if (state.transform) state.commitTransform?.();
  clearTimeout(state.autosaveTimer);
  await saveDoc(false, doc).catch(() => {});
  state.timelapse?.stop();
  if (!$('#refPane').classList.contains('hidden')) state.toggleReference?.();
  state.doc = null;
  if (state.view) { state.view.doc = null; state.view.activeStroke = null; }
  doc.dispose();
}

async function leaveStudio() {
  await closeCurrentDoc();
  closePanels();
  $('#studio').classList.add('hidden');
  $('#gallery').classList.remove('hidden');
  if (state.reloadPending) { location.reload(); return; }
  renderGallery();
}

boot();



