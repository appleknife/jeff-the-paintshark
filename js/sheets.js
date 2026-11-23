import {
  $, $$, el, clamp, uid, makeCanvas, ctx2d, download, canvasToBlob, hsvToRgb, releaseCanvas,
} from './util.js';
import { BLEND_MODES, tintedTip, tipCanvas } from './brush.js';
import { ADJUSTMENTS, applyAdjustment, defaultParams } from './adjust.js';
import { LIQUIFY_MODES } from './transform.js';
import { state, toast, sheet, field, gestures, closeSheet } from './appstate.js';
import { Timelapse } from './timelapse.js';
import * as sfx from './sfx.js';
import * as store from './store.js';

export async function exportSheet() {
  const doc = state.doc;
  if (!doc) return;
  sheet((body, close) => {
    body.append(el('h3', {}, 'Export'));
    body.append(el('p', { class: 'hint' }, 'PNG keeps transparency. Scale is relative to the canvas size.'));
    const name = el('input', { type: 'text', value: doc.name || 'artwork' });
    const scale = el('select', {}, ...[['1', '1×'], ['2', '2×'], ['0.5', '0.5×']].map(([v, t]) => el('option', { value: v }, t)));
    const fmt = el('select', {}, ...[['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP']].map(([v, t]) => el('option', { value: v }, t)));
    const crop = el('select', {}, el('option', { value: 'doc' }, 'Whole canvas'), el('option', { value: 'sel' }, 'Selection'));
    body.append(field('File name', name), field('Format', fmt), field('Scale', scale), field('Area', crop));
    body.append(el('div', { class: 'row' },
      el('button', { class: 'btn', onclick: async () => { await exportDocument().catch((e) => toast(e.message)); } }, 'Save .paintshark'),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn primary',
        onclick: async () => {
          close();
          await exportImage({
            name: name.value || 'artwork', type: fmt.value, scale: +scale.value,
            selection: crop.value === 'sel' ? state.sel : null,
          }).catch((e) => toast(e.message || 'Export failed'));
        },
      }, 'Export')));
  });
}

async function exportImage({ name, type, scale, selection }) {
  const doc = state.doc;
  // Render at the moment of export (the sheet used to flatten when it opened).
  let source = doc.compositeCanvas();
  let sx = 0, sy = 0, sw = doc.width, sh = doc.height, tmp = null;
  if (selection && selection.active) {
    tmp = makeCanvas(doc.width, doc.height);
    ctx2d(tmp).drawImage(source, 0, 0);
    selection.applyToCanvas(tmp);
    source = tmp;
    // Crop to the selected area.
    const b = selection.bounds();
    if (b) ({ x: sx, y: sy, w: sw, h: sh } = b);
  }
  let w = Math.max(1, Math.round(sw * scale));
  let h = Math.max(1, Math.round(sh * scale));
  // 2× of a big canvas can exceed Safari's 16.7-megapixel canvas limit.
  if (w * h > 16777216) {
    const k = Math.sqrt(16777216 / (w * h));
    w = Math.floor(w * k); h = Math.floor(h * k);
    toast(`Scaled down to ${w} × ${h} (Safari limit)`);
  }
  const out = makeCanvas(w, h);
  const g = ctx2d(out);
  if (type === 'jpeg') {
    g.fillStyle = doc.bgCss();
    g.fillRect(0, 0, w, h);
  }
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
  releaseCanvas(tmp);
  let mime = type === 'jpeg' ? 'image/jpeg' : type === 'webp' ? 'image/webp' : 'image/png';
  let blob = await canvasToBlob(out, mime, type === 'png' ? undefined : 0.92);
  releaseCanvas(out);
  if (!blob) throw new Error('Export failed');
  // Safari can't encode WebP and quietly hands back a PNG instead.
  if (blob.type && blob.type !== mime) mime = blob.type;
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  if (ext !== type && !(type === 'jpeg' && ext === 'jpg')) toast(`${type.toUpperCase()} isn't supported here — saved as ${ext.toUpperCase()}`);
  const file = new File([blob], `${name}.${ext}`, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) { if (e?.name === 'AbortError') return; }
  }
  download(blob, `${name}.${ext}`);
}

export async function exportDocument() {
  const doc = state.doc;
  if (!doc) return;
  const blob = await doc.serialize();
  const file = new File([blob], `${doc.name || 'artwork'}.paintshark`, { type: 'application/zip' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  download(blob, `${doc.name || 'artwork'}.paintshark`);
}

export function guideSheet() {
  const doc = state.doc;
  if (!doc) return;
  sheet((body, close) => {
    const g = doc.guide;
    body.append(el('h3', {}, 'Drawing Guide'));
    body.append(el('p', { class: 'hint' }, 'Guides are visual only; symmetry mirrors real strokes.'));
    const type = el('select', {}, ...[['off', 'Off'], ['grid', '2D Grid'], ['isometric', 'Isometric'], ['perspective', 'Perspective'], ['symmetry', 'Symmetry']]
      .map(([v, t]) => el('option', { value: v, selected: g.type === v }, t)));
    type.onchange = () => { g.type = type.value; state.view.request(); };
    const sym = el('select', {}, ...[['off', 'None'], ['x', 'Vertical'], ['y', 'Horizontal'], ['quad', 'Quadrant'], ['radial', 'Radial'], ['rotational', 'Rotational']]
      .map(([v, t]) => el('option', { value: v, selected: doc.symmetry === v }, t)));
    sym.onchange = () => { doc.symmetry = sym.value; if (g.type !== 'symmetry') g.type = 'symmetry'; state.view.request(); };
    const color = el('input', { type: 'color', value: g.color, class: 'color-input' });
    color.oninput = () => { g.color = color.value; state.view.request(); };
    const opacity = el('input', { type: 'range', min: 10, max: 100, value: g.opacity * 100 });
    opacity.oninput = () => { g.opacity = +opacity.value / 100; state.view.request(); };
    const size = el('input', { type: 'range', min: 1, max: 6, value: g.size });
    size.oninput = () => { g.size = +size.value; state.view.request(); };
    body.append(field('Guide', type), field('Symmetry', sym), field('Line color', color), field('Opacity', opacity), field('Line size', size));
    body.append(el('div', { class: 'row sheet-actions' }, el('button', { class: 'btn primary', onclick: close }, 'Done')));
  });
}

export function timelapseSheet() {
  const doc = state.doc;
  const tl = state.timelapse;
  sheet((body, close) => {
    body.append(el('h3', {}, 'Time-lapse'));
    const count = el('p', { class: 'hint' }, `${tl ? tl.frames.length : 0} frames recorded. Playback and export happen locally. Frames are kept until you leave this canvas.`);
    body.append(count);
    const img = el('img', { class: 'timelapse-frame', alt: '' });
    if (tl?.frames.length) img.src = tl.frames[tl.frames.length - 1];
    body.append(img);
    const exportBtn = el('button', { class: 'btn' }, 'Export video');
    exportBtn.onclick = async () => {
      if (!tl) return;
      exportBtn.disabled = true;
      exportBtn.textContent = 'Encoding…';
      try { await tl.exportVideo(); } catch (e) { toast(e.message); }
      exportBtn.disabled = false;
      exportBtn.textContent = 'Export video';
    };
    if (!Timelapse.recordingType()) exportBtn.disabled = true;
    body.append(el('div', { class: 'row' },
      el('button', {
        class: 'btn',
        // Play into the preview image (this used to wipe the whole sheet, buttons included).
        onclick: () => tl?.frames.length && tl.playback(img, 12),
      }, 'Play'),
      exportBtn,
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn danger',
        onclick: () => { if (!tl) return; tl.frames = []; img.removeAttribute('src'); count.textContent = '0 frames recorded.'; toast('Recording cleared'); },
      }, 'Clear'),
      el('button', { class: 'btn primary', onclick: close }, 'Done')));
  });
}

export function liquifySheet() {
  const doc = state.doc;
  if (!doc) return;
  const apply = () => state.tool = 'liquify';
  sheet((body, close) => {
    body.append(el('h3', {}, 'Liquify'));
    body.append(el('p', { class: 'hint' }, 'Drag on the canvas. Each mode runs on the selected layer.'));
    const grid = el('div', { class: 'preset-grid' });
    for (const m of LIQUIFY_MODES) {
      const b = el('button', { class: 'preset-card' + (state.liquifyMode === m ? ' on' : ''), onclick: () => {
        state.liquifyMode = m;
        for (const c of grid.children) c.classList.remove('on');
        b.classList.add('on');
        state.tool = 'liquify';
      } }, el('b', {}, m.replace('-', ' ')));
      grid.append(b);
    }
    body.append(grid);
    const radius = el('input', { type: 'range', min: 10, max: 300, value: state.liquifyRadius });
    radius.oninput = () => { state.liquifyRadius = +radius.value; };
    const amount = el('input', { type: 'range', min: 1, max: 100, value: state.liquifyAmount * 100 });
    amount.oninput = () => { state.liquifyAmount = +amount.value / 100; };
    body.append(field('Radius', radius), field('Strength', amount));
    body.append(el('div', { class: 'row' }, el('span', { class: 'spacer' }),
      el('button', { class: 'btn primary', onclick: () => { apply(); close(); } }, 'Start')));
  });
}

let adjustPreviewUndo = null;

export function adjustSheet() {
  const doc = state.doc;
  if (!doc) return;
  const layer = doc.paintable;
  if (!layer) { toast('Pick a paint layer to adjust'); return; }
  sheet((body, close) => {
    body.append(el('h3', {}, 'Adjustments'));
    body.append(el('p', { class: 'hint' }, 'Applied to the selected layer. Undo restores it.'));
    const kind = el('select', {}, ...ADJUSTMENTS.map((a) => el('option', { value: a.id }, a.name)));
    body.append(field('Adjustment', kind));
    const controls = el('div');
    body.append(controls);
    let params = defaultParams(ADJUSTMENTS[0].id);
    const rebuild = () => {
      controls.innerHTML = '';
      params = defaultParams(kind.value);
      if (kind.value === 'hsb') {
        for (const [k, label, min, max] of [['h', 'Hue', -180, 180], ['s', 'Saturation', -100, 100], ['b', 'Brightness', -100, 100]]) {
          const r = el('input', { type: 'range', min, max, value: 0 });
          r.oninput = () => { params[k] = +r.value; };
          controls.append(field(label, r));
        }
      } else if (kind.value === 'blur') {
        const r = el('input', { type: 'range', min: 0, max: 80, value: 12 });
        r.oninput = () => { params.radius = +r.value; };
        controls.append(field('Radius', r));
      } else if (kind.value === 'motion-blur') {
        const r = el('input', { type: 'range', min: 1, max: 80, value: 16 });
        r.oninput = () => { params.radius = +r.value; };
        const a = el('input', { type: 'range', min: 0, max: 360, value: 0 });
        a.oninput = () => { params.angle = +a.value; };
        controls.append(field('Distance', r), field('Angle', a));
      } else if (kind.value === 'perspective-blur') {
        const r = el('input', { type: 'range', min: 1, max: 80, value: 18 });
        r.oninput = () => { params.radius = +r.value; };
        const f = el('input', { type: 'range', min: 10, max: 90, value: 50 });
        f.oninput = () => { params.focus = +f.value / 100; };
        controls.append(field('Radius', r), field('Focus', f));
      } else if (kind.value === 'sharpen') {
        const r = el('input', { type: 'range', min: 1, max: 100, value: 60 });
        r.oninput = () => { params.amount = +r.value / 100; };
        controls.append(field('Amount', r));
      } else if (kind.value === 'noise') {
        const r = el('input', { type: 'range', min: 1, max: 100, value: 18 });
        r.oninput = () => { params.amount = +r.value / 100; };
        controls.append(field('Amount', r));
      } else if (kind.value === 'halftone') {
        const s = el('input', { type: 'range', min: 2, max: 16, value: 5 });
        s.oninput = () => { params.size = +s.value; };
        controls.append(field('Dot size', s));
      } else if (kind.value === 'glitch') {
        const r = el('input', { type: 'range', min: 1, max: 100, value: 20 });
        r.oninput = () => { params.amount = +r.value / 100; };
        controls.append(field('Amount', r));
      } else if (kind.value === 'chromatic') {
        const r = el('input', { type: 'range', min: 1, max: 20, value: 3 });
        r.oninput = () => { params.amount = +r.value; };
        controls.append(field('Distance', r));
      } else if (kind.value === 'glow') {
        const r = el('input', { type: 'range', min: 1, max: 80, value: 18 });
        r.oninput = () => { params.radius = +r.value; };
        const s = el('input', { type: 'range', min: 10, max: 100, value: 60 });
        s.oninput = () => { params.strength = +s.value / 100; };
        controls.append(field('Radius', r), field('Strength', s));
      } else if (kind.value === 'color-balance') {
        for (const [k, label] of [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']]) {
          const r = el('input', { type: 'range', min: -100, max: 100, value: 0 });
          r.oninput = () => { params[k] = +r.value; };
          controls.append(field(label, r));
        }
      } else if (kind.value === 'gradient-map' || kind.value === 'gradient') {
        const a = el('input', { type: 'text', value: params.a });
        const b = el('input', { type: 'text', value: params.b });
        a.oninput = () => { params.a = a.value; };
        b.oninput = () => { params.b = b.value; };
        controls.append(field('Color A', a), field('Color B', b));
      } else if (kind.value === 'curves') {
        controls.append(el('p', { class: 'hint' }, 'Edit points in a future pass; default is linear.'));
      }
    };
    kind.onchange = rebuild;
    rebuild();
    body.append(el('div', { class: 'row' },
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn primary',
        onclick: () => {
          doc.pushUndo(layer);
          applyAdjustment(doc, layer, kind.value, params, state.sel?.active ? state.sel : null);
          sfx.play('success');
          close();
          toast('Adjustment applied');
        },
      }, 'Apply')));
  });
}

export function brushesSheet() {
  sheet((body, close) => {
    body.append(el('h3', {}, 'Brushes'));
    body.append(el('p', { class: 'hint' }, 'Presets live on this device. Tweak one in Brush Studio and save it.'));
    const grid = el('div', { class: 'preset-grid' });
    for (const p of state.presets) {
      const card = el('button', { class: 'preset-card' + (p.id === state.brush.id ? ' on' : '') });
      const c = brushPreview(p);
      const kind = p.mode === 'erase' ? 'Eraser' : p.mode === 'smudge' ? 'Smudge' : `Size ${Math.round(p.size * 1000)}`;
      card.append(c, el('b', {}, p.name), el('span', {}, kind));
      card.dataset.sfx = 'none';
      card.onclick = () => {
        sfx.play('brush');
        state.selectBrush?.(p);
        // Picking a smudge/eraser preset switches to that tool.
        if (p.mode === 'smudge' || p.mode === 'erase') state.setTool?.(p.mode);
        else if (state.tool !== 'brush') state.setTool?.('brush');
        close();
      };
      grid.append(card);
    }
    body.append(grid);
  });
}


export function quickMenu() {
  sheet((body, close) => {
    body.append(el('h3', {}, 'QuickMenu'));
    const grid = el('div', { class: 'preset-grid' });
    const items = [
      ['Undo', () => state.undo?.()],
      ['Redo', () => state.redo?.()],
      ['Clear layer', () => clearLayer()],
      ['New layer', () => state.doc?.addLayer()],
      ['Flip H', () => flipLayer(true)],
      ['Flip V', () => flipLayer(false)],
      ['Fit canvas', () => state.view.fit()],
      ['Full screen', () => toggleFullscreen()],
      ['Eyedropper', () => state.setTool?.('eyedropper')],
      ['Selections', () => state.setTool?.('select')],
      ['Liquify', () => state.setTool?.('liquify')],
      ['Adjustments', () => state.setTool?.('adjust')],
    ];
    for (const [label, fn] of items) {
      grid.append(el('button', { class: 'preset-card', onclick: () => { fn(); close(); } }, el('b', {}, label)));
    }
    body.append(grid);
  });
}

export function clearLayer() {
  const doc = state.doc;
  const l = doc?.paintable;
  if (!l) return;
  doc.pushUndo(l);
  const g = ctx2d(l.canvas);
  if (state.sel?.active) {
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(state.sel.canvas, 0, 0);
    g.restore();
  } else g.clearRect(0, 0, doc.width, doc.height);
  doc.emit('strokeEnd', { layer: l });
  toast('Layer cleared');
}

function flipLayer(horizontal) {
  const doc = state.doc;
  const l = doc?.paintable;
  if (!l) return;
  doc.pushUndo(l);
  const img = ctx2d(l.canvas).getImageData(0, 0, doc.width, doc.height);
  const tmp = makeCanvas(doc.width, doc.height);
  ctx2d(tmp).putImageData(img, 0, 0);
  const g = ctx2d(l.canvas);
  g.save();
  g.clearRect(0, 0, doc.width, doc.height);
  g.translate(horizontal ? doc.width : 0, horizontal ? 0 : doc.height);
  g.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
  g.drawImage(tmp, 0, 0);
  g.restore();
  releaseCanvas(tmp);
  doc.emit('strokeEnd', { layer: l });
}

export function toggleFullscreen() {
  state.toggleFullscreen?.();
}

const GESTURE_LABELS = {
  twoFingerTap: 'Two-finger tap',
  threeFingerTap: 'Three-finger tap',
  threeFingerSwipeDown: 'Three-finger swipe down',
  fourFingerTap: 'Four-finger tap',
  holdPencil: 'Touch and hold with Pencil',
};
const ACTION_LABELS = { undo: 'Undo', redo: 'Redo', quickmenu: 'QuickMenu', eyedropper: 'Eyedropper', fullscreen: 'Full screen', none: 'Nothing' };

/** An iOS-style on/off switch. */
export function switchEl(on, onchange, label) {
  const b = el('button', { class: 'switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, 'data-sfx': 'none' });
  b.onclick = () => {
    const v = !b.classList.contains('on');
    b.classList.toggle('on', v);
    b.setAttribute('aria-checked', String(v));
    onchange(v);
  };
  return b;
}

const settingRow = (label, hint, control) => el('div', { class: 'setting' },
  el('div', {}, el('b', {}, label), hint ? el('span', {}, hint) : null), control);

export function settingsSheet() {
  sheet((body, close) => {
    body.append(el('h3', {}, 'Settings'));

    body.append(el('h4', { class: 'sheet-section' }, 'Sound'));
    const vol = el('input', { type: 'range', min: 0, max: 100, value: Math.round(sfx.getVolume() * 100) });
    vol.oninput = () => { sfx.setVolume(+vol.value / 100); state.prefs.soundVolume = +vol.value / 100; savePrefs(); };
    vol.onchange = () => sfx.play('success');
    const volRow = settingRow('Volume', null, vol);
    volRow.classList.toggle('dim', !sfx.isEnabled());
    body.append(settingRow('Interface sounds', 'Little pops and bubbles as you tap. Follows the silent switch.',
      switchEl(sfx.isEnabled(), (v) => {
        sfx.setEnabled(v);
        state.prefs.sound = v;
        savePrefs();
        volRow.classList.toggle('dim', !v);
        if (v) sfx.play('toggleOn');
      }, 'Interface sounds')), volRow);

    body.append(el('h4', { class: 'sheet-section' }, 'Recording'));
    body.append(settingRow('Record time-lapse', 'Captures a frame each time you change the painting.',
      switchEl(state.prefs.recordTimelapse !== false, (v) => { state.prefs.recordTimelapse = v; savePrefs(); sfx.play(v ? 'toggleOn' : 'toggleOff'); }, 'Record time-lapse')));

    body.append(el('h4', { class: 'sheet-section' }, 'Gestures'));
    for (const key of Object.keys(gestures)) {
      const s = el('select', {}, ...Object.entries(ACTION_LABELS)
        .map(([v, t]) => el('option', { value: v, selected: gestures[key] === v }, t)));
      s.onchange = () => { gestures[key] = s.value; state.prefs.gestures = { ...gestures }; savePrefs(); };
      body.append(settingRow(GESTURE_LABELS[key] || key, null, s));
    }
    body.append(el('div', { class: 'row sheet-actions' },
      el('button', {
        class: 'btn ghost',
        'data-sfx': 'none',
        onclick: async () => {
          if (!state.doc) { toast('Open a canvas first'); return; }
          try { await state.saveDoc?.(true); } catch { /* toast shown by saveDoc */ }
        },
      }, 'Save now'),
      el('button', { class: 'btn primary', onclick: close }, 'Done')));
  });
}

function savePrefs() {
  store.savePrefs(state.prefs);
}

export function textSheet(commit) {
  sheet((body, close) => {
    body.append(el('h3', {}, 'Add Text'));
    const ta = el('textarea', { rows: 4, placeholder: 'Type something…', style: 'width:100%;margin-bottom:12px' });
    body.append(ta);
    const font = el('select', {}, ...[['Nunito', 'Rounded'], ['system-ui', 'Clean'], ['Georgia', 'Serif'], ['Courier New', 'Typewriter'], ['Impact', 'Poster']]
      .map(([f, t]) => el('option', { value: f }, t)));
    const size = el('input', { type: 'range', min: 12, max: 320, value: 96 });
    body.append(field('Font', font), field('Size', size));
    body.append(el('div', { class: 'row' }, el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn primary',
        onclick: () => { if (!ta.value.trim()) return; commit({ text: ta.value, font: font.value, size: +size.value }); close(); },
      }, 'Place')));
    setTimeout(() => ta.focus(), 60);
  });
}

export function confirmSheet(title, text, action) {
  sheet((body, close) => {
    body.append(el('h3', {}, title));
    body.append(el('p', { class: 'hint' }, text));
    body.append(el('div', { class: 'row' }, el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onclick: close }, 'Cancel'),
      el('button', { class: 'btn danger', onclick: () => { close(); action(); } }, 'Confirm')));
  });
}

export function blendOptions() {
  return BLEND_MODES;
}


/** A small sample stroke painted with the preset's real tip, size, opacity and taper. */
export function brushPreview(p) {
  const W = 300, H = 88;
  const c = makeCanvas(W, H);
  const g = ctx2d(c);
  const ink = [29, 36, 51];
  const path = (t) => ({ x: 18 + t * (W - 36), y: H / 2 + Math.sin(t * Math.PI * 2) * 14 });
  const tip = p.mode === 'erase' ? tipCanvas(p) : tintedTip(p, [...ink, 1]);
  const maxSize = clamp(p.size * 520, 5, 46);
  if (p.mode === 'erase' || p.mode === 'smudge') {
    // Show the effect on a band of colour.
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#ff7a45'); grad.addColorStop(0.5, '#ffc14d'); grad.addColorStop(1, '#4c8dff');
    g.fillStyle = grad;
    g.fillRect(0, H / 2 - 22, W, 44);
  }
  if (p.mode === 'smudge') {
    for (let t = 0; t <= 1; t += 0.01) {
      const a = path(t), s = maxSize;
      g.save(); g.globalAlpha = 0.25; g.beginPath(); g.arc(a.x, a.y, s / 2, 0, Math.PI * 2); g.clip();
      g.drawImage(c, -6, 0); g.restore();
    }
    return c;
  }
  g.globalCompositeOperation = p.mode === 'erase' ? 'destination-out' : 'source-over';
  const taperIn = clamp((p.taperStart || 0) * 3, 0, 0.45), taperOut = clamp((p.taperEnd || 0) * 3, 0, 0.45);
  const step = Math.max(0.6, maxSize * clamp(p.spacing, 0.02, 1) * 0.6);
  let len = 0, prev = path(0);
  for (let t = 0; t <= 1; t += 0.002) {
    const pt = path(t);
    len += Math.hypot(pt.x - prev.x, pt.y - prev.y);
    prev = pt;
    if (len < step) continue;
    len = 0;
    let k = 1;
    if (taperIn && t < taperIn) k = t / taperIn;
    if (taperOut && t > 1 - taperOut) k = Math.min(k, (1 - t) / taperOut);
    const size = Math.max(1, maxSize * (0.25 + 0.75 * k) * (0.85 + 0.3 * Math.sin(t * 9)));
    g.globalAlpha = clamp((p.opacity ?? 1) * (p.flow ?? 1), 0.05, 1) * (0.6 + 0.4 * k);
    g.save();
    g.translate(pt.x, pt.y);
    g.rotate((p.shapeAngle || 0) * Math.PI);
    g.drawImage(tip, -size / 2, -size / 2, size, size);
    g.restore();
  }
  return c;
}
