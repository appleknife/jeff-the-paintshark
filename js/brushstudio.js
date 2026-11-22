import { $, el } from './util.js';
import { BLEND_MODES, clearTipCache } from './brush.js';
import { state } from './appstate.js';

const STUDIO_GROUPS = [
  ['Shape', [['shape', 'select', ['soft', 'hard', 'square', 'speckle']], ['hardness', 'range', 0.01, 0.94, 0.01], ['shapeRoundness', 'range', 0.05, 1, 0.01],
    ['shapeAngle', 'range', 0, 6.28, 0.01], ['shapeScatter', 'range', 0, 1, 0.01], ['shapeCount', 'range', 1, 8, 1]]],
  ['Grain', [['grain', 'select', ['none', 'paper', 'canvas', 'noise', 'spray']], ['grainDepth', 'range', 0, 1, 0.01],
    ['grainScale', 'range', 0.05, 1, 0.01]]],
  ['Dynamics', [['dynamics.pressureSize', 'range', 0, 1, 0.01], ['dynamics.pressureOpacity', 'range', 0, 1, 0.01],
    ['dynamics.tiltSize', 'range', 0, 1, 0.01], ['dynamics.speedSize', 'range', 0, 1, 0.01]]],
  ['Taper & Spacing', [['spacing', 'range', 0.01, 1, 0.01], ['spacingJitter', 'range', 0, 1, 0.01],
    ['taperStart', 'range', 0, 0.6, 0.01], ['taperEnd', 'range', 0, 0.6, 0.01], ['taperPressure', 'range', 0, 1, 0.01]]],
  ['Stabilization', [['streamline', 'range', 0, 0.95, 0.01], ['motionFilter', 'range', 0, 0.95, 0.01],
    ['pressureResponse', 'range', 0, 1, 0.01]]],
  ['Wet paint', [['wetMix', 'range', 0, 1, 0.01], ['wetEdges', 'range', 0, 1, 0.01],
    ['glaze', 'range', 0, 1, 0.01]]],
  ['Stamp', [['jitter', 'range', 0, 1, 0.01], ['angleJitter', 'range', 0, 1, 0.01], ['stamp', 'check']]],
];

const getPath = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
const setPath = (o, p, v) => {
  const parts = p.split('.');
  const last = parts.pop();
  parts.reduce((x, k) => x[k], o)[last] = v;
};

export function buildStudio() {
  const scroll = $('#studioScroll');
  scroll.innerHTML = '';
  scroll.append(el('div', { class: 'row' }, el('b', {}, state.brush.name), el('span', { class: 'spacer' }),
    el('span', { class: 'muted', style: 'font-size:11px' }, 'live')));
  for (const [title, rows] of STUDIO_GROUPS) {
    const box = el('div', { class: 'rows' });
    for (const [path, kind, a, b, step] of rows) {
      const value = getPath(state.brush, path) ?? (kind === 'range' ? a : kind === 'check' ? false : a[0]);
      let input;
      if (kind === 'range') {
        input = el('input', { type: 'range', min: a, max: b, step, value });
        const out = el('output', {}, (+value).toFixed(2));
        input.oninput = () => {
          setPath(state.brush, path, +input.value);
          out.textContent = (+input.value).toFixed(2);
          clearTipCache();
          state.syncBrushSliders?.();
        };
        box.append(el('label', {}, el('span', {}, path.split('.').pop().replace(/([A-Z])/g, ' $1').toLowerCase()), input, out));
        continue;
      }
      if (kind === 'select') {
        input = el('select', {}, ...a.map((o) => el('option', { value: o, selected: value === o }, o)));
        input.onchange = () => { setPath(state.brush, path, input.value); clearTipCache(); };
      } else {
        input = el('input', { type: 'checkbox', checked: !!value });
        input.onchange = () => setPath(state.brush, path, input.checked);
      }
      box.append(el('label', {}, el('span', {}, path), input, el('span')));
    }
    scroll.append(el('div', { class: 'studio-group' }, el('h4', {}, title), box));
  }
  scroll.append(el('div', { class: 'studio-group' }, el('h4', {}, 'Blend reference'),
    el('div', { class: 'rows' }, el('p', { class: 'muted', style: 'font-size:11px;margin:0' },
      'Layer blend is set in the Layers panel. Stroke mode is set by the Paint/Smudge/Erase tools.'))));
}

