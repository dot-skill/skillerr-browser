// Import from Google Chrome on this computer: bookmarks, history and open tabs (read from the local profile,
// never from Google's servers). Runs only when the user clicks Import. Chrome's files are copied
// first because Chrome keeps them locked while it runs.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'User Data')
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome')
    : path.join(os.homedir(), '.config', 'google-chrome');
const HISTORY_DAYS = 90;
const HISTORY_MAX = 2000;

function profiles() {
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(ROOT, 'Local State'), 'utf8')).profile.info_cache;
    return Object.entries(cache).map(([dir, v]) => ({ dir, name: v.name || dir })).filter((p) => fs.existsSync(path.join(ROOT, p.dir)));
  } catch {
    return fs.existsSync(path.join(ROOT, 'Default')) ? [{ dir: 'Default', name: 'Default' }] : [];
  }
}

function profileDir(dir) {
  const p = profiles().find((x) => x.dir === dir);
  if (!p) throw new Error('That Chrome profile was not found.');
  return path.join(ROOT, p.dir);
}

function bookmarks(dir) {
  const file = path.join(profileDir(dir), 'Bookmarks');
  if (!fs.existsSync(file)) return []; // a profile that never saved a bookmark has no file
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [];
  const walk = (node, folder) => {
    if (node.type === 'url' && /^https?:/.test(node.url)) out.push({ title: node.name || node.url, url: node.url, folder });
    for (const c of node.children || []) walk(c, node.type === 'folder' && node.name ? (folder ? `${folder} > ${node.name}` : node.name) : folder);
  };
  for (const [key, root] of Object.entries(data.roots || {})) if (root && typeof root === 'object') walk(root, key === 'bookmark_bar' ? 'Bookmarks bar' : '');
  return out;
}

// Most-visited pages from the last HISTORY_DAYS days, via a private copy of Chrome's History database.
function history(dir) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skillerr-chrome-')), 'History');
  fs.copyFileSync(path.join(profileDir(dir), 'History'), tmp);
  try {
    const db = new DatabaseSync(tmp, { readOnly: true });
    // Chrome time: microseconds since 1601-01-01, beyond Number's safe range, hence BigInt.
    const since = (BigInt(Date.now() - HISTORY_DAYS * 864e5) + 11644473600000n) * 1000n;
    const stmt = db.prepare(`SELECT url, title, visit_count, last_visit_time FROM urls
      WHERE hidden = 0 AND last_visit_time > ? AND url LIKE 'http%' ORDER BY visit_count DESC, last_visit_time DESC LIMIT ?`);
    stmt.setReadBigInts(true);
    const rows = stmt.all(since, HISTORY_MAX);
    db.close();
    return rows.map((r) => ({ url: r.url, title: r.title, visits: Number(r.visit_count),
      lastVisited: new Date(Number(r.last_visit_time / 1000n - 11644473600000n)).toISOString() }));
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}

// ---------- open tabs, from Chrome's session file ----------
// Chrome keeps the open windows and tabs in <profile>/Sessions/Session_<time> (older versions: "Current Session"), an
// "SNSS" file: a header, then commands of [uint16 size][uint8 id][payload]. Replaying the commands gives the tabs as
// they are now. Only the commands used here are read; the file is copied first, as Chrome may be writing it.
const CMD = { TAB_WINDOW: 0, TAB_INDEX: 2, NAVIGATION: 6, SELECTED_NAVIGATION: 7, SELECTED_TAB: 8, PINNED: 12, TAB_CLOSED: 16, WINDOW_CLOSED: 17 };

function sessionFile(profileDirPath) {
  const dir = path.join(profileDirPath, 'Sessions');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.startsWith('Session_')).map((f) => path.join(dir, f));
  } catch {}
  const legacy = path.join(profileDirPath, 'Current Session');
  if (fs.existsSync(legacy)) files.push(legacy);
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
}

// Pickle payloads (NAVIGATION): uint32 size, then int32 fields; strings are int32 length + bytes, padded to 4;
// UTF-16 strings are int32 length in characters + 2 bytes each, padded to 4.
function readNavigation(p) {
  let o = 4;
  const i32 = () => {
    const v = p.readInt32LE(o);
    o += 4;
    return v;
  };
  const tab = i32();
  const index = i32();
  const ul = i32();
  if (ul < 0 || o + ul > p.length) return null;
  const url = p.toString('latin1', o, o + ul);
  o += Math.ceil(ul / 4) * 4;
  let title = '';
  if (o + 4 <= p.length) {
    const tl = i32();
    if (tl > 0 && o + tl * 2 <= p.length) title = p.toString('utf16le', o, o + tl * 2);
  }
  return { tab, index, url, title };
}

// The tabs open in the session: [{ url, title, window, index, active, pinned }], in window and tab order.
function parseSession(buf) {
  if (buf.toString('latin1', 0, 4) !== 'SNSS') throw new Error('Not a Chrome session file');
  const tabs = new Map(); // tab id → { window, index, pinned, navs: Map index → nav, selected }
  const windows = new Map(); // window id → { selected, closed }
  const tab = (id) => tabs.get(id) || tabs.set(id, { window: null, index: 0, pinned: false, navs: new Map(), selected: null, closed: false }).get(id);
  const win = (id) => windows.get(id) || windows.set(id, { selected: 0, closed: false }).get(id);
  let o = 8;
  while (o + 2 <= buf.length) {
    const size = buf.readUInt16LE(o);
    o += 2;
    if (!size || o + size > buf.length) break;
    const id = buf[o];
    const p = buf.subarray(o + 1, o + size);
    o += size;
    try {
      if (id === CMD.NAVIGATION) {
        const n = readNavigation(p);
        if (n) tab(n.tab).navs.set(n.index, n);
      } else if (id === CMD.TAB_WINDOW && p.length >= 8) tab(p.readInt32LE(4)).window = p.readInt32LE(0);
      else if (id === CMD.TAB_INDEX && p.length >= 8) tab(p.readInt32LE(0)).index = p.readInt32LE(4);
      else if (id === CMD.SELECTED_NAVIGATION && p.length >= 8) tab(p.readInt32LE(0)).selected = p.readInt32LE(4);
      else if (id === CMD.SELECTED_TAB && p.length >= 8) win(p.readInt32LE(0)).selected = p.readInt32LE(4);
      else if (id === CMD.PINNED && p.length >= 5) tab(p.readInt32LE(0)).pinned = p[4] !== 0;
      else if (id === CMD.TAB_CLOSED && p.length >= 4) tab(p.readInt32LE(0)).closed = true;
      else if (id === CMD.WINDOW_CLOSED && p.length >= 4) win(p.readInt32LE(0)).closed = true;
    } catch {} // a damaged command is skipped
  }
  const out = [];
  for (const t of tabs.values()) {
    if (t.closed || t.window == null || windows.get(t.window)?.closed || !t.navs.size) continue;
    const idx = t.navs.has(t.selected) ? t.selected : Math.max(...t.navs.keys());
    const nav = t.navs.get(idx);
    out.push({ url: nav.url, title: nav.title, window: t.window, index: t.index, pinned: t.pinned, active: (windows.get(t.window)?.selected ?? -1) === t.index });
  }
  return out.sort((a, b) => a.window - b.window || a.index - b.index);
}

// The web pages open in Chrome now. From Chrome's history (a private copy): titles where the session file has none,
// when each page was first opened (firstVisit, ms), and on how many of the last 21 days its site was used (hostDays),
// which is how the Orb tells sittings and everyday sites apart.
function openTabs(dir) {
  const base = profileDir(dir);
  const file = sessionFile(base);
  if (!file) return [];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillerr-chrome-'));
  try {
    const copy = path.join(tmpDir, 'Session');
    fs.copyFileSync(file, copy);
    const tabs = parseSession(fs.readFileSync(copy)).filter((t) => /^https?:/i.test(t.url));
    if (tabs.length && fs.existsSync(path.join(base, 'History'))) {
      const hist = path.join(tmpDir, 'History');
      fs.copyFileSync(path.join(base, 'History'), hist);
      const db = new DatabaseSync(hist, { readOnly: true });
      const toMs = (v) => Number(BigInt(v) / 1000n - 11644473600000n); // Chrome time: µs since 1601
      const title = db.prepare('SELECT title FROM urls WHERE url = ? LIMIT 1');
      const first = db.prepare('SELECT MIN(v.visit_time) AS t FROM visits v JOIN urls u ON u.id = v.url WHERE u.url = ?');
      first.setReadBigInts(true);
      const since = (BigInt(Date.now() - 21 * 864e5) + 11644473600000n) * 1000n;
      const recent = db.prepare('SELECT u.url AS url, v.visit_time AS t FROM visits v JOIN urls u ON u.id = v.url WHERE v.visit_time > ?');
      recent.setReadBigInts(true);
      const days = new Map(); // host → days used
      for (const r of recent.all(since)) {
        let host = '';
        try {
          host = new URL(r.url).hostname.replace(/^www\./, '');
        } catch {
          continue;
        }
        (days.get(host) || days.set(host, new Set()).get(host)).add(Math.floor(toMs(r.t) / 864e5));
      }
      for (const t of tabs) {
        if (!t.title) t.title = title.get(t.url)?.title || '';
        const f = first.get(t.url)?.t;
        if (f) t.firstVisit = toMs(f);
        try {
          t.hostDays = days.get(new URL(t.url).hostname.replace(/^www\./, ''))?.size || 0;
        } catch {}
      }
      db.close();
    }
    return tabs;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { available: () => fs.existsSync(ROOT), profiles, bookmarks, history, openTabs, parseSession };
