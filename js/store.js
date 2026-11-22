const DB_NAME = 'paintshark';
const DB_VER = 1;

function open() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('docs')) {
        const s = db.createObjectStore('docs', { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction('docs', mode);
    const store = t.objectStore('docs');
    t.oncomplete = () => { db.close(); res(); };
    t.onerror = () => { db.close(); rej(t.error); };
    fn(store, res, rej);
  });
};

export async function putDoc(meta, thumbBlob) {
  return tx('readwrite', (store) => {
    store.put({ ...meta, thumb: thumbBlob, updatedAt: Date.now() });
  });
}

export async function listDocs() {
  const db = await open();
  return new Promise((res, rej) => {
    const out = [];
    const t = db.transaction('docs', 'readonly');
    const idx = t.objectStore('docs').index('updatedAt');
    idx.openCursor(null, 'prev').onsuccess = (e) => {
      const c = e.target.result;
      if (c) { out.push(c.value); c.continue(); } else { db.close(); res(out); }
    };
    t.onerror = () => { db.close(); rej(t.error); };
  });
}

export async function getDoc(id) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction('docs', 'readonly');
    const r = t.objectStore('docs').get(id);
    r.onsuccess = () => { db.close(); res(r.result); };
    r.onerror = () => { db.close(); rej(r.error); };
  });
}

export async function deleteDoc(id) {
  return tx('readwrite', (store) => store.delete(id));
}

export async function clearDocs() {
  return tx('readwrite', (store) => store.clear());
}

const PREF_KEY = 'paintshark.prefs.v1';

export function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; }
}

export function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* full */ }
}

const PALETTE_KEY = 'paintshark.palettes.v1';

export function loadPalettes() {
  try { return JSON.parse(localStorage.getItem(PALETTE_KEY)) || defaultPalettes(); } catch { return defaultPalettes(); }
}

export function savePalettes(p) {
  try { localStorage.setItem(PALETTE_KEY, JSON.stringify(p)); } catch { /* storage full or private mode */ }
}

export function defaultPalettes() {
  return [
    { id: 'basic', name: 'PaintShark', colors: ['#0e1116', '#f4f1ea', '#ff6b3d', '#ffc14d', '#39c0a8', '#3d8bfd', '#8b5cf6', '#e94560'] },
    { id: 'ocean', name: 'Reef', colors: ['#04293a', '#064663', '#0f7a8a', '#31a3a3', '#7fd1c1', '#c7f0e4', '#f2b880', '#ff7b54'] },
    { id: 'greys', name: 'Fins', colors: ['#000000', '#1f1f1f', '#3d3d3d', '#5c5c5c', '#7a7a7a', '#999999', '#c2c2c2', '#ffffff'] },
  ];
}

const PRESET_KEY = 'paintshark.presets.v1';

export function loadPresets(fallback) {
  try {
    const p = JSON.parse(localStorage.getItem(PRESET_KEY));
    // Fill in settings added since a preset was saved, so older presets keep working.
    return Array.isArray(p) && p.length ? p.map((x) => ({ ...fallback[0], dynamics: { ...fallback[0].dynamics }, ...x, dynamics: { ...fallback[0].dynamics, ...(x.dynamics || {}) } })) : fallback;
  } catch { return fallback; }
}

export function savePresets(p) {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(p)); } catch { /* storage full or private mode */ }
}

export function loadLibrary() {
  try { return JSON.parse(localStorage.getItem('paintshark.library.v1')) || []; } catch { return []; }
}
export function saveLibrary(l) { try { localStorage.setItem('paintshark.library.v1', JSON.stringify(l)); } catch { /* full */ } }

export async function putRaw(rec) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction('docs', 'readwrite');
    t.objectStore('docs').put({ ...rec, updatedAt: Date.now() });
    t.oncomplete = () => { db.close(); res(); };
    t.onerror = () => { db.close(); rej(t.error); };
  });
}

