// Site icons kept on this computer, like Chrome's own icon store: tucked tabs, trails and history show real icons
// straight away, offline, without loading a page (or even asking the site). The browser UI never loads an icon from the
// web: it asks for skillerr-icon://i/?f=<icon url>, and main.js answers from here (see main.js, "site icons").
// One small file per icon URL, and an index of when each was saved; the oldest go past MAX.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX = 5000;
const MAX_BYTES = 150 * 1024;
const MIMES = /^image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|jpeg|gif|webp|avif)$/i;

class Favicons {
  constructor(dir) {
    this.dir = dir;
    this.indexFile = path.join(dir, 'index.json');
    this.index = null; // icon url → { file, mime, at }
  }

  load() {
    if (this.index) return this.index;
    try {
      this.index = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
    } catch {
      this.index = {};
    }
    return this.index;
  }

  has(url) {
    return !!this.load()[url];
  }

  get(url) {
    const e = this.load()[url];
    if (!e) return null;
    try {
      return { buf: fs.readFileSync(path.join(this.dir, e.file)), mime: e.mime };
    } catch {
      delete this.index[url];
      return null;
    }
  }

  // Keep an icon. Returns false for anything that isn't a small image.
  put(url, buf, mime = 'image/png') {
    const type = String(mime || '').split(';')[0].trim().toLowerCase() || 'image/png';
    if (!/^(https?|data):/i.test(url || '') || !buf?.length || buf.length > MAX_BYTES || !MIMES.test(type)) return false;
    const index = this.load();
    const file = crypto.createHash('sha1').update(url).digest('hex').slice(0, 24);
    try {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(this.dir, file), buf, { mode: 0o600 });
    } catch {
      return false;
    }
    index[url] = { file, mime: type, at: Date.now() };
    const urls = Object.keys(index);
    if (urls.length > MAX) {
      for (const u of urls.sort((a, b) => index[a].at - index[b].at).slice(0, urls.length - MAX)) {
        try {
          fs.unlinkSync(path.join(this.dir, index[u].file));
        } catch {}
        delete index[u];
      }
    }
    this.saveSoon();
    return true;
  }

  saveSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 1000);
  }

  save() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.indexFile, JSON.stringify(this.index || {}), { mode: 0o600 });
    } catch {}
  }

  clear() {
    this.index = {};
    try {
      fs.rmSync(this.dir, { recursive: true, force: true });
    } catch {}
  }
}

// What the browser UI puts in <img src>: a site's icon, from this computer, never fetched by the UI itself.
const iconSrc = (url) => (/^https?:/i.test(url || '') ? `skillerr-icon://i/?f=${encodeURIComponent(url)}` : url || '');

module.exports = { Favicons, iconSrc };
