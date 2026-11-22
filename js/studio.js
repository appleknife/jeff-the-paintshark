import { $, $$, el, clamp, uid, makeCanvas, ctx2d, releaseCanvas } from './util.js';
import { BLEND_MODES, defaultPreset, clearTipCache } from './brush.js';
import { state, toast, sheet } from './appstate.js';
import { exportSheet, guideSheet, timelapseSheet, liquifySheet, adjustSheet, brushesSheet,
  quickMenu, settingsSheet, textSheet } from './sheets.js';
import { setupColor, syncColorUI, selectBrush, syncBrushSliders, startTransform, cancelTransform, placeText, toggleReference } from './studio2.js';
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
  // Closing any panel hides the whole side area (it used to leave an empty grey block behind).
  $('#colorClose').onclick = closePanels;
  $('#studioClose').onclick = closePanels;
  $('#studioBtn').onclick = () => { showPanel('studioPanel'); buildStudio(); };

  // Only real tools (the Brush Studio button is also styled .tool but opens a panel).
  for (const t of $$('#toolRail .tool[data-tool]')) t.onclick = () => setTool(t.dataset.tool);

  $('#layerAdd').onclick = () => state.doc?.addLayer();
  $('#layerDup').onclick = () => state.doc?.duplicateLayer();
  $('#layerDel').onclick = () => state.doc?.removeLayer();
  $('#layerGroup').onclick = () => {
    const doc = state.doc;
    if (!doc) return;
    const l = doc.active;
    // Group the active layer together with the layer below it (like a quick two-layer group).
    const below = l ? doc.parentList(l)[doc.parentList(l).indexOf(l) - 1] : null;
    doc.groupSelected(below ? [below.id, l.id] : [doc.activeId]);
  };
  $('#layerMerge').onclick = mergeDown;
  $('#alphaLock').onclick = () => toggleFlag('alphaLock');
  $('#clipMask').onclick = () => toggleFlag('clipping');
  $('#layerMask').onclick = toggleMask;
  $('#blendSelect').onchange = (e) => {
    const l = state.doc?.active;
    if (l) { l.blend = e.target.value; state.view.request(); state.maybeAutosave?.(); }
  };
  $('#layerOpacity').oninput = (e) => {
    const l = state.doc?.active;
    if (!l) return;
    l.opacity = +e.target.value / 100;
    $('#layerOpacityVal').textContent = `${e.target.value}%`;
    state.view.request();
    state.maybeAutosave?.();
  };
  $('#presetsBtn').onclick = brushesSheet;
  $('#quickMenuBtn').onclick = quickMenu;
  $('#swapColor').onclick = () => { setupColor.swap(); };
  $('#primaryWell').onclick = () => togglePanel('colorPanel');
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
    $('#sizeVal').textContent = e.target.value;
    state.view.request();
  };
  $('#opacitySlider').oninput = (e) => {
    state.brush.opacity = +e.target.value / 100;
    $('#opacityVal').textContent = `${e.target.value}%`;
  };
  $('#softSlider').oninput = (e) => {
    // Edge hardness only. (This used to change shapeRoundness, which squashed the tip into an oval.)
    const v = +e.target.value;
    if (v > 94 && state.brush.shape === 'soft') state.brush.shape = 'hard';
    else if (v <= 94 && state.brush.shape === 'hard') state.brush.shape = 'soft';
    state.brush.hardness = clamp(v / 100, 0.01, 0.94);
    $('#softVal').textContent = `${v}%`;
    clearTipCache();
  };
  $('#resetBrush').onclick = () => {
    // Reset to the saved preset this brush came from, falling back to defaults.
    const saved = state.presets.find((p) => p.id === state.brush.id);
    selectBrush(saved || defaultPreset({ name: state.brush.name }));
    buildStudio();
  };
  $('#saveBrush').onclick = () => {
    const name = prompt('Preset name', state.brush.name);
    if (!name) return;
    const p = { ...JSON.parse(JSON.stringify(state.brush)), id: uid(), name };
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
  state.toggleReference = toggleReference;
  state.undo = doUndo;
  state.syncBrushSliders = syncBrushSliders;
  state.redo = doRedo;
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
  setTimeout(() => state.view?.resize(), 0);
}
export function showPanel(id) {
  $('#sidePanel').classList.remove('hidden');
  for (const p of $$('#sidePanel .panel')) p.classList.toggle('on', p.id === id);
  setTimeout(() => state.view?.resize(), 0);
  if (id === 'colorPanel') requestAnimationFrame(() => state.syncColorUI?.());
}
function togglePanel(id) {
  const panel = $('#' + id);
  if (panel.classList.contains('on') && !$('#sidePanel').classList.contains('hidden')) closePanels();
  else showPanel(id);
}

export function setTool(tool) {
  if (!state.doc) return;
  if (state.stroke) { state.stroke.end(); state.stroke = null; state.view.activeStroke = null; }
  if (state.transform) {
    const t = state.transform;
    state.tool = 'none'; // keep commitTransform from recursing back into setTool
    state.commitTransform?.();
    if (state.transform === t) state.transform = null;
  }
  state.tool = tool;
  const isBrush = ['brush', 'smudge', 'erase'].includes(tool);
  for (const t of $$('#toolRail .tool')) t.classList.toggle('on', t.dataset.tool === tool);
  state.view.canvas.style.cursor = isBrush ? 'crosshair' : tool === 'eyedropper' ? 'copy' : tool === 'transform' ? 'move' : 'default';
  state.view.hud = null;
  if (isBrush) state.brush.mode = tool;
  $('#selPanel')?.remove();
  if (tool === 'select') { showPanel('layersPanel'); $('#layersPanel').prepend(selectionPanelEl()); }
  if (tool === 'transform' && !startTransform()) { setTool('brush'); return; }
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
  state.maybeAutosave?.();
}

function toggleMask() {
  const doc = state.doc;
  const l = doc?.active;
  if (!l) return;
  if (!l.mask && !doc.canAllocate(1)) { toast('Not enough canvas memory for a mask'); return; }
  doc.pushStructureUndo(); // removing a mask can be undone
  if (l.mask) l.mask = null;
  else {
    l.mask = makeCanvas(state.doc.width, state.doc.height);
    const g = ctx2d(l.mask);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, state.doc.width, state.doc.height);
  }
  renderLayers();
  state.view.request();
  state.maybeAutosave?.();
}

// Undo while transforming cancels the transform; undo mid-stroke is ignored.
function readyForHistory() {
  if (!state.doc || state.stroke) return false;
  if (state.transform) { cancelTransform(); return false; }
  return true;
}
export function doUndo() { if (readyForHistory() && state.doc.undo()) { state.view.request(); state.maybeAutosave?.(); } }
export function doRedo() { if (readyForHistory() && state.doc.redo()) { state.view.request(); state.maybeAutosave?.(); } }

export function mergeDown() {
  const doc = state.doc;
  const l = doc?.active;
  const below = l ? doc._layerBelow(l) : null;
  if (!l || !below || l.children) return toast('No layer below');
  if (!doc.canAllocate(1)) return toast('Not enough canvas memory to merge');
  // Merge = what you see: render just the two layers (masks, clipping and every blend mode
  // included) and keep the result as the lower layer. One undo step restores both.
  doc.batch(() => {
    doc.pushUndo(below);
    const tmp = makeCanvas(doc.width, doc.height);
    const saved = { layers: doc.layers, bgAlpha: doc.bgAlpha };
    const belowState = { opacity: below.opacity, blend: below.blend, clipping: below.clipping, mask: below.mask };
    // Render below (as a plain normal layer) then the active layer on top, with no background.
    below.opacity = 1; below.blend = 'normal'; below.clipping = false;
    doc.layers = [below, l];
    doc.bgAlpha = 0;
    doc.render(tmp, null);
    doc.layers = saved.layers; doc.bgAlpha = saved.bgAlpha;
    Object.assign(below, belowState);
    if (below.mask) {
      // The lower layer's mask was baked into the render; drop it from the merged layer.
      doc.pushStructureUndo();
      below.mask = null;
    }
    const bg = ctx2d(below.canvas);
    bg.clearRect(0, 0, doc.width, doc.height);
    bg.drawImage(tmp, 0, 0);
    releaseCanvas(tmp);
    doc.removeLayer(l);
  });
  doc.activeId = below.id;
  renderLayers();
  state.view.request();
  state.maybeAutosave?.();
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
    const tc = layer.thumb(40);
    thumb.src = tc.toDataURL();
    releaseCanvas(tc);
    let depth = 0, p = layer.group;
    while (p) { depth++; p = p.group; }
    const name = el('span', { class: 'lname' }, `${layer.children ? '▸ ' : ''}${layer.name}`);
    if (depth) name.style.paddingLeft = `${depth * 10}px`;
    const vis = el('button', { class: 'mini' + (layer.visible ? ' on' : ''), title: 'Visible' }, '◉');
    vis.onclick = (e) => { e.stopPropagation(); layer.visible = !layer.visible; renderLayers(); state.view.request(); state.maybeAutosave?.(); };
    const lock = el('button', { class: 'mini' + (layer.alphaLock ? ' on' : ''), title: 'Alpha lock' }, '⌾');
    lock.onclick = (e) => { e.stopPropagation(); layer.alphaLock = !layer.alphaLock; renderLayers(); state.maybeAutosave?.(); };
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
  const l = doc?.paintable;
  if (!l || !state.sel.active) return;
  doc.pushUndo(l);
  const tmp = makeCanvas(doc.width, doc.height);
  const g = ctx2d(tmp);
  g.fillStyle = state.primary;
  g.fillRect(0, 0, doc.width, doc.height);
  state.sel.applyToCanvas(tmp);
  const lg = ctx2d(l.canvas);
  lg.save();
  lg.globalAlpha = state.alpha;
  if (l.alphaLock) lg.globalCompositeOperation = 'source-atop';
  lg.drawImage(tmp, 0, 0);
  lg.restore();
  releaseCanvas(tmp);
  doc.emit('strokeEnd', { layer: l });
}

function layerFromSelection() {
  const doc = state.doc;
  const from = doc?.paintable;
  if (!from || !state.sel.active) return;
  // Copy & paste: the selected pixels go onto a new layer, the original stays put.
  const l = doc.addLayer({ name: 'Selection' });
  if (!l) return;
  const lg = ctx2d(l.canvas);
  lg.drawImage(from.canvas, 0, 0);
  state.sel.applyToCanvas(l.canvas);
  state.sel.clear();
  renderLayers();
  state.view.request();
  state.maybeAutosave?.();
}
