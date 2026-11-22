import { $, clamp } from './util.js';
import { Stroke, sampleCompositeColor, tipCanvas } from './brush.js';
import { state, gestures, toast } from './appstate.js';
import { quickMenu, liquifySheet, adjustSheet } from './sheets.js';
import { doUndo, doRedo, setTool, renderSelectionPanel } from './studio.js';
import { commitTransform } from './studio2.js';
import { liquify } from './transform.js';

let gestureTap = { count: 0, time: 0, x: 0, y: 0, startY: 0 };
let lastTap = 0;
let holdTimer = 0;
let holdFired = false;

const rectOf = (stage) => stage.getBoundingClientRect();

const toDoc = (e) => {
  const r = rectOf($('#stageWrap'));
  return state.view.toDoc(e.clientX - r.left, e.clientY - r.top);
};

const pressureOf = (e) => {
  if (e.pointerType === 'pen') return Math.max(0.02, e.pressure || 0.5);
  return 0.55;
};
const tiltOf = (e) => e.pointerType === 'pen' ? clamp(Math.hypot(e.tiltX || 0, e.tiltY || 0) / 90) : 0;
const azimuthOf = (e) => ((e.azimuthAngle ?? (Math.atan2(-(e.tiltY || 0), e.tiltX || 0))) + Math.PI * 2) % (Math.PI * 2);

export function setupInput() {
  const stage = $('#stageWrap');

  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.ref-pane, #transformBar, #textWrap, #brushHud, button, input')) return;
    if (!state.doc) return;
    e.preventDefault();
    try { stage.setPointerCapture?.(e.pointerId); } catch { /* synthetic */ }
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    const count = state.pointers.size;

    if (count === 1) {
      gestureTap = { count: 1, time: performance.now(), x: e.clientX, y: e.clientY, startY: e.clientY };
      if (state.space || e.button === 1) { state.panning = { x: e.clientX, y: e.clientY, px: state.view.panX, py: state.view.panY }; return; }
      onDown(e);
    } else if (count === 2) {
      if (state.stroke) { state.stroke.end(); state.stroke = null; }
      state.pinch = {
        d: Math.hypot(...[...state.pointers.values()].map((p) => p.x).reduce((a, b, i, arr) => i ? [arr[0] - b, state.pointers.get([...state.pointers.keys()][1])?.y - state.pointers.get([...state.pointers.keys()][0]).y] : a, [])),
        zoom: state.view.zoom,
        cx: [...state.pointers.values()].reduce((a, p) => a + p.x, 0) / 2,
        cy: [...state.pointers.values()].reduce((a, p) => a + p.y, 0) / 2,
      };
      state.pinch.d = dist();
      gestureTap.count = 2;
      gestureTap.time = performance.now();
    } else if (count === 3) {
      gestureTap.count = 3;
      gestureTap.time = performance.now();
      gestureTap.startY = e.clientY;
    } else if (count === 4) {
      gestureTap.count = 4;
      gestureTap.time = performance.now();
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!state.doc) return;
    if (state.pointers.has(e.pointerId)) state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });

    if (state.panning) {
      state.view.panX = state.panning.px + (e.clientX - state.panning.x);
      state.view.panY = state.panning.py + (e.clientY - state.panning.y);
      state.view.request();
      return;
    }
    if (state.pointers.size === 2 && state.pinch) {
      const d = dist();
      if (state.pinch.d > 8) state.view.zoomAt(state.pinch.cx, state.pinch.cy, d / state.pinch.d);
      state.pinch.d = d;
      return;
    }
    const pt = toDoc(e);
    if (state.tool === 'eyedropper' && e.buttons) { pickColor(pt.x, pt.y); return; }
    if (state.tool === 'transform' && state.transform && e.buttons) { onTransformMove(e, pt); return; }
    if (holdTimer && !holdFired && e.pointerType === 'pen') {
      if (Math.hypot(e.clientX - gestureTap.x, e.clientY - gestureTap.y) > 6) { clearTimeout(holdTimer); holdTimer = 0; }
    }
    if (state.stroke && e.buttons) {
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const p = toDoc(ev);
        state.stroke.move({ x: p.x, y: p.y, pressure: pressureOf(ev), tilt: tiltOf(ev), azimuth: azimuthOf(ev) });
      }
      updateHud(pt.x, pt.y);
      state.view.request();
      return;
    }
    updateHud(pt.x, pt.y);
  }, { passive: true });

  stage.addEventListener('pointerup', (e) => {
    if (!state.doc) return;
    const was = state.pointers.size;
    state.pointers.delete(e.pointerId);
    const dt = performance.now() - gestureTap.time;
    const moved = Math.hypot(e.clientX - gestureTap.x, e.clientY - gestureTap.y);
    const swipeDy = e.clientY - gestureTap.startY;

    if (state.panning) { state.panning = null; }
    else if (was === 1) {
      if (state.stroke) { state.stroke.end(); state.stroke = null; }
      else if (state.tool === 'select' && state.selDrawing) finishSelection();
      else if (state.tool === 'liquify') { state.liquifyDrawing = false; state.doc.pushUndo(state.doc.active); }
      else if (state.tool === 'fill') { /* handled on down */ }
      if (state.tool === 'brush' || state.tool === 'erase' || state.tool === 'smudge') state.view.request();
    }
    if (state.pointers.size === 0) state.pinch = null;

    if (dt < 300 && moved < 14) {
      if (was === 2 && gestureTap.count === 2) runGesture('twoFingerTap');
      else if (was === 3 && gestureTap.count === 3) runGesture('threeFingerTap');
      else if (was === 4) runGesture('fourFingerTap');
    } else if (was === 3 && swipeDy > 60) runGesture('threeFingerSwipeDown');
  });

  stage.addEventListener('pointercancel', () => {
    state.pointers.clear();
    state.pinch = null;
    state.panning = null;
    if (state.stroke) { state.stroke.end(); state.stroke = null; }
  });

  stage.addEventListener('wheel', (e) => {
    if (!state.view.doc) return;
    e.preventDefault();
    const r = rectOf(stage);
    state.view.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0022));
  }, { passive: false });

  function dist() {
    const [a, b] = [...state.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 1;
  }

  function runGesture(name) {
    const action = gestures[name];
    if (!action || action === 'none') return;
    if (action === 'undo') doUndo();
    else if (action === 'redo') doRedo();
    else if (action === 'quickmenu') quickMenu();
    else if (action === 'fullscreen') state.toggleFullscreen?.();
    else if (action === 'eyedropper') setTool('eyedropper');
  }

  function onDown(e) {
    const pt = toDoc(e);
    if (e.pointerType === 'pen' && gestures.holdPencil === 'eyedropper') {
      holdFired = false;
      holdTimer = setTimeout(() => {
        holdFired = true;
        pickColor(pt.x, pt.y);
        if (state.stroke) { state.stroke.end(); state.stroke = null; }
      }, 550);
    }

    const doc = state.doc;
    const layer = doc.active;

    if (state.tool === 'eyedropper') { pickColor(pt.x, pt.y); return; }
    if (state.tool === 'fill') { floodFill(pt.x, pt.y); return; }

    if (state.tool === 'brush' || state.tool === 'smudge' || state.tool === 'erase') {
      if (!layer) return;
      state.stroke = new Stroke({
        brush: state.brush, color: state.color, doc, layer,
        selection: state.sel.active ? state.sel : null,
        mode: state.tool === 'erase' ? 'erase' : state.tool === 'smudge' ? 'smudge' : 'paint',
        symmetry: doc.symmetry,
        color: hexToRgbLocal(state.primary, state.alpha),
      });
      state.stroke.begin({ x: pt.x, y: pt.y, pressure: pressureOf(e), tilt: tiltOf(e), azimuth: azimuthOf(e) });
      state.view.activeStroke = state.stroke;
      updateHud(pt.x, pt.y);
      return;
    }

    if (state.tool === 'select') {
      state.selDrawing = true;
      state.selectPoints = [{ x: pt.x, y: pt.y }];
      if (state.sel.mode === 'auto') { state.sel.autoSelect(pt.x, pt.y); state.selDrawing = false; }
      return;
    }

    if (state.tool === 'transform' && state.transform) {
      state.transformDrag = { px: pt.x, py: pt.y, mode: 'move', snap: { ...state.transform } };
      return;
    }

    if (state.tool === 'liquify') {
      if (!layer) return;
      state.doc.pushUndo(layer);
      state.liquifyDrawing = true;
      liquify(layer, pt.x, pt.y, state.liquifyRadius, state.liquifyAmount, state.liquifyMode);
      state.view.request();
    }
  }

  function onTransformMove(e, pt) {
    const drag = state.transformDrag;
    if (!drag) return;
    const t = state.transform;
    if (t.warp) {
      t.dragWarp(pt.x, pt.y, pt.x - drag.px, pt.y - drag.py);
      drag.px = pt.x; drag.py = pt.y;
    } else {
      t.tx += pt.x - drag.px;
      t.ty += pt.y - drag.py;
      drag.px = pt.x; drag.py = pt.y;
    }
    state.view.request();
  }

  stage.addEventListener('pointermove', (e) => {
    if (state.tool === 'select' && state.selDrawing && e.buttons) {
      const p = toDoc(e);
      state.selectPoints.push(p);
      state.view.request();
    }
    if (state.tool === 'liquify' && state.liquifyDrawing && e.buttons) {
      const p = toDoc(e);
      if (Math.random() < 0.5) {
        liquify(state.doc.active, p.x, p.y, state.liquifyRadius, state.liquifyAmount, state.liquifyMode);
        state.view.request();
      }
    }
  }, { passive: true });

  function finishSelection() {
    state.sel.begin(state.selectPoints);
    if (state.sel.mode === 'freehand') state.sel.commit(state.selectPoints);
    else state.sel.commit(state.selectPoints);
    state.selDrawing = false;
    state.selectPoints = [];
    state.view.request();
  }

  function pickColor(dx, dy) {
    const [r, g, b, a] = sampleCompositeColor(state.doc, clamp(Math.round(dx), 0, state.doc.width - 1), clamp(Math.round(dy), 0, state.doc.height - 1));
    state.primary = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    state.syncColorUI?.();
    toast(`Picked ${state.primary.toUpperCase()}`);
  }

  function floodFill(dx, dy) {
    const doc = state.doc;
    const layer = doc.active;
    if (!layer) return;
    const w = doc.width, h = doc.height;
    const x0 = clamp(Math.round(dx), 0, w - 1), y0 = clamp(Math.round(dy), 0, h - 1);
    const g = layer.canvas.getContext('2d', { willReadFrequently: true });
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    const i0 = (y0 * w + x0) * 4;
    const target = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
    const [fr, fg, fb] = hexToRgbLocal(state.primary, 1);
    const tol = 40;
    const stack = [y0 * w + x0];
    const seen = new Uint8Array(w * h);
    doc.pushUndo(layer);
    while (stack.length) {
      const idx = stack.pop();
      if (seen[idx]) continue;
      seen[idx] = 1;
      const o = idx * 4;
      const diff = Math.abs(d[o] - target[0]) + Math.abs(d[o + 1] - target[1]) + Math.abs(d[o + 2] - target[2]) + Math.abs(d[o + 3] - target[3]);
      if (diff > tol) continue;
      d[o] = fr; d[o + 1] = fg; d[o + 2] = fb; d[o + 3] = Math.round(255 * state.alpha);
      const px = idx % w;
      if (px > 0) stack.push(idx - 1);
      if (px < w - 1) stack.push(idx + 1);
      if (idx >= w) stack.push(idx - w);
      if (idx < seen.length - w) stack.push(idx + w);
    }
    g.putImageData(img, 0, 0);
    state.view.request();
    state.maybeAutosave?.();
  }

  function updateHud(dx, dy) {
    const size = Math.max(2, state.brush.size * state.doc.width);
    state.view.hud = { x: dx, y: dy };
    state.view.hudSize = state.brush.stamp ? size : size * state.brush.shapeRoundness;
    state.view.request();
  }

  stage.addEventListener('pointerleave', () => { state.view.hud = null; state.view.request(); });
}

function hexToRgbLocal(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

export function setupKeys() {
  window.addEventListener('keydown', (e) => {
    if (!state.doc) return;
    if (e.target.matches('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (k === 'b') setTool('brush');
    else if (k === 'e') setTool('erase');
    else if (k === 's') setTool('smudge');
    else if (k === 'l') setTool('select');
    else if (k === 't') setTool('transform');
    else if (k === 'i') setTool('eyedropper');
    else if (k === 'g') setTool('fill');
    else if (k === ']') { state.brush.size = clamp(state.brush.size * 1.15, 0.002, 0.5); $('#sizeSlider').value = Math.round(state.brush.size * 1000); state.view.request(); }
    else if (k === '[') { state.brush.size = clamp(state.brush.size / 1.15, 0.002, 0.5); $('#sizeSlider').value = Math.round(state.brush.size * 1000); state.view.request(); }
    else if (k === ' ') { state.space = true; e.preventDefault(); }
    else if (k === 'enter' && state.transform) commitTransform();
    else if (k === 'escape') { if (state.transform) commitTransform(); else state.sel?.clear(); }
    else if (k === 'f') state.toggleFullscreen?.();
  });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') state.space = false; });
}


