import { el, clamp } from './util.js';
import { defaultPreset } from './brush.js';

export const state = {
  doc: null,
  view: null,
  tool: 'brush',
  primary: '#ff7a45',
  secondary: '#f4f1ea',
  alpha: 1,
  brush: defaultPreset(),
  presets: [],
  palettes: [],
  paletteIndex: 0,
  prefs: {},
  stroke: null,
  sel: null,
  transform: null,
  pointers: new Map(),
  pinch: null,
  panning: null,
  liquifyMode: 'push',
  liquifyRadius: 90,
  liquifyAmount: 0.4,
  space: false,
  timelapse: null,
  recording: false,
  autosaveTimer: 0,
  textEdit: null,
  fullscreen: false,
  exportScale: 1,
};

export const gestures = {
  twoFingerTap: 'undo',
  threeFingerTap: 'redo',
  threeFingerSwipeDown: 'quickmenu',
  fourFingerTap: 'fullscreen',
  holdPencil: 'eyedropper',
};

export function toast(msg, ms = 1700) {
  const t = document.querySelector('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

export function sheet(build) {
  const s = document.querySelector('#sheet');
  const body = s.querySelector('.sheet-body');
  body.innerHTML = '';
  const close = () => closeSheet();
  build(body, close);
  s.classList.remove('hidden');
  s.onclick = (e) => { if (e.target === s) close(); };
  return body;
}

export function closeSheet() {
  const s = document.querySelector('#sheet');
  s.classList.add('hidden');
  s.querySelector('.sheet-body').innerHTML = '';
  queueMicrotask(() => document.dispatchEvent(new CustomEvent('sheetclosed')));
}

export function field(labelText, input) {
  return el('div', { class: 'field' }, el('label', {}, labelText), input);
}

export function rangeRow(label, min, max, value, step, oninput) {
  const out = el('output', {}, String(value));
  const input = el('input', { type: 'range', min, max, value, step: step || 1 });
  input.oninput = () => { out.textContent = input.value; oninput(+input.value); };
  return el('label', { class: 'slider-row' }, el('span', {}, label), input, out);
}

export const clampPct = (v) => clamp(v, 0, 100);
