// Cute, quiet UI sounds, synthesized on the fly with Web Audio (no files, works offline).
// Theme: soft bubbles and pops — Jeff is a shark after all.
//
// Rules this follows:
// - short (mostly under 150 ms) and quiet by default, with a master volume and an off switch
// - hover only for a mouse/trackpad or a hovering Pencil (never for fingers), throttled
// - no sound while painting, dragging sliders or typing
// - everything goes through a compressor so overlapping sounds never clip
// - iPad: the audio engine starts on the first tap (Safari requires a user gesture) and is
//   resumed after the app comes back from the background. It follows the ring/silent switch.

let ctx = null, master = null, noiseBuf = null;
let enabled = true;
let volume = 0.6;
let lastPlay = 0;
let lastHover = 0;

const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51]; // C major pentatonic

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC({ latencyHint: 'interactive' });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 4;
    comp.attack.value = 0.002; comp.release.value = 0.12;
    master = ctx.createGain();
    master.gain.value = volume * 0.5;
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ctx = null; }
  return ctx;
}

function unlock() {
  if (!enabled) return;
  const c = ensure();
  if (c && c.state !== 'running') c.resume().catch(() => {});
}

/* ---------- building blocks ---------- */

function env(g, t, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

/** A pitched blip that glides from f0 to f1. */
function tone(t, f0, f1, dur, peak = 0.5, type = 'sine') {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  env(g, t, peak, 0.004, dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

/** A short filtered noise burst — the "tick" part of a click. */
function noise(t, freq, q, dur, peak = 0.3, type = 'bandpass', sweepTo = null) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf;
  f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  env(g, t, peak, 0.003, dur);
  s.connect(f).connect(g).connect(master);
  s.start(t); s.stop(t + dur + 0.05);
}

/** A bubble: a sine that jumps up in pitch, like an air bubble popping underwater. */
function bubble(t, f, dur = 0.09, peak = 0.45) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f * 2.2, t + dur * 0.8);
  env(g, t, peak, 0.006, dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

const jitter = (f, amt = 0.04) => f * (1 + (Math.random() - 0.5) * amt);

/* ---------- the sound palette ---------- */

const SOUNDS = {
  hover: (t) => tone(t, jitter(1400, 0.06), 1700, 0.035, 0.07),
  tap: (t) => { noise(t, jitter(3200), 1.2, 0.018, 0.16); tone(t, jitter(620), 380, 0.06, 0.32); },
  soft: (t) => tone(t, jitter(520), 330, 0.05, 0.22),
  tool: (t, i = 0) => { const f = PENTA[i % PENTA.length]; bubble(t, f * 0.5, 0.08, 0.38); tone(t + 0.012, f, f * 1.01, 0.09, 0.14, 'triangle'); },
  toggleOn: (t) => { tone(t, 660, 680, 0.05, 0.3); tone(t + 0.055, 990, 1000, 0.07, 0.28); },
  toggleOff: (t) => { tone(t, 880, 860, 0.05, 0.26); tone(t + 0.055, 587, 570, 0.07, 0.24); },
  open: (t) => { noise(t, 600, 0.8, 0.14, 0.12, 'bandpass', 2400); bubble(t + 0.04, 520, 0.09, 0.32); },
  close: (t) => { noise(t, 2200, 0.8, 0.11, 0.09, 'bandpass', 500); tone(t + 0.02, 700, 420, 0.07, 0.2); },
  undo: (t) => { tone(t, 880, 620, 0.06, 0.28); tone(t + 0.05, 660, 470, 0.07, 0.2); },
  redo: (t) => { tone(t, 620, 880, 0.06, 0.28); tone(t + 0.05, 780, 1100, 0.07, 0.2); },
  add: (t) => { bubble(t, 420, 0.08, 0.36); bubble(t + 0.06, 640, 0.08, 0.3); bubble(t + 0.12, 900, 0.08, 0.24); },
  remove: (t) => { tone(t, 300, 110, 0.12, 0.4); noise(t, 400, 0.7, 0.08, 0.1, 'lowpass'); },
  pick: (t) => { tone(t, 1567.98, 1580, 0.06, 0.26); tone(t + 0.04, 2093, 2100, 0.1, 0.16); },
  brush: (t) => { noise(t, 1800, 0.9, 0.09, 0.14, 'bandpass', 3800); tone(t + 0.02, 740, 990, 0.07, 0.2, 'triangle'); },
  success: (t) => { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(t + i * 0.07, f, f, 0.16, 0.26 - i * 0.03, 'triangle')); },
  error: (t) => { tone(t, 330, 300, 0.1, 0.32, 'triangle'); tone(t + 0.12, 262, 240, 0.14, 0.3, 'triangle'); },
  splash: (t) => { noise(t, 900, 0.6, 0.22, 0.18, 'bandpass', 300); [392, 523.25, 783.99].forEach((f, i) => bubble(t + 0.03 + i * 0.05, f, 0.09, 0.3)); },
};

/**
 * Play a sound by name. `arg` is passed to sounds that take one (tool index).
 * Returns false if nothing played.
 */
export function play(name, arg) {
  if (!enabled || volume <= 0) return false;
  const c = ensure();
  if (!c || !SOUNDS[name]) return false;
  // Hover never counts as "already played", so the click right after it still gets its sound.
  if (name !== 'hover') lastPlay = performance.now();
  const go = () => { try { SOUNDS[name](c.currentTime + 0.002, arg); } catch { /* ignore */ } };
  if (c.state === 'running') { go(); return true; }
  // Safari starts the engine asynchronously on the first tap; play once it's running.
  const asked = performance.now();
  c.resume().then(() => { if (performance.now() - asked < 250) go(); }).catch(() => {});
  return true;
}

/** True if a sound played in the last `ms` milliseconds (used to avoid double sounds). */
export const playedRecently = (ms = 40) => performance.now() - lastPlay < ms;

export function setEnabled(on) {
  enabled = !!on;
  if (enabled) unlock();
  else if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
}
export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (master && ctx) master.gain.setTargetAtTime(volume * 0.5, ctx.currentTime, 0.02);
}
export const isEnabled = () => enabled;
export const getVolume = () => volume;

/* ---------- automatic sounds for the whole interface ---------- */

const HOVERABLE = 'button, .card, .preset-card, .swatch, .tool, .chip, select, .layer-item';

export function install({ prefs }) {
  enabled = prefs.sound !== false;
  volume = typeof prefs.soundVolume === 'number' ? prefs.soundVolume : 0.6;

  // Safari only allows audio to start from a tap/click (pointerup or click counts; touchstart doesn't).
  for (const ev of ['pointerup', 'keydown', 'click']) window.addEventListener(ev, unlock, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    // Resumed on the next tap (iPadOS requires a fresh gesture after switching apps).
  });

  // Hover: mouse, trackpad or a hovering Apple Pencil only. Throttled so sweeping across a
  // toolbar doesn't machine-gun.
  let hovered = null;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const t = e.target.closest?.(HOVERABLE);
    if (!t || t === hovered || t.disabled) return;
    hovered = t;
    if (e.buttons) return; // dragging
    const now = performance.now();
    if (now - lastHover < 70) return;
    lastHover = now;
    play('hover');
  }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    if (hovered && !hovered.contains(e.relatedTarget)) hovered = null;
  }, { passive: true });

  // Clicks: the app plays meaningful sounds itself (undo, open, tool…). Anything that
  // didn't get one gets a gentle tap. This listener runs after the element's own handler.
  document.addEventListener('click', (e) => {
    const t = e.target.closest?.('button, .card, [role=button]');
    if (!t || t.disabled) return;
    if (playedRecently(60)) return;
    if (t.dataset.sfx === 'none') return;
    play(t.dataset.sfx || 'tap');
  });
  // Dropdown and checkbox changes.
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (playedRecently(60)) return;
    if (t.matches?.('select')) play('soft');
    else if (t.matches?.('input[type=checkbox]')) play(t.checked ? 'toggleOn' : 'toggleOff');
  });
}
