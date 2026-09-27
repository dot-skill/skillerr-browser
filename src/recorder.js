// Demo recording: captures one tab to video with Chromium tab capture (no screen-recording
// permission needed, and only the page is recorded, never the rest of the screen). Every
// caption also saves a step screenshot, and stopping writes a step-by-step guide next to the video.
const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => String(s || 'demo').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'demo';
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Big, readable caption bar drawn into the page itself, so it is part of the recording.
const CAPTION_JS = (text) => `(() => {
  let c = document.getElementById('__skillerr_caption');
  const t = ${JSON.stringify(text)};
  if (!t) { if (c) { c.style.opacity = '0'; c.style.transform = 'translate(-50%, 12px)'; } return; }
  if (!c) {
    c = document.createElement('div');
    c.id = '__skillerr_caption';
    c.style.cssText = 'position:fixed;left:50%;bottom:36px;z-index:2147483646;pointer-events:none;max-width:min(820px,86vw);' +
      'padding:14px 22px;border-radius:14px;background:rgba(14,14,20,.86);color:#fff;font:600 22px/1.35 -apple-system,system-ui,sans-serif;' +
      'letter-spacing:-.01em;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.35),0 0 0 1px rgba(139,108,255,.45);backdrop-filter:blur(8px);' +
      'opacity:0;transform:translate(-50%,12px);transition:opacity .3s,transform .3s cubic-bezier(.2,.8,.2,1)';
    document.documentElement.appendChild(c);
  }
  c.textContent = t;
  requestAnimationFrame(() => { c.style.opacity = '1'; c.style.transform = 'translate(-50%,0)'; });
})()`;

class Recorder {
  // ui(channel, data) talks to the browser chrome, whose renderer does the actual MediaRecorder work.
  // windowSource() → { sourceId, size } of the Skillerr window; showCaption(text) draws the window-wide caption.
  constructor({ ui, chromeWc, windowSource, showCaption, onChange }) {
    this.ui = ui;
    this.chromeWc = chromeWc;
    this.windowSource = windowSource;
    this.showCaption = showCaption;
    this.onChange = onChange;
    this.rec = null;
    ipcMain.on('rec-started', () => this.rec?.started?.resolve());
    ipcMain.on('rec-chunk', (_e, buf) => this.rec?.out.write(Buffer.from(buf)));
    ipcMain.on('rec-ended', (_e, info) => this.finishStream(info || {}));
  }

  get active() {
    return !!this.rec;
  }

  // In window mode every tab is on camera.
  isRecording(tab) {
    return !!this.rec && (this.rec.scope === 'window' || this.rec.tab === tab);
  }

  info() {
    return this.rec ? { tabId: this.rec.tab.id, title: this.rec.title, startedAt: this.rec.startedAt, scope: this.rec.scope } : null;
  }

  async start(tab, title, scope = 'tab') {
    if (this.rec) throw new Error('Already recording. Call record_stop first.');
    const wc = tab.view.webContents;
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
    const dir = path.join(app.getPath('videos'), 'Skillerr', `${slug(title)}-${stamp}`);
    fs.mkdirSync(dir, { recursive: true });
    const deferred = () => {
      let resolve;
      let reject;
      const promise = new Promise((a, b) => ((resolve = a), (reject = b)));
      return { promise, resolve, reject };
    };
    this.rec = {
      tab, scope, title: title || 'Demo', dir, startedAt: Date.now(), steps: [], caption: '', ext: 'mp4',
      out: null, started: deferred(), ended: deferred(),
    };
    const rec = this.rec;
    // Keep the caption on screen across page loads; stop cleanly if the tab goes away.
    rec.onLoad = () => rec.scope === 'tab' && rec.caption && wc.executeJavaScript(CAPTION_JS(rec.caption)).catch(() => {});
    rec.onGone = () => rec.scope === 'tab' && this.stop().catch(() => {});
    wc.on('did-finish-load', rec.onLoad);
    wc.once('destroyed', rec.onGone);

    let source;
    if (scope === 'window') {
      const w = this.windowSource();
      source = { kind: 'desktop', sourceId: w.sourceId, width: w.size[0], height: w.size[1] };
    } else {
      const { width, height } = tab.view.getBounds();
      source = { kind: 'tab', sourceId: wc.getMediaSourceId(this.chromeWc), width, height };
    }
    rec.file = path.join(dir, 'demo.mp4');
    rec.out = fs.createWriteStream(rec.file);
    this.ui('rec-start', source);
    const timeout = setTimeout(() => rec.started.reject(new Error('The recorder did not start.')), 8000);
    try {
      await rec.started.promise;
    } catch (err) {
      this.cleanup();
      throw err;
    } finally {
      clearTimeout(timeout);
    }
    this.onChange();
    const what = scope === 'window' ? 'the whole Skillerr window' : `tab ${tab.id}`;
    return { text: `Recording ${what} to ${dir}. Use caption to narrate each step, then record_stop.` };
  }

  finishStream(info) {
    const rec = this.rec;
    if (!rec) return;
    if (info.ext) rec.ext = info.ext;
    if (info.error) {
      // Window recordings capture the screen, which macOS allows only after the user grants it.
      if (rec.scope === 'window' && /video source|permission|NotAllowed|NotReadable/i.test(info.error)) {
        info.error = 'macOS needs your OK to record Skillerr’s window: System Settings → Privacy & Security → Screen & System Audio Recording → turn on Skillerr, then reopen Skillerr. (Tab recordings work without it.)';
      }
      rec.started.reject(new Error(`Recording failed: ${info.error}`));
      rec.ended.reject(new Error(`Recording failed: ${info.error}`));
    }
    rec.out.end(() => rec.ended.resolve());
  }

  async caption(tab, text) {
    const wc = tab.view.webContents;
    const t = String(text || '').trim().slice(0, 200);
    if (wc.isDestroyed() && this.rec?.scope !== 'window') return { text: 'That tab has closed.' };
    if (this.isRecording(tab)) this.rec.caption = t;
    if (this.rec?.scope === 'window') this.showCaption(t);
    else await wc.executeJavaScript(CAPTION_JS(t)).catch(() => {});
    if (!t || !this.isRecording(tab) || tab.isStart || wc.isDestroyed()) return { text: t ? 'Caption shown.' : 'Caption hidden.' };
    // Each caption is a step in the guide: let it fade in, then take the picture.
    await sleep(450);
    if (wc.isDestroyed() || !this.rec) return { text: 'Caption shown.' }; // the tab closed meanwhile (e.g. deep research tidying up)
    const n = this.rec.steps.length + 1;
    const img = `step-${String(n).padStart(2, '0')}.png`;
    const shot = await wc.capturePage();
    fs.writeFileSync(path.join(this.rec.dir, img), shot.toPNG());
    this.rec.steps.push({ n, text: t, img, url: wc.getURL(), at: Date.now() - this.rec.startedAt });
    return { text: `Caption shown and saved as step ${n}.` };
  }

  async stop() {
    const rec = this.rec;
    if (!rec) throw new Error('Not recording.');
    const wc = rec.tab.view.webContents;
    if (rec.scope === 'window') this.showCaption('');
    else if (!wc.isDestroyed()) await wc.executeJavaScript(CAPTION_JS('')).catch(() => {});
    await sleep(500); // let the last frame and caption fade land in the video
    this.ui('rec-stop');
    const timeout = setTimeout(() => this.finishStream({ error: 'the recorder did not finish in time' }), 10000);
    try {
      await rec.ended.promise;
    } finally {
      clearTimeout(timeout);
      this.cleanup();
    }
    if (rec.ext !== 'mp4') {
      const f = rec.file.replace(/\.mp4$/, `.${rec.ext}`);
      fs.renameSync(rec.file, f);
      rec.file = f;
    }
    const guide = this.writeGuide(rec);
    const secs = Math.round((Date.now() - rec.startedAt) / 1000);
    const saved = { dir: rec.dir, video: rec.file, guide, steps: rec.steps.length, secs, title: rec.title };
    this.ui('rec-saved', saved);
    return { text: `Saved a ${secs}s recording with ${rec.steps.length} captioned steps.\nVideo: ${rec.file}\nGuide: ${guide}\nFolder: ${rec.dir}` };
  }

  cleanup() {
    const rec = this.rec;
    if (!rec) return;
    const wc = rec.tab.view.webContents;
    if (!wc.isDestroyed()) {
      wc.removeListener('did-finish-load', rec.onLoad);
      wc.removeListener('destroyed', rec.onGone);
    }
    this.rec = null;
    this.onChange();
  }

  writeGuide(rec) {
    const video = path.basename(rec.file);
    const date = new Date(rec.startedAt).toLocaleString();
    const md = [`# ${rec.title}`, '', `Recorded with Skillerr · ${date}`, '', `Video: [${video}](${video})`, '',
      ...rec.steps.flatMap((s) => [`## ${s.n}. ${s.text}`, '', `![Step ${s.n}](${s.img})`, ''])].join('\n');
    fs.writeFileSync(path.join(rec.dir, 'guide.md'), md);
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(rec.title)}</title><style>
:root{color-scheme:light dark;--bg:#f6f6f9;--card:#fff;--text:#16161d;--muted:#6b6b7b;--line:#e4e4ec;--accent:#6d4aff}
@media (prefers-color-scheme:dark){:root{--bg:#0e0e13;--card:#17171f;--text:#ececf3;--muted:#9a9aab;--line:#2a2a36;--accent:#8b6cff}}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 -apple-system,system-ui,sans-serif}
main{max-width:880px;margin:0 auto;padding:40px 16px 80px}h1{font-size:30px;letter-spacing:-.02em;margin:0 0 4px}
.meta{color:var(--muted);margin:0 0 28px}video{width:100%;border-radius:14px;border:1px solid var(--line);background:#000;margin-bottom:36px}
.step{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;margin:0 0 18px}
.step h2{display:flex;gap:12px;align-items:baseline;font-size:18px;margin:0 0 14px}.n{flex:none;width:28px;height:28px;border-radius:50%;
display:grid;place-items:center;background:var(--accent);color:#fff;font-size:14px}img{width:100%;border-radius:10px;border:1px solid var(--line)}
</style></head><body><main><h1>${escHtml(rec.title)}</h1><p class="meta">Recorded with Skillerr · ${escHtml(date)} · ${rec.steps.length} steps</p>
<video src="${escHtml(video)}" controls playsinline></video>
${rec.steps.map((s) => `<section class="step"><h2><span class="n">${s.n}</span>${escHtml(s.text)}</h2><img src="${s.img}" alt="Step ${s.n}"></section>`).join('\n')}
</main></body></html>`;
    const file = path.join(rec.dir, 'guide.html');
    fs.writeFileSync(file, html);
    return file;
  }
}

module.exports = { Recorder };
