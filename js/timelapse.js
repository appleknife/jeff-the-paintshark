import { makeCanvas, ctx2d, download, releaseCanvas } from './util.js';

export class Timelapse {
  constructor(doc, view) {
    this.doc = doc;
    this.view = view;
    this.frames = [];
    this.capturing = false;
    this.maxFrames = 720;
    this.interval = 900;
    this.last = 0;
    this._timer = 0;
    this._dirty = false;
  }

  start() {
    this.capturing = true;
    this.last = 0;
    this._dirty = true;
    this.mark();
  }

  stop() {
    this.capturing = false;
    clearTimeout(this._timer);
    this._timer = 0;
  }

  /** Call when the artwork changed. Frames are only captured after changes (it used to
   * re-render the whole canvas every frame forever, draining the battery while idle). */
  mark() {
    if (!this.capturing) return;
    this._dirty = true;
    if (this._timer) return;
    const wait = Math.max(0, this.interval - (performance.now() - this.last));
    this._timer = setTimeout(() => { this._timer = 0; this.capture(); }, wait);
  }

  capture() {
    if (!this.capturing || !this._dirty) return;
    this._dirty = false;
    this.last = performance.now();
    const w = 480;
    const h = Math.max(1, Math.round(w * (this.doc.height / this.doc.width)));
    const c = makeCanvas(w, h);
    const g = ctx2d(c);
    g.fillStyle = this.doc.bgCss();
    g.fillRect(0, 0, w, h);
    g.drawImage(this.doc.compositeCanvas(), 0, 0, w, h);
    this.frames.push(c.toDataURL('image/jpeg', 0.6));
    releaseCanvas(c);
    if (this.frames.length > this.maxFrames) this.frames.shift();
  }

  /** Play the frames into an <img>. */
  async playback(img, fps = 12) {
    this._playId = (this._playId || 0) + 1;
    const id = this._playId;
    for (let i = 0; i < this.frames.length; i++) {
      img.src = this.frames[i];
      await new Promise((r) => setTimeout(r, 1000 / fps));
      if (!img.isConnected || id !== this._playId) return;
    }
  }

  static recordingType() {
    if (typeof MediaRecorder === 'undefined') return null;
    // Safari before 18.4 can only record MP4; Chrome/Firefox prefer WebM.
    for (const t of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4']) {
      if (MediaRecorder.isTypeSupported?.(t)) return t;
    }
    return null;
  }

  async exportVideo() {
    if (!this.frames.length) throw new Error('No frames recorded yet');
    const type = Timelapse.recordingType();
    if (!type) throw new Error('Video recording is not supported in this browser');
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const first = await load(this.frames[0]);
    const c = makeCanvas(first.naturalWidth, first.naturalHeight);
    const g = ctx2d(c);
    g.drawImage(first, 0, 0);
    const stream = c.captureStream(20);
    const rec = new MediaRecorder(stream, { mimeType: type });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((res) => { rec.onstop = res; });
    rec.start(250);
    for (const f of this.frames) {
      const img = await load(f);
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0);
      await new Promise((r) => setTimeout(r, 50));
    }
    rec.stop();
    await done;
    stream.getTracks().forEach((t) => t.stop());
    releaseCanvas(c);
    const mime = type.split(';')[0];
    const ext = mime === 'video/mp4' ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type: mime });
    const name = `${this.doc.name || 'artwork'}-timelapse.${ext}`;
    const file = new File([blob], name, { type: mime });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    download(blob, name);
  }

  // Kept for older callers.
  exportWebm() { return this.exportVideo(); }
}
