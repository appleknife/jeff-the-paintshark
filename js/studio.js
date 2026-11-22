import { $, $$, el, clamp, uid, makeCanvas, ctx2d } from './util.js';
import { BLEND_MODES, defaultPreset, clearTipCache } from './brush.js';
import { state, toast, sheet } from './appstate.js';
import { exportSheet, guideSheet, timelapseSheet, liquifySheet, adjustSheet, brushesSheet,
  quickMenu, settingsSheet, textSheet } from './sheets.js';
import { setupColor, syncColorUI, selectBrush, startTransform, placeText, toggleReference } from './studio2.js';
import { buildStudio } from './brushstudio.js';
import * as store from './store.js';

export function setupStudio() {
  $('#backBtn').onclick = () => state.leaveStudio?.();
  $('#docName').onchange = (e) => { if (state.doc) { state.doc.name = e.target.value || 'Untitled'; state.maybeAutosave?.(); } };
  $('#undoBtn').onclick = doUndo;
  $('#redoBtn').onclick = doRedo;
  $('#shareBtn').onclick = exportSheet;
  $('#layersBtn').onclick = () => togglePanel('layersPanel');
  $('#guideBtn').onclick = guideSheet;
  $('#timeBtn').onclick = timelapseSheet;
  $('#refBtn').onclick = toggleReference;
  $('#refClose').onclick = toggleReference;
  $('#panelClose').onclick = closePanels;
  $('#colorClose').onclick = () => $('#colorPanel').classList.remove('on');
  $('#studioClose').onclick = () => $('#studioPanel').classList.remove('on');
  $('#studioBtn').onclick = () => { showPanel('studioPanel'); buildStudio(); };

  for (const t of $$('#toolRail .tool')) t.onclick = () => setTool(t.dataset.tool);

  $('#layerAdd').onclick = () => state.doc?.addLayer();
  $('#layerDup').onclick = () => state.doc?.duplicateLayer();
  $('#layerDel').onclick = () => state.doc?.removeLayer();
  $('#layerGroup').onclick = () => state.doc?.groupSelected([state.doc.activeId]);
  $('#layerMerge').onclick = mergeDown;
  $('#alphaLock').onclick = () => toggleFlag('alphaLock');
  $('#clipMask').onclick = () => toggleFlag('clipping');
  $('#layerMask').onclick = toggleMask;
  $('#blendSelect').onchange = (e) => {
    const l = state.doc?.active;
    if (l) { l.blend = e.target.value; state.view.request(); }
  };
  $('#layerOpacity').oninput = (e) => {
    const l = state.doc?.active;
    if (!l) return;
    l.opacity = +e.target.value / 100;
    $('#layerOpacityVal').textContent = `${e.target.value}%`;
    state.view.request();
  };
  $('#presetsBtn').onclick = brushesSheet;
  $('#quickMenuBtn').onclick = quickMenu;
  $('#swapColor').onclick = () => { setupColor.swap(); };
  $('#primaryWell').onclick = () => showPanel('colorPanel');
  $('#secondaryWell').onclick = () => { setupColor.swap(); showPanel('colorPanel'); };
  $('#addSwatch').onclick = setupColor.addSwatch;
  $('#newPalette').onclick = () => {
    const name = prompt('Palette name');
    if (!name) return;
    state.palettes.push({ id: uid(), name, colors: [] });
    store.savePalettes(state.palettes);
    syncColorUI();
  };
  $('#sizeSlider').oninput = (e) => {
    state.brush.size = +e.target.value / 1000;
    $('#sizeVal').textContent = `${e.target.value}%`;
    state.view.request();
  };
  $('#opacitySlider').oninput = (e) => {
    state.brush.opacity = +e.target.value / 100;
    $('#opacityVal').textContent = `${e.target.value}%`;
  };
  $('#softSlider').oninput = (e) => {
    state.brush.shape = +e.target.value > 94 ? 'hard' : 'soft';
    state.brush.shapeRoundness = clamp(+e.target.value / 120, 0.1, 1);
    $('#softVal').textContent = `${e.target.value}%`;
    clearTipCache();
  };
  $('#resetBrush').onclick = () => { selectBrush(defaultPreset({ name: state.brush.name })); buildStudio(); };
  $('#saveBrush').onclick = () => {
    const name = prompt('Preset name', state.brush.name);
    if (!name) return;
    const p = { ...state.brush, id: uid(), name };
    state.presets.push(p);
    store.savePresets(state.presets);
    selectBrush(p);
    toast('Preset saved');
  };

  setupColor();
  state.selectBrush = selectBrush;
  state.setTool = setTool;
  state.saveDoc = (show) => state.saveDocImpl?.(show);
  state.syncColorUI = syncColorUI;
  fillBlendOptions();
}

export function fillBlendOptions() {
  const sel = $('#blendSelect');
  sel.innerHTML = '';
  for (const [v, label] of BLEND_MODES) if (v !== 'destination-out') sel.append(el('option', { value: v }, label));
}

export function closePanels() {
  $('#sidePanel').classList.add('hidden');
  for (const p of $$('#sidePanel .panel')) p.classList.remove('on');
}
export function showPanel(id) {
  $('#sidePanel').classList.remove('hidden');
  for (const p of $$('#sidePanel .panel')) p.classList.toggle('on', p.id === id);
}
function togglePanel(id) {
  const panel = $('#' + id);
  if (panel.classList.contains('on') && !$('#sidePanel').classList.contains('hidden')) closePanels();
  else showPanel(id);
}

export function setTool(tool) {
  if (!state.doc) return;
  if (state.stroke) { state.stroke.end(); state.stroke = null; }
  if (state.transform) state.commitTransform?.();
  state.tool = tool;
  const isBrush = ['brush', 'smudge', 'erase'].includes(tool);
  for (const t of $$('#toolRail .tool')) t.classList.toggle('on', t.dataset.tool === tool);
  state.view.canvas.style.cursor = isBrush ? 'crosshair' : tool === 'eyedropper' ? 'copy' : tool === 'transform' ? 'move' : 'default';
  state.view.hud = null;
  if (isBrush) state.brush.mode = tool;
  $('#selPanel')?.remove();
  if (tool === 'select') { showPanel('layersPanel'); $('#layersPanel').prepend(selectionPanelEl()); }
  if (tool === 'transform') startTransform();
  if (tool === 'liquify') liquifySheet();
  if (tool === 'adjust') adjustSheet();
  if (tool === 'text') textSheet(placeText);
  state.refreshView?.();
}

function toggleFlag(flag) {
  const l = state.doc?.active;
  if (!l) return;
  l[flag] = !l[flag];
  renderLayers();
  state.view.request();
}

function toggleMask() {
  const l = state.doc?.active;
  if (!l) return;
  if (l.mask) l.mask = null;
  else {
    l.mask = makeCanvas(state.doc.width, state.doc.height);
    const g = ctx2d(l.mask);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, state.doc.width, state.doc.height);
  }
  renderLayers();
  state.view.request();
}

export function doUndo() { if (state.doc?.undo()) { state.view.request(); state.maybeAutosave?.(); } }
export function doRedo() { if (state.doc?.redo()) { state.view.request(); state.maybeAutosave?.(); } }

export function mergeDown() {
  const doc = state.doc;
  const l = doc?.active;
  const below = l ? doc._layerBelow(l) : null;
  if (!l || !below) return toast('No layer below');
  doc.pushUndo(below);
  const tmp = makeCanvas(doc.width, doc.height);
  const g = ctx2d(tmp);
  g.drawImage(below.canvas, 0, 0);
  g.globalAlpha = l.opacity;
  g.globalCompositeOperation = l.blend === 'add' ? 'lighter' : l.blend;
  g.drawImage(l.canvas, 0, 0);
  ctx2d(below.canvas).clearRect(0, 0, doc.width, doc.height);
  ctx2d(below.canvas).drawImage(tmp, 0, 0);
  doc.removeLayer(l);
  state.view.request();
}

export function renderLayers() {
  const doc = state.doc;
  const list = $('#layerList');
  if (!doc || !list) return;
  list.innerHTML = '';
  const active = doc.active;
  $('#layerInfo').textContent = `${doc.width} × ${doc.height} px · ${doc.dpi} dpi`;
  $('#alphaLock').classList.toggle('on', !!active?.alphaLock);
  $('#clipMask').classList.toggle('on', !!active?.clipping);
  $('#layerMask').classList.toggle('on', !!active?.mask);
  if (active) {
    $('#blendSelect').value = active.blend;
    $('#layerOpacity').value = Math.round(active.opacity * 100);
    $('#layerOpacityVal').textContent = `${Math.round(active.opacity * 100)}%`;
  }
  for (const layer of doc.layerFlatList()) {
    const item = el('div', { class: 'layer-item' + (layer.id === doc.activeId ? ' on' : '') });
    const thumb = el('img', { alt: '' });
    thumb.src = layer.thumb(40).toDataURL();
    let depth = 0, p = layer.group;
    while (p) { depth++; p = p.group; }
    const name = el('span', { class: 'lname' }, `${layer.children ? '▸ ' : ''}${layer.name}`);
    if (depth) name.style.paddingLeft = `${depth * 10}px`;
    const vis = el('button', { class: 'mini' + (layer.visible ? ' on' : ''), title: 'Visible' }, '◉');
    vis.onclick = (e) => { e.stopPropagation(); layer.visible = !layer.visible; renderLayers(); state.view.request(); };
    const lock = el('button', { class: 'mini' + (layer.alphaLock ? ' on' : ''), title: 'Alpha lock' }, '⌾');
    lock.onclick = (e) => { e.stopPropagation(); layer.alphaLock = !layer.alphaLock; renderLayers(); };
    const mask = el('button', { class: 'mini' + (layer.mask ? ' on' : ''), title: 'Mask' }, '◐');
    mask.onclick = (e) => { e.stopPropagation(); doc.activeId = layer.id; toggleMask(); };
    item.append(thumb, name, vis, lock, mask);
    item.onclick = () => { doc.activeId = layer.id; renderLayers(); };
    list.append(item);
  }
}

function selectionPanelEl() {
  const wrap = el('div', { id: 'selPanel', class: 'layer-opts' });
  wrap.append(el('b', { style: 'font-size:12px' }, 'Selection'));
  const modes = el('div', { class: 'layer-toggles' });
  for (const m of ['freehand', 'rect', 'ellipse', 'auto']) {
    const b = el('button', { class: 'chip' + (state.sel.mode === m ? ' on' : '') }, m);
    b.onclick = () => { state.sel.mode = m; $$('.chip', modes).forEach((c) => c.classList.remove('on')); b.classList.add('on'); };
    modes.append(b);
  }
  const ops = el('div', { class: 'layer-toggles' });
  for (const o of ['new', 'add', 'sub', 'intersect']) {
    const b = el('button', { class: 'chip' + (state.sel.op === o ? ' on' : '') }, o);
    b.onclick = () => { state.sel.op = o; $$('.chip', ops).forEach((c) => c.classList.remove('on')); b.classList.add('on'); };
    ops.append(b);
  }
  const feather = el('input', { type: 'range', min: 0, max: 80, value: state.sel.feather });
  feather.oninput = () => { state.sel.feather = +feather.value; };
  const threshold = el('input', { type: 'range', min: 1, max: 100, value: state.sel.threshold * 100 });
  threshold.oninput = () => { state.sel.threshold = +threshold.value / 100; };
  wrap.append(modes, ops,
    el('label', { class: 'slider-row' }, 'Feather', feather),
    el('label', { class: 'slider-row' }, 'Auto tol.', threshold),
    el('div', { class: 'layer-toggles' },
      el('button', { class: 'btn small', onclick: () => state.sel.invert() }, 'Invert'),
      el('button', { class: 'btn small', onclick: () => state.sel.clear() }, 'Clear')),
    el('div', { class: 'layer-toggles' },
      el('button', { class: 'btn small primary', onclick: fillSelection }, 'Fill'),
      el('button', { class: 'btn small', onclick: layerFromSelection }, 'New layer')));
  return wrap;
}

export function renderSelectionPanel() {
  const existing = $('#selPanel');
  if (!existing || !state.doc) return;
  existing.replaceWith(selectionPanelEl());
}

export function fillSelection() {
  const doc = state.doc;
  const l = doc?.active;
  if (!l || !state.sel.active) return;
  doc.pushUndo(l);
  const tmp = makeCanvas(doc.width, doc.height);
  const g = ctx2d(tmp);
  g.fillStyle = state.primary;
  g.fillRect(0, 0, doc.width, doc.height);
  state.sel.applyToCanvas(tmp);
  const lg = ctx2d(l.canvas);
  lg.globalAlpha = state.alpha;
  lg.drawImage(tmp, 0, 0);
  lg.globalAlpha = 1;
  state.refreshView?.();
}

function layerFromSelection() {
  const doc = state.doc;
  if (!doc || !state.sel.active) return;
  const src = makeCanvas(doc.width, doc.height);
  ctx2d(src).drawImage(doc.active.canvas, 0, 0);
  state.sel.applyToCanvas(src);
  const l = doc.addLayer({ name: 'Selection' });
  ctx2d(l.canvas).drawImage(src, 0, 0);
  state.sel.clear();
  state.view.request();
}
