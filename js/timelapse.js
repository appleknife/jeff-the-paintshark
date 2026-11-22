import { makeCanvas, ctx2d, download } from './util.js';

export class Timelapse {
  constructor(doc, view) {
    this.doc = doc;
    this.view = view;
    this.frames = [];
    this.capturing = false;
    this.maxFrames = 720;
    this.interval = 900;
    this.last = 0;
  }

  start() {
    this.capturing = true;
    this.last = 0;
    this.tick();
  }

  stop() { this.capturing = false; }

  tick = () => {
    if (!this.capturing) return;
    const now = performance.now();
    if (now - this.last > this.interval) {
      this.last = now;
      const w = 480;
      const h = Math.max(1, Math.round(w * (this.doc.height / this.doc.width)));
      const c = makeCanvas(w, h);
      const g = ctx2d(c);
      g.fillStyle = this.doc.bgCss();
      g.fillRect(0, 0, w, h);
      g.drawImage(this.doc.compositeCanvas(), 0, 0, w, h);
      this.frames.push(c.toDataURL('image/jpeg', 0.6));
      if (this.frames.length > this.maxFrames) this.frames.shift();
    }
    requestAnimationFrame(this.tick);
  };

  async playback(overlay, fps = 12) {
    overlay.innerHTML = '';
    const img = new Image();
    img.className = 'timelapse-frame';
    overlay.append(img);
    for (let i = 0; i < this.frames.length; i++) {
      img.src = this.frames[i];
      await new Promise((r) => setTimeout(r, 1000 / fps));
      if (!overlay.isConnected) return;
    }
  }

  async exportWebm() {
    if (!this.frames.length) throw new Error('no frames recorded');
    const first = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = this.frames[0]; });
    const c = makeCanvas(first.naturalWidth, first.naturalHeight);
    const g = ctx2d(c);
    const stream = c.captureStream(20);
    const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((res) => { rec.onstop = res; });
    rec.start();
    for (const f of this.frames) {
      const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = f; });
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0);
      await new Promise((r) => setTimeout(r, 50));
    }
    rec.stop();
    await done;
    download(new Blob(chunks, { type: 'video/webm' }), `${this.doc.name || 'artwork'}-timelapse.webm`);
  }
}
