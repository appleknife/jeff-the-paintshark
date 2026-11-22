import { $, clamp } from './util.js';
import { Stroke, sampleCompositeColor } from './brush.js';
import { state, gestures, toast } from './appstate.js';
import { quickMenu } from './sheets.js';
import { doUndo, doRedo, setTool } from './studio.js';
import { commitTransform, cancelTransform, syncBrushSliders } from './studio2.js';
import { liquify } from './transform.js';

// One multi-finger gesture, from the first finger down until the last finger up.
let gesture = null;
let holdTimer = 0;
let strokePointer = null; // { id, type, t } of the pointer that is drawing

const TAP_MS = 350;
const TAP_SLOP = 14;

const rectOf = (stage) => stage.getBoundingClientRect();

const toDoc = (e) => {
  const r = rectOf($('#stageWrap'));
  return state.view.toDoc(e.clientX - r.left, e.clientY - r.top);
};

const pressureOf = (e) => {
  if (e.pointerType === 'pen') return Math.max(0.02, e.pressure || 0.5);
  return 0.55;
};
const tiltOf = (e) => {
  if (e.pointerType !== 'pen') return 0;
  // Prefer altitudeAngle (Safari reports it for Apple Pencil); 0 = flat, π/2 = upright.
  if (typeof e.altitudeAngle === 'number') return clamp(1 - e.altitudeAngle / (Math.PI / 2));
  return clamp(Math.hypot(e.tiltX || 0, e.tiltY || 0) / 90);
};
const azimuthOf = (e) => ((e.azimuthAngle ?? (Math.atan2(-(e.tiltY || 0), e.tiltX || 0))) + Math.PI * 2) % (Math.PI * 2);

function clearHold() { clearTimeout(holdTimer); holdTimer = 0; }

export function setupInput() {
  const stage = $('#stageWrap');

  const stageXY = (p) => { const r = rectOf(stage); return { x: p.x - r.left, y: p.y - r.top }; };
  const twoFinger = () => {
    const [a, b] = [...state.pointers.values()];
    if (!a || !b) return null;
    const c = stageXY({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: c.x, cy: c.y };
  };

  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.ref-pane, #transformBar, #textWrap, #brushHud, button, input')) return;
    if (!state.doc) return;
    // Palm rejection: while the Pencil is drawing, ignore touches.
    if (strokePointer?.type === 'pen' && e.pointerType === 'touch') return;
    e.preventDefault();
    try { stage.setPointerCapture?.(e.pointerId); } catch { /* synthetic */ }
    const now = performance.now();
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: now });
    const count = state.pointers.size;

    if (count === 1) {
      gesture = { start: now, max: 1, moved: false };
      if (state.space || e.button === 1) { state.panning = { x: e.clientX, y: e.clientY, px: state.view.panX, py: state.view.panY }; return; }
      onDown(e);
      return;
    }

    gesture = gesture || { start: now, max: 0, moved: false };
    gesture.max = Math.max(gesture.max, count);
    clearHold();
    if (state.stroke) {
      // A second finger right after the first one means a gesture, not a dab of paint.
      if (now - strokePointer.t < 300) state.stroke.cancel();
      else state.stroke.end();
      state.stroke = null;
      strokePointer = null;
      state.view.activeStroke = null;
    }
    state.selDrawing = false;
    state.liquifyDrawing = false;
    state.transformDrag = null;
    if (count === 2) {
      const tf = twoFinger();
      state.pinch = { d: tf.d, cx: tf.cx, cy: tf.cy };
    } else {
      state.pinch = null;
    }
    state.view.request();
  });

  stage.addEventListener('pointermove', (e) => {
    if (!state.doc) return;
    const ptr = state.pointers.get(e.pointerId);
    if (ptr) {
      ptr.x = e.clientX; ptr.y = e.clientY;
      if (gesture && Math.hypot(ptr.x - ptr.sx, ptr.y - ptr.sy) > TAP_SLOP) gesture.moved = true;
    }

    if (state.panning) {
      state.view.panX = state.panning.px + (e.clientX - state.panning.x);
      state.view.panY = state.panning.py + (e.clientY - state.panning.y);
      state.view.request();
      return;
    }
    if (state.pointers.size >= 2) {
      if (state.pointers.size === 2 && state.pinch && ptr) {
        const tf = twoFinger();
        // Two-finger pan + pinch zoom around the fingers' midpoint.
        state.view.panX += tf.cx - state.pinch.cx;
        state.view.panY += tf.cy - state.pinch.cy;
        if (state.pinch.d > 8 && tf.d > 8) state.view.zoomAt(tf.cx, tf.cy, tf.d / state.pinch.d);
        state.pinch = tf;
        state.view.request();
      }
      return;
    }
    const pt = toDoc(e);
    if (holdTimer && gesture?.moved) clearHold();
    if (state.tool === 'eyedropper' && e.buttons) { pickColor(pt.x, pt.y); return; }
    if (state.tool === 'transform' && state.transform && e.buttons) { onTransformMove(pt); return; }
    if (state.stroke && e.buttons && (!strokePointer || strokePointer.id === e.pointerId)) {
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of events.length ? events : [e]) {
        const p = toDoc(ev);
        state.stroke.move({ x: p.x, y: p.y, pressure: pressureOf(ev), tilt: tiltOf(ev), azimuth: azimuthOf(ev) });
      }
      updateHud(pt.x, pt.y);
      state.view.request();
      return;
    }
    if (state.tool === 'select' && state.selDrawing && e.buttons) {
      state.selectPoints.push(pt);
      state.view.selPreview = { mode: state.sel.mode, points: state.selectPoints };
      state.view.request();
      return;
    }
    if (state.tool === 'liquify' && state.liquifyDrawing && e.buttons) {
      const lastPt = state.liquifyLast || pt;
      const mx = pt.x - lastPt.x, my = pt.y - lastPt.y;
      if (Math.hypot(mx, my) >= 1 || state.liquifyMode !== 'push') {
        liquify(state.liquifyLayer, pt.x, pt.y, state.liquifyRadius, state.liquifyAmount, state.liquifyMode, mx, my);
        state.liquifyLast = pt;
        state.view.request();
      }
      return;
    }
    updateHud(pt.x, pt.y);
  }, { passive: true });

  const onUp = (e) => {
    if (!state.doc) return;
    if (!state.pointers.has(e.pointerId)) return;
    const was = state.pointers.size;
    state.pointers.delete(e.pointerId);
    if (strokePointer?.id === e.pointerId || was === 1) clearHold();

    if (state.panning) { if (was === 1) state.panning = null; }
    else if (was === 1) {
      if (state.stroke) {
        state.stroke.end();
        state.stroke = null;
        strokePointer = null;
        state.view.activeStroke = null;
      } else if (state.tool === 'select' && state.selDrawing) finishSelection();
      else if (state.tool === 'liquify' && state.liquifyDrawing) {
        state.liquifyDrawing = false;
        state.liquifyLast = null;
        state.doc.emit('strokeEnd', { layer: state.liquifyLayer });
      }
      state.transformDrag = null;
      state.view.request();
    }
    if (state.pointers.size < 2) state.pinch = null;

    if (state.pointers.size === 0 && gesture) {
      const g = gesture;
      gesture = null;
      const quick = performance.now() - g.start < TAP_MS;
      if (quick && !g.moved) {
        if (g.max === 2) runGesture('twoFingerTap');
        else if (g.max === 3) runGesture('threeFingerTap');
        else if (g.max >= 4) runGesture('fourFingerTap');
      } else if (g.max === 3 && g.swipeDown) runGesture('threeFingerSwipeDown');
    }
  };

  // Track the average vertical travel of three-finger gestures for swipe-down.
  stage.addEventListener('pointermove', () => {
    if (!gesture || gesture.max !== 3 || state.pointers.size !== 3) return;
    const pts = [...state.pointers.values()];
    const dy = pts.reduce((a, p) => a + (p.y - p.sy), 0) / pts.length;
    const dx = pts.reduce((a, p) => a + (p.x - p.sx), 0) / pts.length;
    if (dy > 60 && dy > Math.abs(dx)) gesture.swipeDown = true;
  }, { passive: true });

  stage.addEventListener('pointerup', onUp);

  stage.addEventListener('pointercancel', (e) => {
    state.pointers.delete(e.pointerId);
    clearHold();
    if (state.stroke && (!strokePointer || strokePointer.id === e.pointerId)) {
      // iPadOS cancels the pointer for Scribble/system gestures; keep what was drawn.
      state.stroke.end();
      state.stroke = null;
      strokePointer = null;
      state.view.activeStroke = null;
    }
    if (state.pointers.size === 0) {
      gesture = null;
      state.pinch = null;
      state.panning = null;
      state.selDrawing = false;
      state.view.selPreview = null;
      if (state.liquifyDrawing) {
        state.liquifyDrawing = false;
        state.doc?.emit('strokeEnd', { layer: state.liquifyLayer });
      }
    }
    state.view?.request();
  });

  stage.addEventListener('wheel', (e) => {
    if (!state.view?.doc) return;
    e.preventDefault();
    const r = rectOf(stage);
    state.view.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0022));
  }, { passive: false });

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
    const doc = state.doc;
    const isPaintTool = state.tool === 'brush' || state.tool === 'smudge' || state.tool === 'erase';

    if (state.tool === 'eyedropper') { pickColor(pt.x, pt.y); return; }
    if (state.tool === 'fill') { floodFill(pt.x, pt.y); return; }

    if (isPaintTool) {
      const layer = doc.paintable;
      if (!layer) { toast(doc.active?.children ? 'That’s a group — pick a layer inside it' : 'No layer'); return; }
      if (!layer.visible) toast('This layer is hidden');
      state.stroke = new Stroke({
        brush: state.brush, doc, layer,
        selection: state.sel.active ? state.sel : null,
        mode: state.tool === 'erase' ? 'erase' : state.tool === 'smudge' ? 'smudge' : 'paint',
        symmetry: doc.symmetry,
        color: hexToRgbLocal(state.primary, state.alpha),
      });
      strokePointer = { id: e.pointerId, type: e.pointerType, t: performance.now() };
      state.stroke.begin({ x: pt.x, y: pt.y, pressure: pressureOf(e), tilt: tiltOf(e), azimuth: azimuthOf(e) });
      state.view.activeStroke = state.stroke;
      updateHud(pt.x, pt.y);

      // Touch and hold the Pencil still to pick a color (the stroke is discarded).
      if (e.pointerType === 'pen' && gestures.holdPencil === 'eyedropper') {
        const stroke = state.stroke;
        holdTimer = setTimeout(() => {
          holdTimer = 0;
          if (state.stroke !== stroke || gesture?.moved) return;
          stroke.cancel();
          state.stroke = null;
          strokePointer = null;
          state.view.activeStroke = null;
          pickColor(pt.x, pt.y);
          state.view.request();
        }, 550);
      }
      return;
    }

    if (state.tool === 'select') {
      if (state.sel.mode === 'auto') { state.sel.autoSelect(pt.x, pt.y); state.selDrawing = false; return; }
      state.selDrawing = true;
      state.selectPoints = [{ x: pt.x, y: pt.y }];
      state.view.selPreview = { mode: state.sel.mode, points: state.selectPoints };
      return;
    }

    if (state.tool === 'transform' && state.transform) {
      state.transformDrag = { px: pt.x, py: pt.y, mode: 'move' };
      return;
    }

    if (state.tool === 'liquify') {
      const layer = doc.paintable;
      if (!layer) return;
      state.doc.pushUndo(layer);
      state.liquifyDrawing = true;
      state.liquifyLayer = layer;
      state.liquifyLast = pt;
      if (state.liquifyMode !== 'push') liquify(layer, pt.x, pt.y, state.liquifyRadius, state.liquifyAmount, state.liquifyMode);
      state.view.request();
    }
  }

  function onTransformMove(pt) {
    const drag = state.transformDrag;
    if (!drag) return;
    const t = state.transform;
    if (t.warp) t.dragWarp(pt.x, pt.y, pt.x - drag.px, pt.y - drag.py);
    else {
      t.tx += pt.x - drag.px;
      t.ty += pt.y - drag.py;
    }
    drag.px = pt.x; drag.py = pt.y;
    state.view.request();
  }

  function finishSelection() {
    state.sel.begin(state.selectPoints);
    state.sel.commit(state.selectPoints);
    state.selDrawing = false;
    state.selectPoints = [];
    state.view.selPreview = null;
    state.view.request();
  }

  function pickColor(dx, dy) {
    if (dx < 0 || dy < 0 || dx >= state.doc.width || dy >= state.doc.height) return;
    const [r, g, b] = sampleCompositeColor(state.doc, Math.floor(dx), Math.floor(dy));
    state.primary = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    state.syncColorUI?.();
    state.prefs.primary = state.primary;
    toast(`Picked ${state.primary.toUpperCase()}`);
  }

  function floodFill(dx, dy) {
    const doc = state.doc;
    const layer = doc.paintable;
    if (!layer) return;
    const w = doc.width, h = doc.height;
    if (dx < 0 || dy < 0 || dx >= w || dy >= h) return;
    const x0 = Math.floor(dx), y0 = Math.floor(dy);
    const g = ctx(layer.canvas);
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    const sel = state.sel.active ? ctx(state.sel.canvas).getImageData(0, 0, w, h).data : null;
    if (sel && sel[(y0 * w + x0) * 4 + 3] < 8) return;
    const i0 = (y0 * w + x0) * 4;
    const target = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
    const [fr, fg, fb] = hexToRgbLocal(state.primary, 1);
    const fa = Math.round(255 * state.alpha);
    if (target[0] === fr && target[1] === fg && target[2] === fb && target[3] === fa) return;
    const tol = 40;
    const stack = [y0 * w + x0];
    const seen = new Uint8Array(w * h);
    doc.pushUndo(layer);
    while (stack.length) {
      const idx = stack.pop();
      if (seen[idx]) continue;
      seen[idx] = 1;
      const o = idx * 4;
      if (sel && sel[o + 3] < 8) continue;
      const diff = Math.abs(d[o] - target[0]) + Math.abs(d[o + 1] - target[1]) + Math.abs(d[o + 2] - target[2]) + Math.abs(d[o + 3] - target[3]);
      if (diff > tol) continue;
      if (layer.alphaLock && d[o + 3] === 0) continue;
      d[o] = fr; d[o + 1] = fg; d[o + 2] = fb;
      if (!layer.alphaLock) d[o + 3] = fa;
      const px = idx % w;
      if (px > 0) stack.push(idx - 1);
      if (px < w - 1) stack.push(idx + 1);
      if (idx >= w) stack.push(idx - w);
      if (idx < seen.length - w) stack.push(idx + w);
    }
    g.putImageData(img, 0, 0);
    doc.emit('strokeEnd', { layer });
  }

  function updateHud(dx, dy) {
    const size = Math.max(2, state.brush.size * state.doc.width);
    state.view.hud = { x: dx, y: dy };
    state.view.hudSize = size;
    state.view.request();
  }

  stage.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'touch') return;
    state.view.hud = null;
    state.view.request();
  });
}

const ctx = (c) => c.getContext('2d', { willReadFrequently: true });

function hexToRgbLocal(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

function setBrushSize(size) {
  state.brush.size = clamp(size, 0.001, 0.5);
  syncBrushSliders();
  state.view.request();
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
    else if (k === ']') setBrushSize(state.brush.size * 1.15);
    else if (k === '[') setBrushSize(state.brush.size / 1.15);
    else if (k === ' ') { state.space = true; e.preventDefault(); }
    else if (k === 'enter' && state.transform) commitTransform();
    else if (k === 'escape') { if (state.transform) cancelTransform(); else state.sel?.clear(); }
    else if (k === 'f') state.toggleFullscreen?.();
  });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') state.space = false; });
}
