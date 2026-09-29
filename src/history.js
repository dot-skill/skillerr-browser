// Browsing history: every page opened in Skillerr, by the user or an AI app, like any browser's history. It's what
// History (⌘Y) lists and what "Clear browsing data" clears. Kept on this computer for 90 days, one line per visit in a
// file only the user can read. Trails (journeys) and research memory (what AIs learned) are separate and have their
// own switches; this is the plain record of where the browser went.
const fs = require('fs');
const path = require('path');

const KEEP_MS = 90 * 24 * 3600 * 1000;
const MAX_VISITS = 100000;
const SAME_VISIT_MS = 30 * 60 * 1000; // the same page again in the same tab within this long is one visit (reloads, back and forth)

class History {
  constructor(dir, { now = Date.now } = {}) {
    this.dir = dir;
    this.file = path.join(dir, 'history.jsonl');
    this.now = now;
    this.visits = null; // loaded on first use
    this.pending = [];
    this.timer = null;
  }

  load() {
    if (this.visits) return this.visits;
    this.visits = [];
    let text = '';
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {}
    const cutoff = this.now() - KEEP_MS;
    let dropped = 0;
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const v = JSON.parse(line);
        if (v.del) this.visits = this.visits.filter(v.del.urls ? (x) => !v.del.urls.includes(x.url) : (x) => x.at < v.del.since);
        else if (v.ref) {
          const x = this.visits.find((y) => y.id === v.ref);
          if (x && v.title) x.title = v.title;
          if (x && v.favicon) x.favicon = v.favicon;
        } else if (v.at >= cutoff) this.visits.push(v);
        else dropped++;
      } catch {}
    }
    if (this.visits.length > MAX_VISITS) {
      dropped += this.visits.length - MAX_VISITS;
      this.visits = this.visits.slice(-MAX_VISITS);
    }
    if (dropped || /"del"|"ref"/.test(text)) this.compact();
    return this.visits;
  }

  // A page was opened. by: the AI app that opened it, or null for the user. Returns the visit's id.
  add({ url, title = '', favicon = null, by = null, tabId = null }) {
    if (!/^https?:/i.test(url || '')) return null;
    const visits = this.load();
    const at = this.now();
    const last = visits[visits.length - 1];
    if (last && last.url === url && last.tabId === tabId && at - last.at < SAME_VISIT_MS) {
      last.at = at;
      return last.id;
    }
    const v = { id: `${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`, url, title: String(title).slice(0, 300), favicon, by, tabId, at };
    visits.push(v);
    this.write(v);
    return v.id;
  }

  // Titles and icons arrive after the page starts loading.
  update(id, { title, favicon }) {
    const v = this.load().find((x) => x.id === id);
    if (!v) return;
    const change = {};
    if (favicon && favicon !== v.favicon) v.favicon = change.favicon = String(favicon).slice(0, 500);
    if (title && title !== v.title) v.title = change.title = String(title).slice(0, 300);
    if (Object.keys(change).length) this.write({ ref: id, ...change });
  }

  // Newest first, optionally matching words in the title or address; `before` pages through older visits.
  list({ q = '', limit = 300, before = Infinity } = {}) {
    const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
    const out = [];
    const visits = this.load();
    for (let i = visits.length - 1; i >= 0 && out.length < limit; i--) {
      const v = visits[i];
      if (v.at >= before) continue;
      const hay = `${v.title} ${v.url}`.toLowerCase();
      if (words.every((w) => hay.includes(w))) out.push(v);
    }
    return out;
  }

  deleteUrls(urls) {
    const set = new Set([].concat(urls || []));
    this.visits = this.load().filter((x) => !set.has(x.url));
    this.write({ del: { urls: [...set] } });
    return set.size;
  }

  // Everything visited since a time (0: all of it).
  deleteSince(since = 0) {
    const before = this.load().length;
    this.visits = this.visits.filter((x) => x.at < since);
    if (!since) this.compact();
    else this.write({ del: { since } });
    return before - this.visits.length;
  }

  write(entry) {
    this.pending.push(JSON.stringify(entry));
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 1000);
    this.timer.unref?.();
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending.length) return;
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(this.file, this.pending.join('\n') + '\n', { mode: 0o600 });
    this.pending = [];
  }

  // Rewrite the file with only what's kept (after deletions, and old visits falling off).
  compact() {
    this.pending = [];
    clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, this.visits.map((v) => JSON.stringify(v)).join('\n') + (this.visits.length ? '\n' : ''), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { History, KEEP_MS };
