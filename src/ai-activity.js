// What each AI app did in Skillerr in its current research session: which pages it opened or tried to open.
// The live view in the AI app's chat shows only this session's tabs, and its Audit list comes from here.
// Kept in memory only (it's what the user sees while the chat is open), and independent of "remember research".

const SESSION_GAP_MS = 15 * 60 * 1000; // same as research memory: an AI idle this long starts a new session
const MAX_PAGES = 500; // per session
const MAX_SESSIONS = 20;

// One entry per page: a later attempt at the same page updates it rather than adding a line.
const pageKey = (url) => String(url || '').replace(/#.*$/, '').replace(/\/$/, '');

// Which of an attempt's states wins when the same page comes up again: a page that was read stays read.
const RANK = { failed: 0, declined: 1, blocked: 2, opened: 3, read: 4 };

class AiActivity {
  constructor({ gapMs = SESSION_GAP_MS, now = () => Date.now() } = {}) {
    this.gapMs = gapMs;
    this.now = now;
    this.active = new Map(); // client → { id, last }
    this.pages = new Map(); // session id → Map(pageKey → entry), oldest session first
    this.seq = 0;
  }

  // The client's session, started (or continued) by a tool call.
  touch(client) {
    const t = this.now();
    const a = this.active.get(client);
    if (a && t - a.last < this.gapMs) {
      a.last = t;
      return a.id;
    }
    const id = `${client}#${t.toString(36)}-${++this.seq}`;
    this.active.set(client, { id, last: t });
    this.pages.set(id, new Map());
    while (this.pages.size > MAX_SESSIONS) this.pages.delete(this.pages.keys().next().value);
    return id;
  }

  // The client's session if it's still going; null after the gap (a new one starts with the next call).
  current(client) {
    const a = this.active.get(client);
    return a && this.now() - a.last < this.gapMs ? a.id : null;
  }

  // A page the AI opened, read or tried to. state: read | opened | failed | blocked | declined.
  record(session, { url, title, tool, state, reason, tabId } = {}) {
    const list = this.pages.get(session);
    const key = pageKey(url);
    if (!list || !key || /^(about|chrome|devtools|data):/.test(key)) return;
    const prev = list.get(key);
    const keepState = prev && RANK[prev.state] > RANK[state];
    const entry = {
      url: String(url),
      title: String(title || prev?.title || '').slice(0, 200),
      tool: tool || prev?.tool || '',
      state: keepState ? prev.state : state,
      reason: keepState ? prev.reason : reason ? String(reason).slice(0, 200) : undefined,
      tabId: tabId ?? prev?.tabId ?? null,
      attempts: (prev?.attempts || 0) + 1,
      first: prev?.first || this.now(),
      ts: this.now(),
    };
    list.delete(key); // re-insert so the list stays in order of last activity
    list.set(key, entry);
    while (list.size > MAX_PAGES) list.delete(list.keys().next().value);
  }

  // The current session's pages, most recent first.
  list(client) {
    const id = this.current(client);
    return id ? [...(this.pages.get(id)?.values() || [])].reverse() : [];
  }

  count(client) {
    const id = this.current(client);
    return id ? this.pages.get(id)?.size || 0 : 0;
  }
}

// Which tabs the live view shows for a client: only tabs that client's current session opened or worked in.
// The fleet when it has several going at once (or they're side by side), otherwise its latest tab. Never the
// user's own tabs, even when nothing of the AI's is open.
// tabs: [{ id, isStart, aiBy, aiSession, aiUntil }]; mosaic: tab ids shown side by side, or null.
function pickPreviewTabs(tabs, { client, session, mosaic = null, now = Date.now(), recentMs = 30000, idleMs = 4000, max = 6 }) {
  if (!session) return { mode: 'single', ids: [] };
  const mine = tabs.filter((t) => !t.isStart && t.aiBy === client && t.aiSession === session);
  const own = new Set(mine.map((t) => t.id));
  const side = (mosaic || []).filter((id) => own.has(id));
  if (side.length > 1) return { mode: 'fleet', ids: side.slice(0, max) };
  const byRecent = mine.slice().sort((a, b) => (b.aiUntil || 0) - (a.aiUntil || 0));
  const recent = byRecent.filter((t) => now - ((t.aiUntil || 0) - idleMs) < recentMs);
  if (recent.length > 1) return { mode: 'fleet', ids: recent.slice(0, max).map((t) => t.id) };
  return { mode: 'single', ids: byRecent.slice(0, 1).map((t) => t.id) };
}

// Whose name the Pilot panel shows. An AI app says hello whenever it opens a connection (Claude Desktop does for every
// chat, even one that never browses), so a hello only takes the header when no other app has acted within `quietMs`:
// the app that is actually driving keeps it.
function helloTakesHeader(current, client, lastCallAt, now, quietMs) {
  return !current || current.name === client || now - lastCallAt >= quietMs;
}

// The model an AI app says it runs on. MCP's clientInfo names the app and its version, never the model, so this only
// ever comes from the app itself (the whoami tool, or SKILLERR_MODEL in its Skillerr config) and is shown as reported.
// Plain text, short: it's display text from outside.
function reportedModel(s) {
  const m = String(s ?? '').replace(/[\u0000-\u001f\u007f<>{}\[\]`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return m || null;
}

module.exports = { AiActivity, pickPreviewTabs, pageKey, helloTakesHeader, reportedModel, SESSION_GAP_MS };
