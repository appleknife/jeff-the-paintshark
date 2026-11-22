import { el, clamp } from './util.js';
import { defaultPreset } from './brush.js';
import * as sfx from './sfx.js';

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
  if (s.classList.contains('hidden') && !sfx.playedRecently(60)) sfx.play('open');
  s.classList.remove('hidden');
  s.onclick = (e) => { if (e.target === s) close(); };
  return body;
}

export function closeSheet() {
  const s = document.querySelector('#sheet');
  if (!s.classList.contains('hidden') && !sfx.playedRecently(60)) sfx.play('close');
  s.classList.add('hidden');
  s.querySelector('.sheet-body').innerHTML = '';
  queueMicrotask(() => document.dispatchEvent(new CustomEvent('sheetclosed')));
}

/** In-app replacement for confirm(): resolves true/false. */
export function ask(title, text, okLabel = 'OK', { danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { if (!answered) { answered = true; resolve(v); } };
    sheet((body, close) => {
      body.append(el('h3', {}, title));
      if (text) body.append(el('p', { class: 'hint' }, text));
      body.append(el('div', { class: 'row sheet-actions' },
        el('button', { class: 'btn ghost', onclick: () => { done(false); close(); } }, 'Cancel'),
        el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, 'data-sfx': danger ? 'remove' : 'tap', onclick: () => { done(true); close(); } }, okLabel)));
    });
    document.addEventListener('sheetclosed', () => done(false), { once: true });
  });
}

/** In-app replacement for prompt(): resolves the text, or null if cancelled. */
export function askText(title, value = '', okLabel = 'Save') {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { if (!answered) { answered = true; resolve(v); } };
    sheet((body, close) => {
      body.append(el('h3', {}, title));
      const input = el('input', { type: 'text', value, style: 'width:100%;margin:10px 0 4px' });
      const ok = () => { const v = input.value.trim(); if (!v) return; done(v); close(); };
      input.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
      body.append(input, el('div', { class: 'row sheet-actions' },
        el('button', { class: 'btn ghost', onclick: () => { done(null); close(); } }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: ok }, okLabel)));
      setTimeout(() => { input.focus(); input.select(); }, 60);
    });
    document.addEventListener('sheetclosed', () => done(null), { once: true });
  });
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
