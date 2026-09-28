// Import from Google Chrome on this Mac: bookmarks and history (read from the local profile,
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

module.exports = { available: () => fs.existsSync(ROOT), profiles, bookmarks, history };
