// SKILLERR_TRACE_STARTUP=1 prints how long each start-up step took (ms since the process started).
const traceStartup = process.env.SKILLERR_TRACE_STARTUP ? (step) => process.stderr.write(`[startup] ${Math.round(performance.now())} ms ${step}\n`) : () => {};
traceStartup('main.js running');
const fs = require('fs');
const path = require('path');
const { app, BaseWindow, WebContentsView, ipcMain, Menu, clipboard, nativeTheme, dialog, shell } = require('electron');
const { TOOLS, runTool, toUrl, aiUrl, setSearchTemplate, setSearchApi, inspectTarget, restoreValue } = require('./tools');
const { startApiServer } = require('./api-server');
const { Agent } = require('./agent');
const connectors = require('./connect');
const skills = require('./skills');
const guard = require('./guard');
const { Recorder } = require('./recorder');
const store = require('./store');
const { Memory, recallText, tokens } = require('./memory');
const chrome_ = require('./chrome-import');
const { Trails, pageKey } = require('./trails');
const { buildHistoryGraph } = require('./history-graph');
const { Kilr } = require('./kilr');
const { cosine: kilrCosine } = require('./kilr/embed');

traceStartup('modules loaded');
// Read on first use (or in the background once the window is up), never before the window: a big memory
// (a Chrome history import is thousands of pages) would otherwise hold up every start.
const memory = new Memory(path.join(store.DIR, 'memory'), { lazy: true });
// No settings yet means Skillerr's data is new (first install, or it was deleted): AI-app connections left behind by an
// earlier install don't belong to it (connectors.reconcile). Checked before anything can write settings.
const freshData = !fs.existsSync(path.join(store.DIR, 'settings.json'));
let reconciling = Promise.resolve([]);
const { Embedder } = require('./embed');
const { AsyncLocalStorage } = require('async_hooks');
const { AiActivity, pickPreviewTabs } = require('./ai-activity');
// Kilr: Skillerr's own small AI (src/kilr), built in. It knows trails and research by meaning. Loaded on first use.
const KILR_DIR = path.join(__dirname, '..', 'assets', 'kilr'); // src/ and out/src/ alike
const KILR_PERSONAL = path.join(store.DIR, 'kilr', 'personal.bin'); // what Kilr learned from this user's trails
try { // staging builds called it Wenlo
  const old = path.join(store.DIR, 'wenlo', 'personal.bin');
  if (fs.existsSync(old) && !fs.existsSync(KILR_PERSONAL)) {
    fs.mkdirSync(path.dirname(KILR_PERSONAL), { recursive: true, mode: 0o700 });
    fs.renameSync(old, KILR_PERSONAL);
  }
} catch {}
const kilr = new Kilr({ dir: KILR_DIR, personalFile: KILR_PERSONAL });
const history = new (require('./history').History)(store.DIR); // browsing history: History (⌘Y)
// What Kilr has been doing lately, for its screen: [{ at, what }], newest first.
const kilrLog = [];
function kilrDid(what) {
  kilrLog.unshift({ at: Date.now(), what: String(what).slice(0, 200) });
  if (kilrLog.length > 60) kilrLog.length = 60;
}
const kilrOn = () => store.getSettings().kilr !== false;
const embedder = new Embedder({
  memory, dir: path.join(store.DIR, 'memory'),
  builtin: () => kilr.embedder,
  builtinId: () => kilr.embedder.id,
  getConfig: () => { const s = store.getSettings(); return { on: s.semanticRecall !== false && remembering(), baseUrl: s.embedBaseUrl, model: s.embedModel, builtin: s.kilr !== false }; },
});
// Semantic matches for a recall; null (keyword-only) if no local embedding model answers in time.
const similarTo = (q) => Promise.race([embedder.similar(q).catch(() => null), new Promise((r) => setTimeout(() => r(null), 3000))]);
const remembering = () => store.getSettings().remember !== false;

// The research session a controller is in; tells the panel when a new one starts (for "Don't remember").
function memSession(controller, opts) {
  const s = memory.session(controller, opts);
  if (s.isNew) ui('mem-session', { controller: controller.name, via: controller.via, id: s.id });
  return s.id;
}

// Pages with password or payment fields are remembered as a visit only, never their words.
const SENSITIVE_PAGE_JS = `!!document.querySelector('input[type=password], [autocomplete^="cc-"], input[name*=card i], input[name*=cvv i], input[name*=cvc i]')`;

async function rememberPage(controller, tab, text) {
  if (!tab || tab.isStart || tab.view.webContents.isDestroyed()) return null;
  const wc = tab.view.webContents;
  const sensitive = text ? await wc.executeJavaScript(SENSITIVE_PAGE_JS).catch(() => true) : false;
  const id = memory.visit(memSession(controller), { url: wc.getURL(), title: wc.getTitle(), text, sensitive });
  // Backlinks: when a page is read, note which already-remembered pages it links to.
  if (text && !sensitive) {
    const links = await wc.executeJavaScript(LINKS_JS).catch(() => []);
    memory.linksTo(wc.getURL(), links.map((l) => l.href));
  }
  return id;
}

// After a successful tool call: record which pages this research touched and what was read.
async function capture(controller, name, args, tab, result, info) {
  if (!remembering()) return;
  try {
    if (name === 'read_tabs') {
      for (const part of String(result.text || '').split(/^## tab /m).slice(1)) {
        const id = Number(part.match(/^(\d+)/)?.[1]);
        await rememberPage(controller, getTab(id), guard.unwrap(part.split('\n').slice(1).join('\n')));
      }
    } else if (name === 'open_tabs') {
      const ids = [];
      for (const m of String(result.text || '').matchAll(/tab (\d+):/g)) ids.push(await rememberPage(controller, getTab(Number(m[1]))));
      memory.openedTogether(ids); // one cluster of attention
    } else if (name === 'read_page') {
      await rememberPage(controller, tab, info?.sensitive ? '' : guard.unwrap(result.text || ''));
    } else if (['navigate', 'click', 'go_back', 'go_forward', 'new_tab', 'switch_tab', 'snapshot', 'type', 'press_key'].includes(name)) {
      await rememberPage(controller, name === 'new_tab' || name === 'switch_tab' ? activeTab() : tab);
    }
  } catch {} // memory must never break browsing
}

// Layout — must match the CSS variables in ui/ui.css.
const TOP_BAR = 88;
const PANEL_WIDTH = 400;
const GAP = 8; // margin around the page card
const FRAME = 2; // glow ring around the page card
const RADIUS = 10;
const HUD = { width: 560, height: 76, bottom: 18 };
const CAPTION = { width: 1100, height: 120, bottom: 104 };
const TILE = { label: 28, gap: 12, desktopWidth: 1280 }; // fleet tiles render a desktop-width page, zoomed to fit
const IDLE_AFTER_MS = 4000;
const APPROVAL_TIMEOUT_MS = 55000; // under typical MCP client timeouts; nobody may be watching
const MAX_WORKERS = 8;

app.setName('Skillerr'); // menu bar and About; the Dock name comes from the packaged app's bundle
if (store.PROFILE) app.setPath('userData', path.join(app.getPath('appData'), `Skillerr-${store.PROFILE}`)); // own cookies, own lock
if (!app.requestSingleInstanceLock()) app.quit();

// skillerr:// links: skillerr.com hands the signed-in session back to the app after "Sign in with Google".
const PRO_API = 'https://skillerr.com/api/pro/v1';
const PRO_OPEN = false; // Skillerr Pro stays off until launch (skillerr.com enforces it too): signing in is just an account.
if (store.PROFILE) {
  // test/demo profiles never claim skillerr:// links
} else if (process.defaultApp) app.setAsDefaultProtocolClient('skillerr', process.execPath, [path.resolve(process.argv[1] || '.')]);
else app.setAsDefaultProtocolClient('skillerr');

const sessionInfo = (token) => {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString());
  } catch {
    return null;
  }
};

function handleDeepLink(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return;
  }
  if (u.protocol !== 'skillerr:' || u.hostname !== 'auth') return;
  const token = u.searchParams.get('token') || '';
  const info = sessionInfo(token);
  if (!info?.email) return;
  signInWith(token);
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
    togglePanel(true);
    ui('open-sheet', 'settings');
  }
}

function signInWith(token) {
  const s = store.getSettings();
  store.saveSettings(PRO_OPEN ? { ...s, proSession: token, pane: 'cloud', provider: 'openai-compatible', baseUrl: PRO_API, apiKey: token,
    model: s.proModel || 'anthropic/claude-sonnet-5' } : { ...s, proSession: token });
  ui('pro-account', { email: sessionInfo(token)?.email });
}
app.on('open-url', (e, url) => {
  e.preventDefault();
  app.whenReady().then(() => handleDeepLink(url));
});

// Appearance: System follows macOS; Light/Dark override it for the browser UI and pages that support it.
function applyTheme(theme = store.getSettings().theme) {
  nativeTheme.themeSource = ['light', 'dark'].includes(theme) ? theme : 'system';
  redrawTabs();
}

// Every open page gets the new light/dark preference now, including fleet tiles and background tabs,
// which are throttled and might otherwise not redraw until clicked.
function redrawTabs() {
  for (const t of tabs) {
    const wc = t.view?.webContents;
    if (!wc || wc.isDestroyed()) continue;
    wc.setBackgroundThrottling(false);
    wc.invalidate();
    setTimeout(() => {
      if (!wc.isDestroyed() && (t.aiUntil || 0) < Date.now()) wc.setBackgroundThrottling(true);
    }, 1500);
  }
}

// Look like regular Chrome so sites don't serve "unsupported browser" pages.
app.userAgentFallback = app.userAgentFallback.replace(/ Electron\/\S+/, '').replace(/ skillerr-browser\/\S+/, '');

let win;
let chrome; // the browser UI (tabs, toolbar, start page, panel), stacked above background tabs
let hud; // floating status pill drawn over the page while an AI is driving
let recorder; // demo recording (one tab at a time)
let captionView; // big caption drawn over the whole window during window recordings
let mosaic = null; // fleet view: ids of the tabs shown side by side, live
let panelOpen = true;
let nextTabId = 1;
let activeTabId = null;
const tabs = [];

const status = {
  paused: false,
  controller: null, // { name, via: 'mcp' | 'builtin' }
  active: false,
  agentRunning: false,
  awaitingApproval: false,
  recording: null, // { tabId, title, startedAt } while a tab is being recorded
  requireApproval: store.getSettings().requireApproval,
};
let idleTimer = null;
let seq = 0;
const pendingApprovals = new Map();

function ui(channel, data) {
  if (chrome && !chrome.webContents.isDestroyed()) chrome.webContents.send(channel, data);
  if (hud && !hud.webContents.isDestroyed()) hud.webContents.send(channel, data);
  if (channel === 'log' && data?.id) noteStep(data);
}

// ---------------- live preview for AI apps (MCP Apps: a view inside Claude Desktop's chat) ----------------
// The view (mcp/preview/) polls previewFrame through the bridge: what the AI is doing right now, as thumbnails —
// one tab, or the fleet when it works on several at once — plus Pause and Take over.
const recentSteps = new Map(); // log entry id → latest state of that step
function noteStep(e) {
  recentSteps.set(e.id, { ...(recentSteps.get(e.id) || {}), ...e });
  if (recentSteps.size > 40) recentSteps.delete(recentSteps.keys().next().value);
}
const previewViews = new Map(); // client → { viewId, createdAt } of its newest preview, the only one kept live
// What each AI app opened or tried to open in its current session (the live view's tabs and its Audit list).
const activity = new AiActivity();
const aiCall = new AsyncLocalStorage(); // { client, session } while an AI's tool call runs: tabs it opens are its own
// The last thumbnail sent to each client's live view, per tab: a page that hasn't changed isn't captured (or sent) again.
const shots = new Map(); // client → { viewId, tabs: Map(tabId → { url, width, at }) }
const RESHOOT_MS = 2000;

async function thumb(tab, width) {
  const wc = tab?.view?.webContents;
  if (!wc || wc.isDestroyed() || tab.sleeping || tab.isStart) return null;
  try {
    const img = await wc.capturePage();
    if (img.isEmpty()) return null;
    const small = img.getSize().width > width ? img.resize({ width, quality: 'good' }) : img;
    return 'data:image/jpeg;base64,' + small.toJPEG(62).toString('base64');
  } catch {
    return null;
  }
}

async function previewFrame(client, { viewId = '', createdAt = 0 } = {}) {
  const newest = previewViews.get(client);
  if (!newest || createdAt >= newest.createdAt) previewViews.set(client, { viewId, createdAt });
  const superseded = previewViews.get(client).viewId !== viewId;
  const count = activity.count(client);
  // An earlier view in the chat is just a line pointing down to the live one: no tabs, no screenshots.
  if (superseded) return { superseded, count, ts: Date.now() };
  const now = Date.now();
  const session = activity.current(client);
  const pick = pickPreviewTabs(tabs, { client, session, mosaic, now, idleMs: IDLE_AFTER_MS });
  const shown = pick.ids.map(getTab).filter(Boolean);
  const width = pick.mode === 'fleet' ? 480 : 720; // fleet tiles are about half the view's width, on high-density screens
  if (shots.get(client)?.viewId !== viewId) shots.set(client, { viewId, tabs: new Map() }); // a new view has no pictures yet
  const sent = shots.get(client).tabs;
  const tiles = await Promise.all(shown.map(async (t) => {
    const wc = t.view.webContents;
    const url = t.sleeping ? t.sleeping.url : wc.isDestroyed() ? '' : wc.getURL();
    const working = (t.aiUntil || 0) > now;
    const loading = !wc.isDestroyed() && wc.isLoading();
    // Same page, not loading or being worked on, and captured lately: the view keeps the picture it has.
    const last = sent.get(t.id);
    const fresh = last && last.url === url && last.width === width && (!(working || loading) || now - last.at < RESHOOT_MS);
    let image = null;
    if (!fresh) {
      image = await thumb(t, width);
      if (image) sent.set(t.id, { url, width, at: now });
    }
    return { id: t.id, title: (t.sleeping ? t.sleeping.title : wc.getTitle()) || url, url, working, loading, image, same: !!fresh };
  }));
  for (const id of sent.keys()) if (!pick.ids.includes(id)) sent.delete(id); // a tile that comes back is captured again
  const steps = [...recentSteps.values()].filter((e) => e.controller === client && e.session === session).slice(-4)
    .map((e) => ({ id: e.id, tool: e.tool, args: e.args, target: e.target, state: e.state, reason: e.reason, summary: e.summary, ts: e.ts }));
  const deep = deepSettings();
  return {
    superseded, mode: pick.mode, tiles, steps, count, deep: deep.on ? deep.depth : 0,
    // The view is this app's: it's live while this app is the one at work, and says so by name.
    controller: client || status.controller?.name || null, live: !!(status.active || status.agentRunning) && (!client || status.controller?.name === client), paused: status.paused,
    awaitingApproval: status.awaitingApproval, ts: now,
  };
}

// The Audit list: every page this client's current session opened, read or tried to, most recent first.
function previewAudit(client) {
  return { pages: activity.list(client).map(({ url, title, tool, state, reason, attempts, ts }) => ({ url, title, tool, state, reason, attempts, ts })) };
}

function previewAction(client, { action, tabId, url } = {}) {
  if (action === 'open') { // from the Audit list: the AI's tab still showing that page, or a new tab
    if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Only web pages can be opened from the live view.');
    const session = activity.current(client);
    const key = (u) => String(u || '').replace(/#.*$/, '').replace(/\/$/, '');
    const t = tabs.find((x) => !x.isStart && x.aiBy === client && x.aiSession === session && key(tabUrl(x)) === key(url));
    if (mosaic) exitMosaic();
    if (t) switchTab(t.id);
    else newTab(url);
    action = 'focus';
  }
  if (action === 'pause') setPaused(true);
  else if (action === 'resume') setPaused(false);
  else if (action === 'focus' || action === 'takeover') {
    if (action === 'takeover') setPaused(true); // Take over: the AI waits while the user drives
    const t = tabId != null ? getTab(Number(tabId)) : null;
    if (t) {
      if (mosaic && !mosaic.includes(t.id)) exitMosaic();
      if (!mosaic) switchTab(t.id);
    }
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      app.focus({ steal: true });
    }
  } else throw new Error(`Unknown preview action: ${action}`);
  return { ok: true, paused: status.paused };
}

// ---------------- tabs ----------------

const tabInfo = (t) => baseTabInfo(t);
function baseTabInfo(t) {
  if (t.sleeping) {
    return { id: t.id, title: t.sleeping.title, url: t.sleeping.url, internal: null, isStart: false, loading: false, favicon: t.sleeping.favicon,
      canGoBack: false, canGoForward: false, active: t.id === activeTabId, tiled: false, ai: false, asleep: true,
      group: t.groupId && groups.has(t.groupId) ? groupInfo(groups.get(t.groupId)) : null };
  }
  const wc = t.view.webContents;
  return {
    id: t.id,
    title: t.internal === 'memory' ? 'Skillerr Orb' : t.internal === 'data' ? 'History & Bookmarks' : t.internal === 'trails' ? 'Trails' : t.isStart ? 'New Tab' : wc.getTitle() || wc.getURL() || 'Loading…',
    url: t.isStart ? '' : wc.getURL(),
    internal: t.internal || null,
    isStart: t.isStart,
    loading: !t.isStart && wc.isLoading(),
    favicon: t.isStart ? null : t.favicon || null,
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    active: t.id === activeTabId,
    tiled: !!mosaic && mosaic.includes(t.id),
    ai: (t.aiUntil || 0) > Date.now(), // an AI acted on this tab in the last few seconds
    group: t.groupId && groups.has(t.groupId) ? groupInfo(groups.get(t.groupId)) : null,
  };
}

// ---------- tab groups: tabs an AI opens for one research task stay together ----------
const groups = new Map(); // id → { id, key, controller, sessionId, color, created }
const GROUP_COLORS = ['#8b6cff', '#3de0c0', '#ff7ac6', '#fbbf24', '#60a5fa', '#34d399', '#fb923c', '#c084fc'];
let groupSeq = 0;
function groupInfo(g) {
  const goal = g.sessionId && memory.nodes.get(g.sessionId)?.goal;
  const trailTitle = g.trailId && trailStore?.get(g.trailId)?.title;
  return { id: g.id, title: goal || trailTitle || g.controller, controller: g.controller, color: g.color, trailId: g.trailId || null };
}
function groupFor(controller) {
  const sessionId = remembering() ? memory.active.get(controller.name)?.id : null;
  const key = sessionId || `${controller.name}:${new Date().toDateString()}`;
  for (const g of groups.values()) if (g.key === key) return g;
  const g = { id: ++groupSeq, key, controller: controller.name, sessionId, color: GROUP_COLORS[(groupSeq - 1) % GROUP_COLORS.length], created: Date.now() };
  groups.set(g.id, g);
  return g;
}
function assignGroup(controller, tabIds) {
  const list = tabIds.map(getTab).filter((t) => t && !t.groupId && !t.internal);
  if (!list.length) return;
  const g = groupFor(controller);
  for (const t of list) t.groupId = g.id;
  researchTrailOf(g);
  for (const t of list) researchVisit(t);
  pushTabs();
}

// ---------- research an AI did: its own trail (src/trails.js research*) ----------
// The tabs an AI app opens for one research task are one trail, "by Claude Desktop", kept apart from the user's own:
// it can be continued from the start page, its tabs tucked, and it's found from the address bar.
function researchTrailOf(g) {
  if (!g || !learningTrails() || store.getSettings().trailsResearch === false) return null;
  try {
    if (!g.trailId || !trailsDb().get(g.trailId)) g.trailId = trailsDb().research({ key: g.key, by: g.controller, sessionId: g.sessionId });
    const goal = g.sessionId && memory.nodes.get(g.sessionId)?.goal;
    if (goal) trailsDb().researchTitle(g.trailId, goal, 'goal'); // the AI's own question names its research best
    return g.trailId;
  } catch {
    return null;
  }
}

// A page an AI's tab finished loading goes into the research trail. Until the AI has asked a question or searched,
// the research is named by its clearest page: the title closest in meaning to all the others (Kilr).
function researchVisit(tab) {
  const g = tab?.groupId && groups.get(tab.groupId);
  const id = g && researchTrailOf(g);
  if (!id || !tab.view || tab.view.webContents.isDestroyed()) return;
  const wc = tab.view.webContents;
  const db = trailsDb();
  if (!db.researchPage(id, { url: wc.getURL(), title: wc.getTitle(), favicon: tab.favicon })) return;
  tab.trailId = id;
  tab.trailAt = Date.now();
  const t = db.get(id);
  if (['', 'page'].includes(t.research.titleFrom || '') && kilrOn()) {
    try {
      const titles = t.pages.slice(-12).map((p) => p.title).filter(Boolean);
      const centre = require('./kilr/embed').centroid(titles.map((x) => kilr.vec(x)));
      const best = titles.map((x) => [x, kilrCosine(kilr.vec(x), centre)]).sort((a, b) => b[1] - a[1])[0];
      if (best) db.researchTitle(id, best[0], 'page');
    } catch {}
  }
  trailsChanged();
}

// What the AI tells Skillerr about its research: its web searches and, at the end, its conclusion.
function researchNote(controller, name, args, tab) {
  if (!['web_search', 'tag_session', 'recall'].includes(name)) return;
  const g = (tab?.groupId && groups.get(tab.groupId)) || [...groups.values()].reverse().find((x) => x.controller === controller.name);
  const id = g && researchTrailOf(g);
  if (!id) return;
  const db = trailsDb();
  if (name === 'web_search' && args.query) {
    db.researchSearch(id, args.query);
    db.researchTitle(id, args.query, 'search');
  }
  if (name === 'tag_session' && args.summary) db.researchSummary(id, args.summary);
  trailsChanged();
}
const groupTabs = (id) => tabs.filter((t) => t.groupId === id);
function closeGroup(id) {
  for (const t of groupTabs(id)) closeTab(t.id);
  groups.delete(id);
}
function pruneGroups() {
  for (const id of groups.keys()) if (!groupTabs(id).length) groups.delete(id);
}

const pushTabs = () => ui('tabs', tabs.map(tabInfo));

// A tab's web view, with everything wired. Also used to wake a sleeping tab (its old view was closed to free memory).
function attachView(tab) {
  // Background tabs are throttled like Chrome's; an AI working in one lifts that while it works (see touchTab).
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: true } });
  view.setBorderRadius(RADIUS);
  view.setBackgroundColor('#ffffff');
  tab.view = view;
  const wc = view.webContents;
  wc.setVisualZoomLevelLimits(1, 4); // pinch to zoom, like Chrome
  // Pop-up blocker, like Chrome: allowed right after a click or key press, or for sites the user allowed.
  wc.on('input-event', (_e, ev) => {
    if (/^(mouseDown|mouseUp|keyDown|rawKeyDown|char|gestureTap)$/.test(ev.type)) tab.lastInput = tab.lastUsed = Date.now();
    // Fleet view: clicking anywhere on a tile opens that tab (the tile's page guard swallows the click). AI clicks don't count.
    if (ev.type === 'mouseDown' && mosaic?.includes(tab.id) && Date.now() - (wc.skillerrAiInputAt || 0) > 1000) setImmediate(() => switchTab(tab.id));
  });
  wc.setWindowOpenHandler(({ url: target }) => {
    let host = '';
    try {
      host = new URL(wc.getURL()).hostname;
    } catch {}
    if (Date.now() - tab.lastInput < 1500 || store.getSettings().popupsAllowed?.[host]) newTab(target, { opener: tab.id });
    else ui('popup-blocked', { tabId: tab.id, host, url: target });
    return { action: 'deny' };
  });
  wc.on('context-menu', (_e, params) => showPageMenu(tab, params));
  // Passkeys: when this build can't serve one (or the site wants one that isn't in Skillerr), say why and offer the
  // site's other sign-in route instead of leaving the user stuck. See setupPasskeys.
  wc.on('dom-ready', () => {
    wc.executeJavaScript(PASSKEY_WATCH_JS).catch(() => {});
    if (tab.trailPage) wc.executeJavaScriptInIsolatedWorld(TRAIL_WORLD, [{ code: TRAIL_WATCH_JS }]).catch(() => {});
    if (mosaic?.includes(tab.id)) tileGuard(tab, true);
  });
  wc.on('did-navigate', (_e, u) => passkeys === 'none' && /accounts\.google\.com\/.*\/challenge\/pk/.test(u || '') && passkeyHelp(tab));
  wc.on('console-message', (...a) => {
    const msg = typeof a[0] === 'object' && a[0]?.message !== undefined ? a[0].message : a[2];
    if (typeof msg === 'string' && msg.startsWith(TRAIL_SENTINEL)) return trailReport(tab, msg);
    if (msg === '__skillerr_passkey__' && passkeys === 'none') passkeyHelp(tab, 'unsupported');
    else if (msg === '__skillerr_passkey_failed__' && passkeys !== 'none') passkeyHelp(tab, 'failed');
  });
  wc.on('found-in-page', (_e, r) => ui('find-result', { active: r.activeMatchOrdinal, total: r.matches }));
  // The start page is drawn by the browser chrome; the first real navigation reveals the web view.
  wc.on('did-start-navigation', (e, legacyUrl, _inPlace, legacyMain) => {
    const u = e.url ?? legacyUrl;
    const isMain = e.isMainFrame ?? legacyMain;
    if (isMain && tab.isStart && u && !u.startsWith('about:')) {
      tab.isStart = false;
      tab.internal = null;
      applyVisibility();
    }
    pushTabs();
  });
  for (const ev of ['did-stop-loading', 'page-title-updated', 'did-navigate', 'did-navigate-in-page']) wc.on(ev, pushTabs);
  // History: every page the tab opens, by the user or an AI (and which).
  wc.on('did-navigate', (_e, u) => {
    try {
      tab.historyId = history.add({ url: u, title: wc.getTitle(), favicon: tab.favicon, tabId: tab.id, by: aiTab(tab) ? (groups.get(tab.groupId)?.controller || status.controller?.name || 'an AI') : null });
    } catch {}
  });
  wc.on('page-title-updated', (_e, title) => tab.historyId && history.update(tab.historyId, { title }));
  // Trails: what the user (not an AI) visits, and where they were on the page.
  wc.on('did-navigate', (_e, u) => trailNavigated(tab, u));
  // The last main-frame load that failed (bad host, offline, refused): the Audit list counts it as a failed attempt.
  wc.on('did-start-navigation', (e) => (e?.isMainFrame ?? true) && !e?.isSameDocument && (tab.loadFailed = null));
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) tab.loadFailed = { url, reason: desc ? `${desc.replace(/^ERR_/, '').replace(/_/g, ' ').toLowerCase()}` : "The page didn't load" }; // -3: aborted by a newer load
  });
  wc.on('did-navigate-in-page', (_e, u, isMain) => isMain && trailNavigated(tab, u, true));
  wc.on('did-stop-loading', () => {
    if (tab.trailPage?.pending) trailObserve(tab);
    if (tab.groupId) researchVisit(tab); // an AI's research tab: its page goes into the research trail
    if (tab.restoreScrollY) {
      const y = tab.restoreScrollY;
      tab.restoreScrollY = 0;
      wc.executeJavaScript(`scrollTo(0, ${Number(y) || 0})`).catch(() => {});
    }
  });
  // Chromium remembers zoom per site; Skillerr keeps it per tab instead (fleet tiles zoom out, the user's zoom stays theirs).
  wc.on('did-navigate', () => wc.setZoomFactor(tab.zoom || tab.userZoom || 1));
  wc.on('page-favicon-updated', (_e, favicons) => {
    tab.favicon = favicons[0];
    if (tab.historyId) history.update(tab.historyId, { favicon: favicons[0] });
    pushTabs();
  });
  win.contentView.addChildView(view);
  return view;
}

function newTab(url, { background = false, opener = null } = {}) {
  const tab = { id: nextTabId++, view: null, favicon: null, isStart: !url, userZoom: 1, lastInput: 0, lastUsed: Date.now(), openerId: opener };
  const call = aiCall.getStore(); // opened during an AI's tool call: it's that AI session's tab
  if (call) Object.assign(tab, { aiBy: call.client, aiSession: call.session });
  attachView(tab);
  const wc = tab.view.webContents;
  tabs.push(tab);
  if (background) {
    applyVisibility();
    pushTabs();
  } else switchTab(tab.id);
  wc.loadURL(url || 'about:blank').catch(() => {}); // start tabs get a blank document so tools can run in them
  return tab;
}

// Z-order: background tabs < browser chrome < active tab < HUD. Background tabs stay
// rendered at full size underneath (a hidden view collapses to 0×0), so fleet work
// in them sees a real viewport.
const isShown = (t) => (mosaic ? mosaic.includes(t.id) : t.id === activeTabId && !t.isStart);
let chromeOnTop = false; // the browser UI lifted over the page while it shows a dropdown (find by meaning)
function applyVisibility() {
  const shown = tabs.filter(isShown);
  for (const t of tabs) if (t.view && !shown.includes(t)) win.contentView.addChildView(t.view);
  if (chrome) win.contentView.addChildView(chrome);
  for (const t of shown) win.contentView.addChildView(t.view);
  if (chrome && chromeOnTop) win.contentView.addChildView(chrome);
  if (hud) win.contentView.addChildView(hud);
  if (captionView) win.contentView.addChildView(captionView);
  layout();
}

// Bookmark the page in the active tab (⌘D).
function bookmarkActive() {
  const t = activeTab();
  if (!t || t.isStart || t.internal) return { ok: false, message: 'Open a page to bookmark it.' };
  const wc = t.view.webContents;
  const bm = { title: wc.getTitle() || wc.getURL(), url: wc.getURL(), folder: 'Skillerr' };
  const list = store.readJson('bookmarks.json', []);
  if (!list.some((b) => b.url === bm.url)) store.writeJson('bookmarks.json', [bm, ...list]);
  memory.importPages([bm], 'bookmark');
  ui('bookmarks-changed');
  return { ok: true, message: `Bookmarked “${bm.title}”.` };
}

// Skillerr's own full-page views (drawn by the browser chrome, like the start page).
function openInternal(kind) {
  const existing = tabs.find((t) => t.internal === kind);
  if (existing) return switchTab(existing.id);
  const t = newTab(undefined, { background: true });
  t.internal = kind;
  switchTab(t.id);
}

// ---------- fleet view: several live tabs side by side ----------
// While a page is a fleet tile, the user's clicks on it open the tab instead of acting on the page.
// Trusted clicks only, and not the AI's own clicks (tools.js stamps those with __skillerrAiAt).
const TILE_GUARD_JS = (on) => `(() => {
  if (!window.__skillerrTileGuard) {
    window.__skillerrTileGuard = true;
    const stop = (e) => {
      if (!e.isTrusted || Date.now() - (window.__skillerrAiAt || 0) < 1500) return;
      if (window.__skillerrTile && e.type === 'mousedown') window.__skillerrSwallowUntil = Date.now() + 800;
      if (window.__skillerrTile || Date.now() < (window.__skillerrSwallowUntil || 0)) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu']) window.addEventListener(t, stop, true);
  }
  window.__skillerrTile = ${on};
  let css = document.getElementById('__skillerr-tile-css');
  if (${on} && !css) { css = document.createElement('style'); css.id = '__skillerr-tile-css'; css.textContent = '*{cursor:pointer!important}'; document.documentElement.appendChild(css); }
  if (!${on} && css) css.remove();
})()`;
function tileGuard(tab, on) {
  if (tab?.view && !tab.sleeping) tab.view.webContents.executeJavaScript(TILE_GUARD_JS(on)).catch(() => {});
}

function enterMosaic(ids) {
  const list = ids.filter((id) => getTab(id) && !getTab(id).isStart).slice(0, 9);
  for (const id of list) if (getTab(id).sleeping) wake(getTab(id)); // tiles must be live
  if (list.length < 2) return false;
  for (const id of mosaic || []) if (!list.includes(id)) tileGuard(getTab(id), false);
  mosaic = list;
  for (const id of list) tileGuard(getTab(id), true);
  if (!list.includes(activeTabId)) activeTabId = list[0];
  applyVisibility();
  pushTabs();
  return true;
}

function exitMosaic() {
  if (!mosaic) return;
  for (const id of mosaic) tileGuard(getTab(id), false);
  mosaic = null;
  for (const t of tabs) {
    if (t.zoom && t.view) {
      t.zoom = null;
      t.view.webContents.setZoomFactor(t.userZoom || 1);
    }
  }
  ui('mosaic', null);
  applyVisibility();
  pushTabs();
}

function switchTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) throw new Error(`No tab ${id}`);
  tab.lastUsed = Date.now();
  if (tab.sleeping) wake(tab);
  if (mosaic) exitMosaic();
  activeTabId = id;
  applyVisibility();
  pushTabs();
}

function closeTab(id) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) throw new Error(`No tab ${id}`);
  const [tab] = tabs.splice(i, 1);
  const trailId = tab.trailPage?.trailId || tab.trailId;
  const url = tabUrl(tab);
  trailLeave(tab);
  // Closing a tab means being done with that page: it never comes back with its trail. (Not when Skillerr is quitting:
  // then open tabs are put away in their trails, not closed.)
  if (trailId && !quitSnapshotDone && !tab.isStart && !tab.internal && !aiTab(tab) && learningTrails()) {
    try {
      if (trailsDb().closePage(trailId, url)) trailsChanged();
    } catch {}
  }
  if (!tab.isStart && !tab.internal) closedTabs.push(tab.sleeping ? tab.sleeping.url : tab.view.webContents.getURL());
  if (closedTabs.length > 25) closedTabs.shift();
  if (tab.view) win.contentView.removeChildView(tab.view);
  if (mosaic) {
    mosaic = mosaic.filter((m) => m !== id);
    if (mosaic.length < 2) exitMosaic();
  }
  pruneGroups();
  tab.view?.webContents.close();
  if (tabs.length === 0) newTab();
  else if (activeTabId === id) switchTab(tabs[Math.max(0, i - 1)].id);
  else pushTabs();
}

const activeTab = () => tabs.find((t) => t.id === activeTabId);
const closedTabs = []; // for ⇧⌘T

// ---------- screenshots ----------
// The whole scrolling page, via Chromium's own screenshot (DevTools protocol).
async function fullPage(wc) {
  const dbg = wc.debugger;
  dbg.attach('1.3');
  try {
    const m = await dbg.sendCommand('Page.getLayoutMetrics');
    const size = m.cssContentSize || m.contentSize;
    const r = await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.min(Math.ceil(size.height), 16000), scale: 1 },
    });
    return Buffer.from(r.data, 'base64');
  } finally {
    dbg.detach();
  }
}

// All of Skillerr as the user sees it, stacked from its own layers (chrome, visible tabs, HUD, captions)
// the same way they're drawn on screen. No screen-recording permission needed.
const grabs = new Map();
async function grabWindow() {
  const layers = [];
  const add = async (view) => {
    if (!view || view.webContents.isDestroyed() || (view.getVisible && !view.getVisible())) return;
    const b = view.getBounds();
    if (!b.width || !b.height) return;
    const img = await view.webContents.capturePage();
    layers.push({ x: b.x, y: b.y, w: b.width, h: b.height, data: img.toPNG().toString('base64') });
  };
  await add(chrome);
  for (const t of tabs.filter(isShown)) await add(t.view);
  await add(hud);
  await add(captionView);
  const [w, h] = win.getContentSize();
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const timer = setTimeout(() => {
      grabs.delete(id);
      reject(new Error('Couldn’t capture the window.'));
    }, 8000);
    grabs.set(id, (data, err) => {
      clearTimeout(timer);
      grabs.delete(id);
      if (err) reject(new Error(err));
      else resolve(Buffer.from(data, 'base64'));
    });
    ui('compose-window', { id, width: w, height: h, layers });
  });
}
function grabWindowLive() {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const timer = setTimeout(() => {
      grabs.delete(id);
      reject(new Error('Couldn’t capture the window.'));
    }, 8000);
    grabs.set(id, (data, err) => {
      clearTimeout(timer);
      grabs.delete(id);
      if (err) reject(new Error(err));
      else resolve(Buffer.from(data, 'base64'));
    });
    const [w, h] = win.getContentSize();
    ui('grab-window', { id, sourceId: win.getMediaSourceId(), width: w, height: h });
  });
}

// ---------- passkeys ----------
// macOS: Touch ID passkeys stored in Skillerr's keychain group, for any site (app.configureWebAuthn). Needs a Developer ID
// build with APPLE_TEAM_ID (docs/passkeys.md); iCloud Keychain passkeys saved by Safari or Chrome aren't reachable from an
// Electron app for arbitrary sites. Windows: Chromium hands WebAuthn to Windows Hello, which brings its own UI.
// Linux, or an unsigned Mac build: no platform authenticator, so offer the site's other sign-in route instead.
let passkeys = 'none'; // 'touchid' | 'windows' | 'none'
function setupPasskeys(ses) {
  if (process.platform === 'win32') passkeys = 'windows';
  const group = appMeta().skillerrKeychainGroup;
  if (process.platform === 'darwin' && group && typeof app.configureWebAuthn === 'function') {
    try {
      app.configureWebAuthn({ touchID: { keychainAccessGroup: group, promptReason: 'sign in to $1' } });
      passkeys = 'touchid';
    } catch {}
  }
  // Several passkeys for one site: let the user pick, like Chrome's account chooser.
  ses.on('select-webauthn-account', async (_e, details, callback) => {
    let chosen;
    try {
      const names = details.accounts.map((a) => a.displayName || a.name || 'Passkey');
      const { response } = await dialog.showMessageBox(win, {
        type: 'question', message: `Sign in to ${details.relyingPartyId} with which passkey?`, buttons: [...names, 'Cancel'], cancelId: names.length,
      });
      chosen = details.accounts[response]?.credentialId;
    } finally {
      callback(chosen);
    }
  });
}
const PASSKEY_WATCH_JS = `(() => {
  if (window.__skPk || !navigator.credentials) return;
  window.__skPk = 1;
  const c = navigator.credentials;
  for (const k of ['get', 'create']) {
    const orig = c[k].bind(c);
    c[k] = (o) => {
      if (!o || !o.publicKey) return orig(o);
      console.info('__skillerr_passkey__');
      return orig(o).catch((err) => { if (err && err.name === 'NotAllowedError') console.info('__skillerr_passkey_failed__'); throw err; });
    };
  }
})()`;
// reason: 'unsupported' (no authenticator here) or 'failed' (the passkey the site wanted isn't in Skillerr).
function passkeyHelp(tab, reason = 'unsupported') {
  if (tab.passkeyShownFor === tab.view.webContents.getURL() + reason) return;
  tab.passkeyShownFor = tab.view.webContents.getURL() + reason;
  let host = '';
  try {
    host = new URL(tab.view.webContents.getURL()).hostname;
  } catch {}
  ui('passkey-help', { tabId: tab.id, host, reason, platform: process.platform });
}

// ---------- staying light: sleeping tabs ----------
// Tabs nobody is looking at and no AI is using unload their page (like Chrome's Memory Saver, but sooner).
// What an AI read is already in research memory, so nothing is lost; the tab wakes when touched.
const SLEEP_AFTER_MS = 4 * 60 * 1000; // a background tab you haven't touched in 4 minutes
const AI_SLEEP_AFTER_MS = 60 * 1000; // a tab an AI finished with, a minute after its last action
const MAX_AWAKE = 5; // beyond this many background tabs (not counting what's on screen), the least recently used ones sleep
function canSleep(t) {
  return !!t.view && !t.sleeping && !t.isStart && !t.internal && t.id !== activeTabId && !(mosaic && mosaic.includes(t.id)) &&
    !(recorder && recorder.isRecording(t)) && (t.aiUntil || 0) < Date.now() - 10000 && !t.view.webContents.isDestroyed() &&
    !t.view.webContents.isCurrentlyAudible() && !t.view.webContents.getURL().startsWith('about:');
}
function sleepTab(t) {
  const view = t.view;
  const wc = view.webContents;
  t.sleeping = { url: wc.getURL(), title: wc.getTitle() || wc.getURL(), favicon: t.favicon };
  t.restoreScrollY = t.trailState?.y || 0; // back where the user was when it wakes
  trailLeave(t);
  win.contentView.removeChildView(view);
  t.view = null;
  wc.close(); // frees the page's process; the tab keeps its title, icon and address
}
function wake(t) {
  if (!t?.sleeping) return null;
  const { url } = t.sleeping;
  t.sleeping = null;
  attachView(t);
  applyVisibility();
  const wc = t.view.webContents;
  t.waking = new Promise((resolve) => {
    const done = () => {
      wc.removeListener('did-stop-loading', done);
      t.waking = null;
      resolve();
    };
    wc.on('did-stop-loading', done);
    setTimeout(done, 15000);
  });
  wc.loadURL(url).catch(() => {});
  pushTabs();
  return t.waking;
}
function sleepIdleTabs() {
  if (store.getSettings().sleepTabs === false) return;
  const now = Date.now();
  let changed = false;
  for (const t of tabs) {
    if (!canSleep(t)) continue;
    const idle = now - Math.max(t.lastUsed || 0, t.aiUntil || 0);
    if (idle > (t.groupId ? AI_SLEEP_AFTER_MS : SLEEP_AFTER_MS)) {
      sleepTab(t);
      changed = true;
    }
  }
  const awake = tabs.filter(canSleep).sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
  while (awake.length > MAX_AWAKE) {
    sleepTab(awake.shift());
    changed = true;
  }
  if (changed) pushTabs();
}
setInterval(sleepIdleTabs, 20000);

// ---------- trails: the user's own ongoing work (src/trails.js) ----------
// Pages the user visits are filed into trails, one journey each. Nothing is tucked while they work: when Skillerr quits,
// the tabs still open wait in their trails (with where they were), on the shelf next to the address bar, and come back
// with Continue. Only what the user does: pages an AI opens or drives are research memory's, not trails'.
let trailStore = null;
const trailsDb = () => trailStore || (trailStore = new Trails(path.join(store.DIR, 'trails'), { meaning: kilrOn() ? kilrMeaning : null }));
// What Trails asks Kilr: how close a page is to a trail, and which trails a search means.
const kilrMeaning = {
  affinity: (page, t) => kilr.pageAffinity(page, t),
  rank: (q, list) => kilr.rankTrails(q, list).map((x) => x.trail),
};
const learningTrails = () => store.getSettings().trails !== false;
const TRAIL_WORLD = 7701; // the page's own scripts can't see or fake-silence the watcher in this isolated world
const TRAIL_SENTINEL = '__skillerr_trail__';
// Watches how far the page was read, whether a form was typed into and not sent, and how much of a video was watched.
// Reports only those facts, never what was typed.
const TRAIL_WATCH_JS = `(() => {
  if (window.__skillerrTrail) return;
  const st = { scroll: 0, y: 0, long: false, form: undefined, video: undefined, videoLong: false };
  let last = '', timer = 0;
  const send = () => { const s = JSON.stringify(st); if (s !== last) { last = s; console.debug('${TRAIL_SENTINEL}' + s); } };
  const soon = () => { if (!timer) timer = setTimeout(() => { timer = 0; send(); }, 1500); };
  const measure = () => {
    const el = document.scrollingElement || document.documentElement;
    const room = el.scrollHeight - innerHeight;
    st.y = Math.round(scrollY);
    st.long = el.scrollHeight > innerHeight * 2.5 && (!!document.querySelector('article') || document.querySelectorAll('p').length >= 8);
    if (room > 0) st.scroll = Math.max(st.scroll, Math.min(1, scrollY / room));
  };
  window.__skillerrTrail = { reset: () => { st.scroll = 0; st.y = 0; st.form = undefined; st.video = undefined; measure(); send(); } };
  addEventListener('scroll', () => { measure(); soon(); }, { passive: true, capture: true });
  const field = (t) => t && t.isContentEditable === false && t.closest && t.closest('form') && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) &&
    !/^(password|search|hidden|submit|button|checkbox|radio)$/i.test(t.type || '') && !/(search|^q$|query)/i.test((t.name || '') + ' ' + (t.getAttribute('role') || ''));
  addEventListener('input', (e) => { if (e.isTrusted && field(e.target) && st.form !== true) { st.form = true; send(); } }, true);
  addEventListener('submit', () => { if (st.form) { st.form = false; send(); } }, true);
  addEventListener('timeupdate', (e) => {
    const v = e.target;
    if (!(v instanceof HTMLMediaElement) || !(v.duration > 60) || !isFinite(v.duration)) return;
    st.video = Math.round((v.currentTime / v.duration) * 100) / 100;
    st.videoLong = v.duration > 180;
    soon();
  }, true);
  addEventListener('pagehide', send);
  document.addEventListener('visibilitychange', () => document.hidden && send());
  measure();
  send();
})()`;
const TRAIL_FACTS_JS = `(() => ({
  h1: (document.querySelector('h1')?.innerText || '').slice(0, 200),
  desc: (document.querySelector('meta[name=description], meta[property="og:description"]')?.content || '').slice(0, 300),
  sensitive: ${SENSITIVE_PAGE_JS},
}))()`;

// A tab an AI is using isn't the user's browsing.
const aiTab = (tab) => !!tab.groupId || (tab.aiUntil || 0) > Date.now();

function trailNavigated(tab, url, inPage = false) {
  if (inPage && tab.trailPage && pageKey(tab.trailPage.url) === pageKey(url)) return; // a jump within the page
  trailLeave(tab);
  tab.trailState = null;
  clearTimeout(tab.trailTimer);
  if (!learningTrails() || tab.isStart || tab.internal || aiTab(tab) || !/^https?:/.test(url || '')) return;
  tab.trailPage = { url, at: Date.now(), pending: true, typed: Date.now() - (tab.typedAt || 0) < 8000 };
  if (inPage) {
    tab.view?.webContents.executeJavaScriptInIsolatedWorld(TRAIL_WORLD, [{ code: 'window.__skillerrTrail?.reset()' }]).catch(() => {});
    tab.trailTimer = setTimeout(() => trailObserve(tab), 1500); // single-page apps set the title a moment later
  } else tab.trailTimer = setTimeout(() => trailObserve(tab), 8000); // or when it finishes loading, whichever is first
}

async function trailObserve(tab) {
  const page = tab.trailPage;
  if (!page?.pending || !tab.view || tab.view.webContents.isDestroyed()) return;
  page.pending = false;
  clearTimeout(tab.trailTimer);
  const wc = tab.view.webContents;
  const facts = await wc.executeJavaScriptInIsolatedWorld(TRAIL_WORLD, [{ code: TRAIL_FACTS_JS }]).catch(() => ({ sensitive: true }));
  if (tab.trailPage !== page) return; // moved on meanwhile
  try {
    const opener = !tab.trailId && tab.openerId ? getTab(tab.openerId)?.trailId : null;
    const id = trailsDb().observe({ url: page.url, title: wc.getTitle(), favicon: tab.favicon, ...facts },
      { tabTrail: tab.trailId, tabAt: tab.trailAt, openerTrail: opener, typed: page.typed });
    page.trailId = id;
    if (id && kilrOn()) kilrDid(`Filed “${trunc(wc.getTitle() || page.url, 60)}” into “${trunc(trailsDb().get(id)?.title || 'a trail', 40)}”`);
    if (id) {
      tab.trailId = id;
      tab.trailAt = Date.now();
    }
    trailsChanged();
  } catch {} // trails must never break browsing
}

// Leaving a page: note what was left unfinished on it.
function trailLeave(tab) {
  const page = tab.trailPage;
  tab.trailPage = null;
  if (!page?.trailId) return;
  try {
    trailsDb().leave(page.trailId, page.url, { ...(tab.trailState || {}), scrollY: tab.trailState?.y, dwellMs: Date.now() - page.at });
  } catch {}
}

function trailReport(tab, msg) {
  if (msg.length > 400) return;
  try {
    const st = JSON.parse(msg.slice(TRAIL_SENTINEL.length));
    tab.trailState = { scroll: +st.scroll || 0, y: +st.y || 0, long: !!st.long, form: typeof st.form === 'boolean' ? st.form : undefined,
      video: st.video == null ? undefined : +st.video, videoLong: !!st.videoLong };
  } catch {}
}

let trailsTimer = null;
let lastShelf = '';
// The trail shelf between reload and the address bar: journeys waiting, by their tabs' icons.
function pushShelf() {
  const shelf = learningTrails() ? trailsDb().shelf() : { trails: [], more: 0 };
  const json = JSON.stringify(shelf);
  if (json === lastShelf) return;
  lastShelf = json;
  ui('trails-shelf', shelf);
}
function trailsChanged() {
  try {
    pushShelf();
  } catch {}
  if (trailsTimer) return;
  trailsTimer = setTimeout(() => {
    trailsTimer = null;
    ui('trails-changed');
  }, 1500);
}

// The trail an open tab belongs to, filing it now if it never was (open before trails learned, or a routine site).
function trailForTab(t) {
  const url = t.sleeping ? t.sleeping.url : t.view.webContents.getURL();
  const db = trailsDb();
  const research = t.groupId && researchTrailOf(groups.get(t.groupId)); // an AI's tab belongs to its research, never to the user's trails
  if (research) return research;
  if (t.trailId && db.get(t.trailId)) return t.trailId;
  return db.trailOfUrl(url) || db.observe({ url, title: t.sleeping ? t.sleeping.title : t.view.webContents.getTitle(), favicon: t.favicon }) || db.loose();
}

const tabUrl = (t) => (t.sleeping ? t.sleeping.url : t.view && !t.view.webContents.isDestroyed() ? t.view.webContents.getURL() : '');
const userTabs = () => tabs.filter((t) => !t.isStart && !t.internal && /^https?:/.test(tabUrl(t)));

// A tab that loads only when opened: reopening a trail's twenty tabs costs nothing until you click one.
function sleepingTab({ url, title, favicon, scrollY = 0, trailId = null }) {
  const tab = { id: nextTabId++, view: null, favicon: favicon || null, isStart: false, userZoom: 1, lastInput: 0, lastUsed: Date.now(),
    sleeping: { url, title: title || url, favicon: favicon || null }, restoreScrollY: scrollY, trailId, trailAt: Date.now() };
  tabs.push(tab);
  return tab;
}

// Bring tucked tabs back; switch to the one the user was on (or the newest). Pages already open aren't opened twice.
function reopenTucked(entries, trailId) {
  const open = new Map(userTabs().map((t) => [pageKey(tabUrl(t)), t]));
  let focus = null;
  for (const e of entries) {
    const t = open.get(pageKey(e.url)) || sleepingTab({ ...e, trailId: trailId || e.trailId });
    open.set(pageKey(e.url), t);
    if (!focus || e.active) focus = t;
  }
  if (focus) {
    const start = activeTab()?.isStart ? activeTab() : null;
    switchTab(focus.id);
    if (start && tabs.length > 1) closeTab(start.id); // the new-tab page it was reopened from
  } else pushTabs();
  trailsChanged();
  return entries.length;
}

// One tucked tab back, from the shelf or a trail card.
function reopenTuckedTab(id, url) {
  const back = trailsDb().untuck(id, (x) => x.url === url);
  return back.length ? reopenTucked(back, id) : 0;
}

// ---------- moving over from Chrome: its open tabs, sorted into trails ----------
// All the tabs are grouped at once (average-linkage clustering on the Orb's meaning plus shared keywords; settings
// chosen on scripts/kilr/eval-trails.js), then each group is filed as one trail, joining an existing trail when it's
// about the same thing. They all wait on the shelf, like the tabs of a last session: the tab strip stays clean, and
// Continue brings a journey back. Nothing is closed in Chrome.
const IMPORT_CLUSTER = { threshold: 0.2, wordBonus: 0.1 };
function importChromeTabs(profile) {
  const db = trailsDb();
  const seen = new Set(userTabs().map((t) => pageKey(tabUrl(t))));
  const list = [];
  for (const t of chrome_.openTabs(profile)) {
    const key = pageKey(t.url);
    if (seen.has(key) || !db.tuckable(t.url)) continue;
    seen.add(key);
    list.push({ ...t, title: t.title || t.url });
  }
  const { pageWords, cleanTitle } = require('./trails');
  const vecs = list.map((t) => (kilrOn() ? kilr.vec(cleanTitle(t.title)) : null)); // without the site's name, as Trails compares titles
  const words = list.map((t) => new Set(pageWords({ url: t.url, title: t.title })));
  const sim = (i, j) => {
    const shared = [...words[i]].filter((w) => words[j].has(w)).length;
    return (vecs[i] && vecs[j] ? kilrCosine(vecs[i], vecs[j]) : 0) + IMPORT_CLUSTER.wordBonus * Math.min(shared, 2);
  };
  const groupsOfTabs = require('./trails').clusterItems(list.length, sim, { threshold: IMPORT_CLUSTER.threshold });
  const at = Date.now();
  const tucked = new Map(); // trail id → tabs
  for (const g of groupsOfTabs) {
    let trailId = null;
    for (const i of g) {
      const t = list[i];
      trailId = db.observe({ url: t.url, title: t.title }, trailId ? { tabTrail: trailId, tabAt: at } : { typed: true }) || trailId || db.loose();
      (tucked.get(trailId) || tucked.set(trailId, []).get(trailId)).push({ url: t.url, title: t.title });
    }
  }
  for (const [trailId, tabsOf] of tucked) db.tuck(trailId, tabsOf, 'chrome');
  trailsChanged();
  kilrDid(`Sorted ${list.length} tabs from Chrome into ${tucked.size} trails`);
  return { count: list.length, open: 0, trails: tucked.size };
}

// "Continue": the tabs the trail was put away with come back up to the tab strip, scrolled where the user was. Pages
// the user closed are done with and don't come back.
function continueTrail(id) {
  const db = trailsDb();
  const t = db.detail(id);
  if (!t) throw new Error(`No trail ${id}.`);
  const tucked = db.untuck(id);
  return { opened: tucked.length ? reopenTucked(tucked, id) : 0, title: t.title };
}

// Quitting keeps every open tab in its trail, so "pick up where you left off" also brings back the last session.
let quitSnapshotDone = false;
function snapshotForQuit() {
  if (quitSnapshotDone || !learningTrails()) return;
  quitSnapshotDone = true;
  try {
    const db = trailsDb();
    const list = userTabs();
    if (!list.length) return;
    const at = db.markQuit();
    for (const t of list) {
      trailLeave(t);
      const title = t.sleeping ? t.sleeping.title : t.view.webContents.getTitle();
      db.tuck(trailForTab(t), [{ url: tabUrl(t), title, favicon: t.favicon, scrollY: t.sleeping ? t.restoreScrollY : t.trailState?.y, active: t.id === activeTabId }], 'quit', at);
    }
    db.save();
  } catch {}
}

function restoreLastSession() {
  const db = trailsDb();
  const at = db.data.quitAt;
  const back = [];
  for (const { trail } of db.lastSession()) back.push(...db.untuck(trail.id, (x) => x.why === 'quit' && x.at === at).map((e) => ({ ...e, trailId: trail.id })));
  db.markQuit(0);
  return reopenTucked(back);
}

function trailsHome() {
  const s = store.getSettings();
  if (s.trails === false) return { enabled: false, intro: false, trails: [], session: null };
  const db = trailsDb();
  const session = db.lastSession();
  // Pick up where you left off: journeys with tabs still waiting. Ones whose pages were all closed are finished.
  const all = db.list().filter((t) => t.tucked > 0);
  return {
    enabled: true,
    intro: !s.trailsIntroSeen,
    session: session.length ? { tabs: session.reduce((n, x) => n + x.tabs.length, 0), trails: session.length, at: db.data.quitAt } : null,
    trails: all.slice(0, 3),
    total: all.length,
    // Kilr's one line about where you were, built from the facts of the top trail.
    kilr: s.kilr !== false && all[0] ? kilrLine(all[0]) : null,
    // Kilr offering to learn (setting "suggest"), or what it just learned.
    learn: s.kilrLearn === 'suggest' ? learnDue() : null,
    learning: !!learning,
    learned: s.kilrLastLearn && Date.now() - s.kilrLastLearn.at < 864e5 && !s.kilrLastLearn.seen ? s.kilrLastLearn : null,
    // A skill Kilr noticed the user could keep (the first one; the Kilr screen lists them all).
    skill: (() => {
      try {
        return kilrSuggestions()[0] || null;
      } catch {
        return null;
      }
    })(),
  };
}

function kilrLine(summary) {
  try {
    return { text: require('./kilr').describe(summary), trailId: summary.id };
  } catch {
    return null;
  }
}

// "What was I doing about the visa?": the trail it's about, and the facts of it.
function askKilr(query) {
  const db = trailsDb();
  const shown = db.trails.filter((t) => t.state === 'active' && db.worth(t));
  const summaries = db.list({ limit: 300 });
  return kilr.answer(String(query || ''), summaries, shown);
}

// ---------- Kilr learns from the user's trails (src/kilr/train.js) ----------
// Weekly by default, Kilr offers to learn the user's own words from their trails (or does it on its own when the
// computer is idle, if they chose that). Training runs in a worker thread with a hard memory cap, so it never touches
// browsing and fits 4 GB machines; the trail texts live only in that thread and are gone when it ends.
const LEARN_EVERY = { daily: 1, weekly: 7, monthly: 30 };
const LEARN_MIN_NEW_PAGES = 20;
let learning = null;

// Is it time to learn? Returns { newPages } or null.
// Where Kilr learns from: the user's own browsing, their AI apps' research, or both (Trails > Settings).
const learnSources = (s = store.getSettings()) => ({ you: s.kilrLearnFromYou !== false, ai: s.kilrLearnFromAi !== false });
function learnDue() {
  const s = store.getSettings();
  const from = learnSources(s);
  if (s.kilr === false || s.trails === false || s.kilrLearn === 'off' || learning || (!from.you && !from.ai)) return null;
  const now = Date.now();
  if (now < (s.kilrSnoozedUntil || 0) || now - (s.kilrLearnedAt || 0) < (LEARN_EVERY[s.kilrLearnEvery] || 7) * 864e5) return null;
  const db = trailsDb();
  const newPages = db.newPagesSince(s.kilrLearnedAt || 0, from);
  if (newPages < LEARN_MIN_NEW_PAGES) return null;
  if (db.trainingSet(from).filter((t) => t.texts.length >= 4).length < 3) return null; // too little to learn from yet
  return { newPages, you: db.newPagesSince(s.kilrLearnedAt || 0, { you: from.you, ai: false }), ai: db.newPagesSince(s.kilrLearnedAt || 0, { you: false, ai: from.ai }) };
}

function kilrLearn({ auto = false } = {}) {
  if (learning) return learning;
  const trails = trailsDb().trainingSet(learnSources());
  // What it learned from, for the user to see: pages and searches of their own, and of their AI apps' research.
  const sources = { you: 0, ai: 0 };
  for (const t of trails) sources[t.source] += t.texts.length;
  learning = new Promise((resolve) => {
    const { Worker } = require('worker_threads');
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      const s = store.getSettings();
      const saved = { at: Date.now(), auto, accepted: !!result.accepted, report: result.report || null, error: result.error || null, sources };
      store.saveSettings({ ...s, kilrLearnedAt: result.error ? s.kilrLearnedAt : Date.now(), kilrLastLearn: saved });
      ui('kilr-learned', saved);
      kilrDid(saved.error ? 'Couldn\'t learn this time' : saved.accepted ? `Learned ${saved.report?.pieces || 0} words from ${saved.sources.you} of your pages and ${saved.sources.ai} from your AIs' research`
        : `Checked ${(saved.sources.you || 0) + (saved.sources.ai || 0)} pages: nothing better to learn yet`);
      trailsChanged();
      resolve(saved);
    };
    let w;
    try {
      w = new Worker(path.join(__dirname, 'kilr', 'train-worker.js'), {
        workerData: { dir: KILR_DIR, trails },
        resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 },
      });
    } catch (err) {
      return finish({ error: err.message });
    }
    w.on('message', (m) => {
      if (m.progress != null) ui('kilr-learning', { progress: m.progress });
      if (!m.done) return;
      if (m.accepted && m.file) {
        try {
          fs.mkdirSync(path.dirname(KILR_PERSONAL), { recursive: true, mode: 0o700 });
          fs.writeFileSync(KILR_PERSONAL + '.tmp', Buffer.from(m.file), { mode: 0o600 });
          fs.renameSync(KILR_PERSONAL + '.tmp', KILR_PERSONAL);
          kilr.reload();
        } catch (err) {
          m.error = err.message;
          m.accepted = false;
        }
      }
      finish(m);
      w.terminate();
    });
    w.on('error', (err) => finish({ error: err.message }));
    w.on('exit', (code) => finish({ error: `stopped (${code})` }));
  }).finally(() => (learning = null));
  ui('kilr-learning', { progress: 0 });
  return learning;
}

function kilrForget() {
  fs.rmSync(KILR_PERSONAL, { force: true });
  kilr.reload();
  store.saveSettings({ ...store.getSettings(), kilrLastLearn: null });
  trailsChanged();
}

// Every half hour: learn on its own if the user chose that and the computer is idle, or let the start page offer it.
setInterval(() => {
  try {
    if (!learnDue()) return;
    const { powerMonitor } = require('electron');
    if (store.getSettings().kilrLearn === 'auto' && powerMonitor.getSystemIdleTime() >= 120) kilrLearn({ auto: true });
    else trailsChanged();
  } catch {}
}, 30 * 60 * 1000);

// ---------- find anything by meaning (the address bar) ----------
// What the user remembers ("that chair review", "the visa form"), matched by words and by Kilr's sense of meaning
// against open tabs, tabs tucked into trails, and pages in trails. A few milliseconds; nothing leaves the computer.
// Words of 3+ letters, matched where a word starts ("tok" finds "Tokyo", "re" finds nothing inside "middleware").
const jumpWords = (q) => String(q || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
const startsWord = (hay, w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(hay);
function jumpSearch(query) {
  const q = String(query || '').trim();
  if (q.length < 2 || !learningTrails()) return [];
  const words = jumpWords(q);
  const useMeaning = kilrOn() && q.split(/\s+/).length <= 12;
  const db = trailsDb();
  const seen = new Set();
  const cands = [];
  const add = (c) => {
    const key = pageKey(c.url);
    if (!/^https?:/.test(c.url) || seen.has(key)) return;
    seen.add(key);
    cands.push(c);
  };
  for (const t of userTabs()) {
    add({ kind: 'tab', tabId: t.id, url: tabUrl(t), title: t.sleeping ? t.sleeping.title : t.view.webContents.getTitle(), favicon: t.favicon,
      trailId: t.trailId || null, at: t.lastUsed || 0 });
  }
  const cutoff = Date.now() - 90 * 864e5;
  for (const tr of db.trails) {
    if (tr.state !== 'active' && tr.state !== 'done') continue;
    for (const x of tr.tucked) add({ kind: 'tucked', url: x.url, title: x.title, favicon: x.favicon, trailId: tr.id, at: x.at });
    for (const p of tr.pages) if (p.lastAt > cutoff) add({ kind: 'page', url: p.url, title: p.title, favicon: p.favicon, trailId: tr.id, at: p.lastAt, scrollY: p.scrollY || 0 });
  }
  const qv = useMeaning ? kilr.vec(q) : null;
  const scored = [];
  for (const c of cands) {
    const hay = `${c.title} ${c.url}`.toLowerCase();
    const hit = words.filter((w) => startsWord(hay, w)).length;
    const wordScore = words.length ? (hit === words.length ? 0.9 : 0.55 * (hit / words.length)) : 0;
    let meaning = 0;
    if (qv) {
      const cos = kilrCosine(qv, kilr.vec(c.title));
      meaning = cos >= 0.45 ? Math.min(0.85, 0.35 + cos) : 0; // single titles are noisy: only clear matches count
    }
    const score = Math.max(wordScore, meaning) + (c.kind === 'tab' ? 0.08 : c.kind === 'tucked' ? 0.05 : 0) + 0.04 * Math.pow(0.5, (Date.now() - c.at) / (7 * 864e5));
    if (Math.max(wordScore, meaning) >= 0.5) scored.push({ ...c, score, why: wordScore >= meaning ? 'words' : 'meaning' });
  }
  scored.sort((a, b) => b.score - a.score);
  if (q.length >= 3) {
    const what = `Searched ${cands.length} pages for “${trunc(q, 40)}”: ${Math.min(6, scored.length)} found`;
    if (kilrLog[0]?.what.startsWith('Searched ') && Date.now() - kilrLog[0].at < 4000) kilrLog[0] = { at: Date.now(), what }; // one entry per search, not per keystroke
    else kilrDid(what);
  }
  return scored.slice(0, 6).map((c) => ({ ...c, trail: c.trailId ? db.get(c.trailId)?.title || null : null }));
}

function jumpOpen(c) {
  if (c.kind === 'tab' && getTab(c.tabId)) return switchTab(c.tabId);
  const open = userTabs().find((t) => pageKey(tabUrl(t)) === pageKey(c.url));
  if (open) return switchTab(open.id);
  if (c.kind === 'tucked' && reopenTuckedTab(c.trailId, c.url)) return;
  const t = activeTab();
  if (t?.isStart) {
    t.trailId = c.trailId || t.trailId;
    t.trailAt = Date.now();
    t.restoreScrollY = c.scrollY || 0;
    t.view.webContents.loadURL(c.url).catch(() => {});
  } else {
    const nt = newTab(c.url);
    nt.trailId = c.trailId || null;
    nt.trailAt = Date.now();
    nt.restoreScrollY = c.scrollY || 0;
  }
}

// ---------- Kilr's status, for its screen ----------
function kilrStatus() {
  const s = store.getSettings();
  const base = kilr._base || null; // loaded only once something needed it
  const modelFile = path.join(KILR_DIR, 'kilr-embed.bin');
  let personal = { exists: false, sizeKB: 0, words: 0 };
  try {
    const st = fs.statSync(KILR_PERSONAL);
    const fd = fs.openSync(KILR_PERSONAL, 'r');
    const head = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 8, 0);
    fs.closeSync(fd);
    personal = { exists: true, sizeKB: Math.round(st.size / 1024), words: head.readUInt32LE(4), updatedAt: st.mtimeMs };
  } catch {}
  const D = base?.D || 256;
  const V = base?.V || 30522;
  const tableMB = (V * D + V * 4) / 1e6;
  const recallVectors = embedder._vectors?.size || 0;
  const memoryMB = base ? tableMB * (kilr.personal ? 2 : 1) + (kilr.cache.size * D * 4) / 1e6 + (recallVectors * D * 4) / 1e6 : 0;
  const db = trailStore;
  return {
    on: s.kilr !== false,
    model: { file: 'kilr-embed.bin', sizeMB: +(fs.statSync(modelFile).size / 1e6).toFixed(1), words: V, dims: D, loaded: !!base, loadMs: kilr.stats.loadMs },
    personal: { ...personal, last: s.kilrLastLearn || null },
    memoryMB: +memoryMB.toFixed(1),
    texts: kilr.stats.texts,
    avgMicros: kilr.stats.texts ? Math.round(kilr.stats.micros / kilr.stats.texts) : null,
    recallVectors,
    trails: db ? { you: db.trails.filter((t) => !t.loose && !t.research && db.worth(t)).length, ai: db.trails.filter((t) => t.research && db.worth(t)).length } : { you: 0, ai: 0 },
    learning: { mode: s.kilrLearn, every: s.kilrLearnEvery, fromYou: s.kilrLearnFromYou !== false, fromAi: s.kilrLearnFromAi !== false, running: !!learning, due: learnDue() },
    runsOn: { gpu: false, network: false, where: 'this computer' },
    log: kilrLog.slice(0, 30),
  };
}

// ---------- Skills Kilr suggests (src/kilr/suggest.js) ----------
// From the user's own trails and their AI apps' research trails (as chosen under what Kilr learns from). A suggestion
// the user put off comes back only once the habit has doubled; a saved one comes back as an update after two more trails.
const kilrSuggested = new Set();
function kilrSuggestions() {
  const s = store.getSettings();
  if (s.kilr === false || s.kilrSkills === false || !learningTrails()) return [];
  const db = trailsDb();
  const found = require('./kilr/suggest').suggestSkills(db.forSkills({ you: s.kilrLearnFromYou !== false, ai: s.kilrLearnFromAi !== false }), { everyday: (h) => db.everyday(h) });
  const out = [];
  for (const x of found) {
    const put = (s.kilrSkillsDismissed || {})[x.id];
    const saved = (s.kilrSkillsSaved || {})[x.id];
    if (put && x.count < put * 2) continue;
    if (saved && x.count < saved + 2) continue;
    const mine = skills.get(x.slug);
    if (mine && mine.trust?.state !== 'learned') continue; // the user's own skill of that name wins
    if (!kilrSuggested.has(x.id)) {
      kilrSuggested.add(x.id);
      kilrDid(`Noticed a habit: ${x.title.toLowerCase()} (${x.count} trails)`);
    }
    out.push({ ...x, update: !!saved, preview: require('./kilr/suggest').skillMarkdown(x) });
  }
  return out;
}

function kilrSaveSuggestion(id) {
  const x = kilrSuggestions().find((y) => y.id === id);
  if (!x) return { ok: false, message: 'That suggestion is gone.' };
  try {
    const r = skills.learn({ name: x.slug, description: x.description, instructions: x.instructions, topics: x.topics, by: 'Skillerr Orb' });
    const s = store.getSettings();
    store.saveSettings({ ...s, kilrSkillsSaved: { ...(s.kilrSkillsSaved || {}), [id]: x.count } });
    if (s.shareSkillsWithClaudeCode) skills.shareWithClaudeCode();
    kilrDid(`Saved the skill “${x.slug}”`);
    trailsChanged();
    return { ok: true, name: r.skill.name, file: r.file, updated: r.updated };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

function kilrDismissSuggestion(id) {
  const x = kilrSuggestions().find((y) => y.id === id);
  const s = store.getSettings();
  store.saveSettings({ ...s, kilrSkillsDismissed: { ...(s.kilrSkillsDismissed || {}), [id]: x ? x.count : 1 } });
  trailsChanged();
}

// For AI apps (my_trails), in plain words.
function trailsText({ query = '', trail_id: id = '' } = {}) {
  const db = trailsDb();
  const ago = (t) => { const h = (Date.now() - t) / 3600000; return h < 1 ? 'just now' : h < 24 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`; };
  const what = { form: 'a form typed into but not sent', read: 'read partway', cart: 'a cart not checked out', watch: 'a video watched partway' };
  const unfinished = (u) => `${what[u.kind] || u.kind}${u.pct ? ` (${u.pct}%)` : ''}: ${u.title} — ${u.url}`;
  if (id) {
    const t = db.detail(String(id));
    if (!t) throw new Error(`No trail ${id}. Call my_trails to list them.`);
    return [`Trail “${t.title}” (${t.id}) — ${t.state}, last active ${ago(t.lastAt)}, ${t.sessions} session${t.sessions === 1 ? '' : 's'} over ${t.days} day${t.days === 1 ? '' : 's'}`,
      t.searches.length ? `Searches: ${t.searches.join(' · ')}` : '',
      t.unfinished.length ? `Unfinished:\n${t.unfinished.map((u) => `- ${unfinished(u)}`).join('\n')}` : '',
      t.tuckedTabs.length ? `Tabs waiting (open when the user last quit; Continue brings them back):\n${t.tuckedTabs.map((x) => `- ${x.title} — ${x.url}`).join('\n')}` : '',
      `Pages, newest first:\n${t.pages.slice(0, 40).map((p) => `- ${p.title} — ${p.url} (${p.visits} visit${p.visits === 1 ? '' : 's'}, last ${ago(p.lastAt)})`).join('\n')}`,
    ].filter(Boolean).join('\n\n');
  }
  const list = db.list({ query: String(query || ''), limit: 12 });
  if (!list.length) return query ? `No trails match “${query}”.` : 'No trails yet: the user hasn\'t browsed enough in Skillerr for any to form.';
  return ['The user\'s trails: their own ongoing work in Skillerr, most relevant first. Pass trail_id to my_trails for a trail\'s pages; continue_trail reopens one for the user.', '',
    ...list.map((t, i) => [`${i + 1}. ${t.title} (trail_id ${t.id})${t.by ? ` — research by ${t.by}${t.researchSummary ? `: ${t.researchSummary}` : ''}` : ''} — last active ${ago(t.lastAt)}, ${t.pageCount} pages${t.sessions > 1 ? `, came back ${t.sessions - 1} time${t.sessions === 2 ? '' : 's'}` : ''}${t.tucked ? `, ${t.tucked} tabs waiting` : ''}, ${Math.round((t.progress || 0) * 100)}% through`,
      t.stoppedAt ? `   Stopped at: ${t.stoppedAt.title} — ${t.stoppedAt.url}` : '',
      ...t.unfinished.slice(0, 3).map((u) => `   Unfinished: ${unfinished(u)}`),
      t.searches.length ? `   Searched: ${t.searches.slice(0, 3).join(' · ')}` : '',
    ].filter(Boolean).join('\n'))].join('\n');
}

// ---------- everyday browser features ----------
const ZOOMS = [0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
function zoom(dir) {
  const t = activeTab();
  if (!t || t.isStart) return;
  const cur = t.userZoom || 1;
  t.userZoom = dir === 0 ? 1 : dir > 0 ? ZOOMS.find((z) => z > cur + 0.001) || 3 : [...ZOOMS].reverse().find((z) => z < cur - 0.001) || 0.33;
  if (!t.zoom) t.view.webContents.setZoomFactor(t.userZoom);
  ui('zoom', Math.round(t.userZoom * 100));
}

// Google for the user's country (google.co.in, google.co.uk, …); DuckDuckGo or Bing if they prefer.
const GOOGLE_DOMAINS = { IN: 'google.co.in', GB: 'google.co.uk', AU: 'google.com.au', CA: 'google.ca', DE: 'google.de', FR: 'google.fr', JP: 'google.co.jp',
  BR: 'google.com.br', ES: 'google.es', IT: 'google.it', NL: 'google.nl', MX: 'google.com.mx', SG: 'google.com.sg', AE: 'google.ae', ZA: 'google.co.za',
  NZ: 'google.co.nz', IE: 'google.ie', PK: 'google.com.pk', BD: 'google.com.bd', ID: 'google.co.id', KR: 'google.co.kr', SA: 'google.com.sa', TR: 'google.com.tr',
  RU: 'google.ru', PL: 'google.pl', SE: 'google.se', CH: 'google.ch', AT: 'google.at', BE: 'google.be', NG: 'google.com.ng', KE: 'google.co.ke', EG: 'google.com.eg' };
// web_search through a search API (Brave, Tavily, Exa) when the user added a key; otherwise the results page.
function applySearchApi() {
  const s = store.getSettings();
  setSearchApi({ provider: s.searchApi, key: String(s.searchApiKey || '').trim() });
}

function searchTemplateFor(engine = store.getSettings().searchEngine) {
  if (engine === 'duckduckgo') return 'https://duckduckgo.com/?q=%s';
  if (engine === 'bing') return 'https://www.bing.com/search?q=%s';
  let cc = '';
  try {
    cc = (app.getLocaleCountryCode() || '').toUpperCase();
  } catch {}
  return `https://www.${GOOGLE_DOMAINS[cc] || 'google.com'}/search?q=%s`;
}

// Right-click menu, like Chrome's, plus "Ask Skillerr".
// ---------- screenshot for your AI ----------
// One click saves what's on screen and copies a line to paste into any AI. Claude Code opens the file itself;
// apps connected to Skillerr (Claude Desktop, Cursor…) call view_capture with the id and get the image.
const CAPTURES_DIR = path.join(store.DIR, 'captures');
const CAPTURE_KEEP = 40;
async function captureForAi(tab = activeTab()) {
  if (!tab?.view || tab.isStart) throw new Error('Open a page first.');
  await browser.awake?.(tab);
  const wc = tab.view.webContents;
  const png = (await wc.capturePage()).toPNG();
  fs.mkdirSync(CAPTURES_DIR, { recursive: true });
  let id;
  do id = require('crypto').randomBytes(2).toString('hex'); while (fs.existsSync(path.join(CAPTURES_DIR, `${id}.png`)));
  const file = path.join(CAPTURES_DIR, `${id}.png`);
  const url = wc.getURL();
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  fs.writeFileSync(file, png);
  fs.writeFileSync(path.join(CAPTURES_DIR, `${id}.json`), JSON.stringify({ id, url, title: wc.getTitle(), at: new Date().toISOString() }));
  // keep the newest few
  const old = fs.readdirSync(CAPTURES_DIR).filter((f) => f.endsWith('.png'))
    .map((f) => ({ f, t: fs.statSync(path.join(CAPTURES_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(CAPTURE_KEEP);
  for (const { f } of old) for (const x of [f, f.replace(/\.png$/, '.json')]) fs.rmSync(path.join(CAPTURES_DIR, x), { force: true });
  const line = `Here's my screen from Skillerr (capture ${id}, ${host}): ${file} `;
  clipboard.writeText(line);
  return { id, file, host, line };
}

function showPageMenu(tab, p) {
  const wc = tab.view.webContents;
  const sel = (p.selectionText || '').trim();
  const items = [];
  if (p.linkURL) {
    items.push({ label: 'Open Link in New Tab', click: () => newTab(p.linkURL, { background: true }) },
      { label: 'Copy Link Address', click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' });
  }
  if (p.mediaType === 'image' && p.srcURL) {
    items.push({ label: 'Open Image in New Tab', click: () => newTab(p.srcURL, { background: true }) },
      { label: 'Save Image As…', click: () => wc.downloadURL(p.srcURL) }, { label: 'Copy Image Address', click: () => clipboard.writeText(p.srcURL) }, { type: 'separator' });
  }
  if (sel) {
    const short = sel.length > 28 ? `${sel.slice(0, 27)}…` : sel;
    items.push({ label: `Search for “${short}”`, click: () => newTab(toUrl(sel)) },
      { label: `Ask Skillerr about “${short}”`, click: () => { togglePanel(true); ui('prefill-task', `Explain this, using the page I'm on: "${sel.slice(0, 500)}"`); } },
      { type: 'separator' });
  }
  if (p.isEditable) items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
  else if (sel) items.push({ role: 'copy' });
  else {
    items.push({ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: 'Reload', click: () => wc.reload() }, { type: 'separator' },
      { label: 'Ask Skillerr About This Page', click: () => { togglePanel(true); ui('prefill-task', 'Summarize this page and what matters most on it.'); } },
      { label: 'Screenshot for Your AI', click: () => captureForAi(tab).then((r) => ui('captured', r)).catch(() => {}) },
      { label: 'Bookmark This Page', click: () => bookmarkActive() }, { label: 'Print…', click: () => wc.print() });
  }
  items.push({ type: 'separator' }, { label: 'Inspect Element', click: () => wc.inspectElement(p.x, p.y) });
  Menu.buildFromTemplate(items).popup({ window: win });
}

// Site permissions (camera, mic, location, notifications…): ask once per site, like Chrome, and remember.
const ASK = { media: 'use your camera or microphone', geolocation: 'know your location', notifications: 'show notifications', midi: 'use MIDI devices',
  midiSysex: 'use MIDI devices', 'clipboard-read': 'read your clipboard', 'display-capture': 'share your screen', idleDetection: 'know when you are idle',
  hid: 'use HID devices', serial: 'use serial ports', usb: 'use USB devices' };
// Harmless ones are granted without asking, as Chrome does. A prompt nobody answers would stall the page (and an AI driving it).
const ALWAYS = new Set(['fullscreen', 'screen-wake-lock', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock', 'window-management']);
function wirePermissions(ses) {
  const fromUs = (wc) => wc && ((chrome && wc === chrome.webContents) || (hud && wc === hud.webContents) || (captionView && wc === captionView.webContents));
  const originOf = (u) => {
    try {
      return new URL(u).origin;
    } catch {
      return '';
    }
  };
  // Recording a tab starts the capture from that tab, so Chromium reports it as the site asking for "media".
  // It's Skillerr's own capture (no camera or mic is opened): allow it once, just as a recording starts, for that tab only.
  const ourCapture = (wc, permission) => {
    const rec = recorder?.rec;
    return permission === 'media' && rec && !rec.captureGranted && rec.tab?.view?.webContents === wc && Date.now() - rec.startedAt < 10000;
  };
  ses.setPermissionCheckHandler((wc, permission, origin) => {
    if (fromUs(wc) || ALWAYS.has(permission) || ourCapture(wc, permission)) return true;
    return store.getSettings().sitePermissions?.[originOf(origin)]?.[permission] === 'allow';
  });
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (fromUs(wc) || ALWAYS.has(permission)) return callback(true); // Skillerr's own UI (e.g. the recorder)
    if (ourCapture(wc, permission)) {
      recorder.rec.captureGranted = true;
      return callback(true);
    }
    const origin = originOf(details.requestingUrl || wc?.getURL() || '');
    const saved = store.getSettings().sitePermissions?.[origin]?.[permission];
    if (saved) return callback(saved === 'allow');
    const what = ASK[permission] || `use “${permission}”`;
    const { response, checkboxChecked } = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Allow', 'Block'], defaultId: 1, cancelId: 1,
      message: `${origin || 'This site'} wants to ${what}.`, checkboxLabel: 'Remember for this site', checkboxChecked: true,
    });
    if (checkboxChecked && origin) {
      const s = store.getSettings();
      const sp = { ...(s.sitePermissions || {}) };
      sp[origin] = { ...(sp[origin] || {}), [permission]: response === 0 ? 'allow' : 'block' };
      store.saveSettings({ ...s, sitePermissions: sp });
    }
    callback(response === 0);
  });
  // Downloads go to Downloads with a progress card, like Chrome's download bar.
  ses.on('will-download', (_e, item) => {
    const file = path.join(app.getPath('downloads'), item.getFilename());
    item.setSavePath(file);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const send = (state) => ui('download', { id, name: item.getFilename(), file, received: item.getReceivedBytes(), total: item.getTotalBytes(), state });
    item.on('updated', (_ev, state) => send(state === 'interrupted' ? 'interrupted' : 'progressing'));
    item.once('done', (_ev, state) => send(state));
    send('progressing');
  });
}

function loadInActive(input) {
  const tab = activeTab();
  if (!tab) return;
  tab.typedAt = Date.now(); // typed in the address bar: maybe a new thread of work, not the next step of this one
  tab.view.webContents.loadURL(toUrl(input)).catch(() => {});
}

function contentRect() {
  const [w, h] = win.getContentSize();
  const right = panelOpen ? PANEL_WIDTH : GAP;
  return { x: GAP, y: TOP_BAR, width: Math.max(0, w - GAP - right), height: Math.max(0, h - TOP_BAR - GAP) };
}

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  if (chrome) chrome.setBounds({ x: 0, y: 0, width: w, height: h });
  const r = contentRect();
  const page = { x: r.x + FRAME, y: r.y + FRAME, width: Math.max(0, r.width - 2 * FRAME), height: Math.max(0, r.height - 2 * FRAME) };
  for (const t of tabs) if (t.view && (!mosaic || !mosaic.includes(t.id))) t.view.setBounds(page);
  if (mosaic) layoutMosaic(r);
  if (captionView) {
    const width = Math.min(CAPTION.width, page.width - 40);
    captionView.setBounds({ x: Math.round(page.x + (page.width - width) / 2), y: page.y + page.height - CAPTION.height - CAPTION.bottom, width, height: CAPTION.height });
  }
  if (hud) {
    const width = Math.min(HUD.width, page.width - 24);
    hud.setBounds({ x: Math.round(page.x + (page.width - width) / 2), y: page.y + page.height - HUD.height - HUD.bottom, width, height: HUD.height });
  }
}

// Grid that gives each tile the most room at a 16:10 shape.
function layoutMosaic(r) {
  const n = mosaic.length;
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = (r.width - (cols - 1) * TILE.gap) / cols;
    const h = (r.height - (rows - 1) * TILE.gap) / rows - TILE.label;
    const score = Math.min(w, h * 1.6);
    if (!best || score > best.score) best = { cols, rows, w, h, score };
  }
  const tiles = mosaic.map((id, i) => {
    const col = i % best.cols;
    const row = Math.floor(i / best.cols);
    const x = Math.round(r.x + col * (best.w + TILE.gap));
    const y = Math.round(r.y + row * (best.h + TILE.label + TILE.gap));
    const view = { x: x + FRAME, y: y + TILE.label + FRAME, width: Math.round(best.w - 2 * FRAME), height: Math.round(best.h - 2 * FRAME) };
    const t = getTab(id);
    t.view.setBounds(view);
    const zoom = Math.max(0.3, Math.min(1, view.width / TILE.desktopWidth));
    if (t.zoom !== zoom) {
      t.zoom = zoom;
      t.view.webContents.setZoomFactor(zoom);
    }
    return { id, x, y, width: Math.round(best.w), height: Math.round(best.h + TILE.label), label: TILE.label };
  });
  ui('mosaic', tiles);
}

const getTab = (id) => tabs.find((t) => t.id === id);
const browser = {
  active: activeTab,
  get: getTab,
  awake: async (t) => {
    if (t?.sleeping) {
      t.aiUntil = Date.now() + IDLE_AFTER_MS; // an AI woke it: not a visit of the user's
      await wake(t);
    }
    else if (t?.waking) await t.waking;
  },
  isVisible: (t) => isShown(t) && win.isVisible() && !win.isMinimized(),
  isRecording: (t) => !!recorder && recorder.isRecording(t),
  onOpened: (ids) => {
    for (const id of ids) getTab(id).aiUntil = Date.now() + IDLE_AFTER_MS;
    enterMosaic(ids); // let the user watch them all
  },
  newTab,
  switchTab,
  closeTab,
  listTabs: () => tabs.map(tabInfo),
};

// ---------------- the control gate every AI action passes through ----------------

function pushStatus() {
  ui('status', { ...status });
  if (hud) hud.setVisible(!!status.controller && (status.active || status.agentRunning || status.paused || status.awaitingApproval));
}

function markActive(controller) {
  status.controller = controller;
  status.active = true;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    status.active = false;
    pushStatus();
  }, IDLE_AFTER_MS);
  pushStatus();
}

// Never gated by "ask before every action": reading, narration, and local note/recording files.
const READ_ONLY = new Set(['view_capture', 'web_search', 'fetch_page', 'save_screenshot', 'open_view', 'snapshot', 'read_page', 'screenshot', 'list_tabs', 'wait', 'read_tabs', 'list_skills', 'use_skill', 'caption', 'record_stop', 'show_tabs', 'save_note', 'recall', 'tag_session', 'my_research', 'read_note', 'my_trails']);
const TRAIL_TOOL_NAMES = new Set(['my_trails', 'continue_trail']);
const trunc = (s, n) => (String(s ?? '').length > n ? String(s).slice(0, n - 1) + '…' : String(s ?? ''));
const NOTES_DIR = path.join(app.getPath('home'), 'Skillerr', store.PROFILE ? `notes-${store.PROFILE}` : 'notes');
const RESEARCH_DIR = path.join(app.getPath('home'), 'Skillerr', store.PROFILE ? `research-${store.PROFILE}` : 'research');

// ---------- research folders: topics as real folders on disk ----------
const safeName = (s) => String(s).replace(/[\/\\:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
const folderPathOf = (topicPath) => path.join(RESEARCH_DIR, ...topicPath.split(' > ').map(safeName));
function findFolder(tree, id) {
  for (const f of tree) {
    if (f.id === id) return f;
    const hit = findFolder(f.children, id);
    if (hit) return hit;
  }
  return null;
}

// Write a topic's folder: an index of its research, its notes linked in, and links to related folders.
function writeResearchFolder(f) {
  const dir = folderPathOf(f.path);
  fs.mkdirSync(dir, { recursive: true });
  const by = (t) => f.items.filter((i) => i.type === t);
  const rel = (other) => path.relative(dir, folderPathOf(other)).split(path.sep).join('/');
  const lines = [`# ${f.path}`, '', `Research folder kept by Skillerr. Last updated ${new Date().toISOString().slice(0, 10)}.`, ''];
  if (by('session').length) lines.push('## Research sessions', ...by('session').map((i) => `- ${i.label}${i.summary ? `: ${i.summary}` : ''} (${i.when})`), '');
  if (by('note').length) lines.push('## Notes', ...by('note').map((i) => `- [${i.label}](${encodeURI(path.basename(i.file || ''))})`), '');
  if (by('skill').length) lines.push('## Skills', ...by('skill').map((i) => `- ${i.label}`), '');
  if (by('page').length) lines.push('## Pages read', ...by('page').map((i) => `- [${i.label}](${i.url})`), '');
  if (f.children.length) lines.push('## Inside', ...f.children.map((c) => `- [${c.name}](${encodeURI(c.name)}/README.md)`), '');
  if (f.linked.length) lines.push('## Linked folders', ...f.linked.map((l) => `- [${l.path}](${encodeURI(rel(l.path))}/README.md)`), '');
  fs.writeFileSync(path.join(dir, 'README.md'), lines.join('\n'));
  // Notes appear inside the folder too (a link to the one real file, so there's never two versions).
  for (const n of by('note')) {
    if (!n.file || !fs.existsSync(n.file)) continue;
    const link = path.join(dir, path.basename(n.file));
    try {
      fs.rmSync(link, { force: true });
      if (process.platform === 'win32') fs.copyFileSync(n.file, link);
      else fs.symlinkSync(n.file, link);
    } catch {}
  }
  for (const c of f.children) writeResearchFolder(c);
  return dir;
}

function researchPrompt(f) {
  const notes = f.items.filter((i) => i.type === 'note').slice(0, 3).map((i) => `"${i.label}"`);
  const leaf = f.path.split(' > ').pop();
  return `Using Skillerr, continue my research on "${f.path}": first call recall("${leaf}")` +
    (notes.length ? ` and read_note ${notes.join(', ')}` : '') +
    `, check the folder ${folderPathOf(f.path)}, then build on what's already there instead of starting over.`;
}

// Hand a research topic to any AI as a standard skill: a SKILL.md that says when it applies and where the
// research lives. Skills are shared with Claude Code when that's on, and any skills-aware AI can load the folder.
function researchSkill(f) {
  writeResearchFolder(f);
  const folder = folderPathOf(f.path);
  const leaf = f.path.split(' > ').pop();
  const slug = ('research-' + f.path.toLowerCase().replace(/[^a-z0-9]+/g, '-')).replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64).replace(/-$/, '');
  const notes = f.items.filter((i) => i.type === 'note').slice(0, 5).map((i) => `- ${i.label}`).join('\n');
  return skills.learn({
    name: slug,
    description: `Use when the user asks about ${f.path.replace(/ > /g, ' › ')}: their own earlier research on it is saved on this computer.`,
    instructions: `The user already researched "${f.path}". Build on it instead of starting over.\n\n` +
      `1. Read ${path.join(folder, 'README.md')}: an index of the sessions, pages and notes on this topic.\n` +
      `2. Read the notes in that folder${notes ? `:\n${notes}` : '.'}\n` +
      `3. If Skillerr is connected, call recall("${leaf}") for related sessions and pages, and open_view with view "folders" to show them.\n` +
      `4. Check dates: for anything time-sensitive (prices, rules, schedules), search again and say what changed.\n` +
      `5. Cite the pages the research came from.`,
    topics: [f.path],
    by: 'you',
  });
}

function targetTab(args) {
  return args.tab_id != null ? getTab(Number(args.tab_id)) : activeTab();
}

function touchTab(tab) {
  if (!tab) return;
  tab.aiUntil = Date.now() + IDLE_AFTER_MS;
  tab.lastUsed = Date.now();
  // While an AI works in a background tab, let it run at full speed; throttle again once it's idle.
  const wc = tab.view.webContents;
  if (!wc.isDestroyed()) {
    wc.setBackgroundThrottling(false);
    clearTimeout(tab.throttleTimer);
    tab.throttleTimer = setTimeout(() => !wc.isDestroyed() && wc.setBackgroundThrottling(true), IDLE_AFTER_MS * 3);
  }
  pushTabs();
  setTimeout(pushTabs, IDLE_AFTER_MS + 50);
}

function requestApproval(entry, reason) {
  ui('log', { ...entry, state: 'approval', reason });
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null), APPROVAL_TIMEOUT_MS);
    function finish(ok) {
      clearTimeout(timer);
      pendingApprovals.delete(entry.id);
      status.awaitingApproval = pendingApprovals.size > 0;
      pushStatus();
      resolve(ok);
    }
    pendingApprovals.set(entry.id, finish);
    status.awaitingApproval = true;
    pushStatus();
  });
}

// ---------- undo: cheap, common, reversible actions only ----------
const undoStack = []; // [{ id, run }]

function pushUndo(id, run) {
  undoStack.push({ id, run });
  if (undoStack.length > 30) undoStack.shift();
  ui('undo-top', id);
}

function captureUndo(entry, name, args, tab, before, info) {
  if (!tab && name !== 'close_tab') return;
  const wc = tab && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null;
  const afterUrl = wc ? wc.getURL() : null;
  const navigated = wc && before.url && afterUrl !== before.url;

  if (['navigate', 'click', 'go_forward', 'press_key', 'type', 'select_option'].includes(name) && navigated) {
    return pushUndo(entry.id, async () => {
      if (!tab.view || tab.view.webContents.getURL() !== afterUrl) throw new Error('The page has changed since; nothing to undo.');
      tab.view.webContents.navigationHistory.goBack();
    });
  }
  if ((name === 'type' || name === 'select_option') && info && info.value != null) {
    return pushUndo(entry.id, async () => {
      const ok = await restoreValue(tab, info.frameId, entry.id, info.value);
      if (!ok) throw new Error('That field is gone; nothing to undo.');
    });
  }
  if (name === 'go_back' && navigated) {
    return pushUndo(entry.id, async () => tab.view?.webContents.navigationHistory.goForward());
  }
  if (name === 'new_tab' || name === 'open_tabs') {
    const created = tabs.filter((t) => !before.tabIds.includes(t.id)).map((t) => t.id);
    if (created.length) return pushUndo(entry.id, async () => created.forEach((id) => getTab(id) && closeTab(id)));
  }
  if (name === 'close_tab' && before.closedUrl) {
    return pushUndo(entry.id, async () => newTab(before.closedUrl));
  }
}

async function undo(id) {
  const top = undoStack[undoStack.length - 1];
  if (!top || top.id !== id) return;
  undoStack.pop();
  try {
    await top.run();
    ui('log-undone', { id });
  } catch (err) {
    ui('log-undone', { id, error: err.message });
  }
  ui('undo-top', undoStack.length ? undoStack[undoStack.length - 1].id : null);
}

// Robot checks (reCAPTCHA, hCaptcha, Cloudflare Turnstile, "verify you are human") are for the person, never the AI.
const CHECK_FRAME = /(google\.com\/recaptcha|recaptcha\.net|hcaptcha\.com|challenges\.cloudflare\.com|arkoselabs|funcaptcha)/i;
const CHECK_LABEL = /(not a robot|verify (that )?you are (a )?human|are you human|captcha|confirm you're human)/i;
const HUMAN_CHECK_JS = `(() => {
  const frames = [...document.querySelectorAll('iframe')].some((f) => ${CHECK_FRAME}.test(f.src || ''));
  const text = ${CHECK_LABEL}.test((document.body && document.body.innerText || '').slice(0, 4000));
  return frames || text;
})()`;

async function humanCheck(controller, tab) {
  if (!tab || tab.isStart || tab.view.webContents.isDestroyed()) return false;
  const found = await tab.view.webContents.executeJavaScript(HUMAN_CHECK_JS).catch(() => false);
  if (!found) return false;
  if (mosaic) exitMosaic();
  if (tab.id !== activeTabId) switchTab(tab.id);
  togglePanel(true);
  win.focus();
  ui('human-check', { controller: controller.name, via: controller.via, tabId: tab.id, title: tab.view.webContents.getTitle() });
  // If Skillerr isn't in front, make sure the user notices: a notification (once a minute per tab), a bouncing Dock
  // icon on macOS, a flashing taskbar button on Windows. Clicking the notification opens that tab.
  if (!win.isFocused() && Date.now() - (tab.checkNotifiedAt || 0) > 60000) {
    tab.checkNotifiedAt = Date.now();
    let host = '';
    try { host = new URL(tab.view.webContents.getURL()).hostname.replace(/^www\./, ''); } catch {}
    const { Notification } = require('electron');
    if (Notification.isSupported()) {
      const n = new Notification({ title: 'Your turn in Skillerr', body: `${host || 'A page'} wants to check you're human. ${controller.name} is waiting for you.`, silent: false });
      n.on('click', () => { if (win.isMinimized()) win.restore(); win.focus(); if (getTab(tab.id)) switchTab(tab.id); });
      n.show();
    }
    if (process.platform === 'darwin') app.dock?.bounce('critical');
    else win.flashFrame(true);
  }
  return true;
}

const blocked = (controller) => controller.via === 'mcp' && (store.getSettings().blockedClients || []).includes(controller.name);

// ---------- pages that try to instruct the AI ----------
// tools.js strips hidden text, fences page text as untrusted and redacts lines aimed at an AI (src/guard.js).
// When that happens, Skillerr tells the user. Approvals don't change: in auto mode only sensitive actions ask,
// in manual mode ("Ask before every action") everything does.
function flagInjection(controller, p) {
  const t = p.tabId != null ? getTab(p.tabId) : null;
  const flag = { host: p.host || 'A page', reasons: p.reasons || [], excerpt: String(p.excerpt || '').slice(0, 160), at: Date.now() };
  if (t) t.injection = flag;
  ui('say', { controller: 'Skillerr', text: `⚠ **${flag.host}** contained text aimed at an AI${flag.excerpt ? ` (“${flag.excerpt}”)` : ''}. ` +
    `Skillerr removed it before ${controller.name} read the page. Payments, passwords, sign-ins and deletions still wait for your OK.` });
}

// Every AI tool call runs inside its session (see ai-activity.js): tabs it opens are that session's, and the pages it
// opens or tries to are listed in the live view's Audit. Calls a tool makes itself (deep_research) stay in the same one.
function execute(controller, name, args) {
  const outer = aiCall.getStore();
  const session = outer?.client === controller.name ? outer.session : activity.touch(controller.name);
  return aiCall.run({ client: controller.name, session }, () => executeInSession(controller, name, args, session));
}

// Page tools and what their success means for the Audit list.
const AUDIT_STATE = { navigate: 'opened', new_tab: 'opened', web_search: 'opened', go_back: 'opened', go_forward: 'opened', fetch_page: 'read', read_page: 'read' };
const requestedUrls = (name, args) => {
  const safe = (u) => { try { return aiUrl(u); } catch { return null; } };
  if (name === 'open_tabs') return (args.urls || []).slice(0, 10).map(safe).filter(Boolean);
  if (['navigate', 'new_tab', 'fetch_page'].includes(name) && args.url) return [safe(args.url)].filter(Boolean);
  if (name === 'web_search' && args.query) return [safe(String(args.query))].filter(Boolean);
  return [];
};
const tabTitle = (t) => (t?.sleeping ? t.sleeping.title : t?.view && !t.view.webContents.isDestroyed() ? t.view.webContents.getTitle() : '');

async function executeInSession(controller, name, args, session) {
  if (!TOOLS.some((t) => t.name === name)) throw new Error(`Unknown tool: ${name}`);
  if (blocked(controller)) throw new Error(`The user has turned off ${controller.name} in Skillerr, so it can't use the browser. Ask them to turn it back on in Skillerr → Connected AI apps.`);
  if (status.paused) throw new Error('The user has paused AI control of the browser. Wait for them to resume.');
  markActive(controller);
  if (name === 'caption' && recorder?.info()?.scope === 'window') return BROWSER_TOOLS.caption(args); // narration, not a page action
  if (name === 'say') {
    ui('say', { controller: controller.name, via: controller.via, text: String(args.text || '').slice(0, 4000) });
    return { text: 'Shown to the user.' };
  }

  const id = ++seq;
  // fetch_page opens its own tab (grouped with this AI's research) unless told which tab to use.
  if (name === 'fetch_page' && args.tab_id == null) args = { ...args, tab_id: newTab(undefined, { background: !activeTab()?.isStart }).id };
  // So does web_search, rather than taking over a page the user has open (a blank tab or this AI's own is fine).
  const mine = (t) => t && t.aiBy === controller.name && t.aiSession === session;
  if (name === 'web_search' && args.tab_id == null && activeTab() && !activeTab().isStart && !mine(activeTab())) {
    args = { ...args, tab_id: newTab(undefined, { background: true }).id };
  }
  const tab = targetTab(args);
  // A tab the AI loads pages in is its session's (the live view shows it); tabs it only looks at stay the user's.
  if (tab && AUDIT_STATE[name] && !['read_page', 'new_tab'].includes(name)) Object.assign(tab, { aiBy: controller.name, aiSession: session });
  const audit = (url, state, extra = {}) => activity.record(session, { url, tool: name, state, ...extra });
  if (tab?.sleeping || tab?.waking) await browser.awake(tab); // an AI touching a sleeping tab wakes it first
  const info = await inspectTarget(browser, name, args, id);
  const entry = { id, ts: Date.now(), controller: controller.name, via: controller.via, session, tool: name, args, target: info?.label || '', tabId: tab?.id, state: 'running' };
  if (name === 'record_start' || name === 'record_stop') entry.tabId = null; // not a page action, nothing to highlight

  if (['click', 'type', 'press_key'].includes(name) && (CHECK_FRAME.test(info?.frameUrl || '') || CHECK_LABEL.test(info?.label || ''))) {
    await humanCheck(controller, tab);
    audit(tabUrl(tab), 'blocked', { title: tabTitle(tab), reason: 'Robot check: waiting for you', tabId: tab?.id });
    throw new Error('That is a robot check. Only the user may complete it: Skillerr has asked them to. Carry on with your other tabs meanwhile, then come back to this one and take a new snapshot.');
  }

  // Sensitive actions always need a human, even with approval mode off. Enforced here, not by the prompt.
  // A learned skill steers every future task, so a page can't be allowed to plant one unseen.
  if (name === 'save_skill') entry.target = String(args.name || '');
  // Trails are the user's own browsing: each AI app asks once, and the answer is remembered.
  const trailConsent = TRAIL_TOOL_NAMES.has(name) && controller.via === 'mcp' && !(store.getSettings().trailsAllowedClients || []).includes(controller.name);
  if (trailConsent) entry.target = 'your trails';
  const reason = name === 'save_skill' ? `Skills change how AIs work on future tasks. “${trunc(args.description, 140)}”`
    : trailConsent ? `${controller.name} wants to see your trails: the titles and pages of your ongoing work in Skillerr. If you allow it, it can see them from now on (you can take that back in Trails).`
    : info?.sensitive ? `This looks like ${info.sensitive}.`
    : status.requireApproval && !READ_ONLY.has(name) ? null : undefined;
  if (reason !== undefined) {
    const ok = await requestApproval(entry, reason);
    if (!ok) {
      ui('log', { ...entry, state: 'error', summary: ok === null ? 'No one approved in time' : 'You declined this action' });
      for (const u of requestedUrls(name, args)) audit(u, 'declined', { reason: ok === null ? 'No one approved in time' : 'You declined it' });
      throw new Error(ok === null
        ? 'This action needs the user\'s approval in Skillerr and nobody approved it in time. Ask the user to watch Skillerr and approve, then retry.'
        : 'The user declined this action. Do not retry it.');
    }
    if (trailConsent) {
      const s = store.getSettings();
      store.saveSettings({ ...s, trailsAllowedClients: [...new Set([...(s.trailsAllowedClients || []), controller.name])] });
    }
    markActive(controller);
  }

  const before = {
    wasStart: !!tab?.isStart,
    url: tab && !tab.isStart ? tab.view.webContents.getURL() : null,
    tabIds: tabs.map((t) => t.id),
    closedUrl: name === 'close_tab' ? (() => { const c = args.tab_id != null ? getTab(Number(args.tab_id)) : activeTab(); return c?.sleeping ? c.sleeping.url : c?.view?.webContents.getURL(); })() : null,
  };
  ui('log', entry);
  touchTab(tab);
  try {
    const result = name === 'dispatch' ? await dispatch(controller, args) : name === 'deep_research' ? await deepResearch(controller, args) : BROWSER_TOOLS[name] ? await BROWSER_TOOLS[name](args, controller) : await runTool(browser, name, args);
    ui('log', { ...entry, state: 'ok', ts: Date.now() });
    if (result?.injection) for (const p of result.injection.pages || [result.injection]) flagInjection(controller, p);
    captureUndo(entry, name, args, tab, before, info);
    capture(controller, name, args, tab, result, info);
    // Group what this AI opened (and a fresh tab it started working in) under its current research task.
    const opened = tabs.filter((t) => !before.tabIds.includes(t.id)).map((t) => t.id);
    if (opened.length) assignGroup(controller, opened);
    if ((name === 'navigate' && tab && before.wasStart) || name === 'fetch_page') assignGroup(controller, [tab.id]);
    try {
      auditResult(name, args, tab, opened, before, audit);
    } catch {} // nor may the Audit list
    try {
      researchNote(controller, name, args, getTab(opened[0]) || tab);
    } catch {} // research trails must never break a tool call
    if (['navigate', 'click', 'snapshot', 'new_tab', 'type', 'press_key'].includes(name) && (await humanCheck(controller, name === 'new_tab' ? activeTab() : tab))) {
      result.text = `${result.text || ''}\n\nThis page is showing a robot check. Skillerr has asked the user to complete it. Don't try to solve or click it. Carry on with your other tabs meanwhile, then come back to this one and take a new snapshot.`;
    }
    return result;
  } catch (err) {
    ui('log', { ...entry, state: 'error', summary: err.message });
    for (const u of requestedUrls(name, args)) audit(u, 'failed', { reason: err.message, tabId: tab?.id });
    throw err;
  } finally {
    touchTab(tab);
    markActive(controller);
  }
}

// What a successful call opened or read, for the Audit list. A page that didn't load counts as a failed attempt.
function auditResult(name, args, tab, opened, before, audit) {
  const note = (t, state) => (t.loadFailed ? audit(tabUrl(t), 'failed', { reason: t.loadFailed.reason, tabId: t.id }) : audit(tabUrl(t), state, { title: tabTitle(t), tabId: t.id }));
  if (name === 'open_tabs' || name === 'new_tab') {
    for (const t of opened.map(getTab).filter(Boolean)) note(t, 'opened');
  } else if (name === 'read_tabs') {
    const ids = args.tab_ids?.length ? args.tab_ids.map(Number) : tabs.filter((t) => !t.isStart).map((t) => t.id);
    for (const t of ids.map(getTab).filter(Boolean)) note(t, 'read');
  } else if (AUDIT_STATE[name] && tab) {
    const url = tabUrl(tab);
    if (!url || url === 'about:blank' || /^chrome-error:/.test(url) || tab.loadFailed) {
      const urls = requestedUrls(name, args);
      for (const u of urls.length ? urls : [url]) audit(u, 'failed', { reason: tab.loadFailed?.reason || "The page didn't load", tabId: tab.id });
    } else note(tab, AUDIT_STATE[name]);
  } else if (name === 'click' && tab && !tab.isStart && tabUrl(tab) !== before.url) {
    note(tab, 'opened'); // a link the AI followed
  }
}

// ---------- tools the browser itself answers: skills and recording ----------
function pageTab(args) {
  const tab = targetTab(args);
  if (!tab) throw new Error(args.tab_id != null ? `No tab ${args.tab_id}.` : 'No open tab');
  if (tab.isStart) throw new Error('Open a page in this tab first.');
  return tab;
}

const BROWSER_TOOLS = {
  list_skills: async () => ({ text: skills.listText() }),
  use_skill: async (args) => ({ text: skills.useText(args.name) }),
  record_start: async (args) => {
    if (args.scope === 'window') return recorder.start(activeTab(), args.title, 'window');
    const tab = pageTab(args);
    if (tab.id !== activeTabId || mosaic) switchTab(tab.id); // record the tab full-size, as the viewer would see it
    return recorder.start(tab, args.title);
  },
  save_note: async (args, controller) => {
    const title = String(args.title || 'Note').replace(/[\/\\:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Note';
    fs.mkdirSync(NOTES_DIR, { recursive: true });
    let file = path.join(NOTES_DIR, `${title}.md`);
    for (let n = 2; fs.existsSync(file); n++) file = path.join(NOTES_DIR, `${title} (${n}).md`);
    const body = String(args.content || '').trim();
    fs.writeFileSync(file, /^#\s/.test(body) ? `${body}\n` : `# ${title}\n\n${body}\n`);
    ui('note-saved', { title, file });
    if (remembering()) memory.addNote(memSession(controller), { title, file, content: body, topics: args.topics, entities: args.entities });
    return { text: `Saved to ${file}. Tell the user it's there; they can open it any time, and you can reopen it later with read_note.` };
  },
  recall: async (args, controller) => {
    const sid = remembering() ? memSession(controller, { goal: args.query }) : null;
    const items = memory.recall(String(args.query || ''), { excludeSession: sid, semantic: await similarTo(String(args.query || '')) });
    ui('recall', { controller: controller.name, via: controller.via, query: args.query, items });
    const deep = deepSettings();
    return { text: recallText(items, memory.topics()) + (deep.on ? `\n\nDeep research mode is on (depth ${deep.depth}): for this research, use deep_research to read the relevant pages and follow their links, then answer with sources.` : '') };
  },
  tag_session: async (args, controller) => {
    if (!remembering()) return { text: 'Research memory is off, so nothing was filed.' };
    const related = memory.fileSession(memSession(controller), args);
    const tags = [...(args.topics || []), ...(args.entities || [])];
    return { text: `Filed${tags.length ? ` under ${tags.join(', ')}` : ''}.` + (related.length ? ` Looks related to: ${related.map((r) => `“${memory.label(r)}”`).join(', ')}.` : '') };
  },
  my_research: async () => {
    let notes = [];
    try {
      notes = fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith('.md'))
        .map((f) => ({ f, t: fs.statSync(path.join(NOTES_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, 15);
    } catch {}
    const st = memory.stats();
    const all = skills.list();
    const s = store.getSettings();
    return { text: [
      `Notes (Markdown files the user keeps): ${NOTES_DIR}`,
      ...(notes.length ? notes.map((n) => `- ${n.f.replace(/\.md$/, '')} (${new Date(n.t).toISOString().slice(0, 10)})`) : ['- none yet']),
      '',
      `Skills: built-in ones ship with Skillerr; learned and installed ones are in ${skills.USER_DIR}` +
        (s.shareSkillsWithClaudeCode ? `, and are also copied to Claude Code at ${skills.CLAUDE_SKILLS}` : ''),
      ...all.map((k) => `- ${k.name} (${k.trust.state}): ${k.description}`),
      '',
      `Research folders (one folder per topic, with an index and the notes): ${RESEARCH_DIR}`,
      `Research memory: ${st.session} sessions, ${st.page} pages, ${st.topic} topics, stored on this computer in ${path.join(store.DIR, 'memory')}. ` +
        'Use recall to search it. The user can browse it in Skillerr → ⋮ → Skillerr Orb.',
    ].join('\n') };
  },
  my_trails: async (args) => {
    if (!learningTrails()) return { text: 'The user has Trails turned off in Skillerr, so there are none to show.' };
    return { text: trailsText(args) };
  },
  continue_trail: async (args) => {
    if (!learningTrails()) return { text: 'The user has Trails turned off in Skillerr.' };
    const r = continueTrail(String(args.trail_id || ''));
    return { text: r.opened ? `Reopened “${r.title}” for the user (${r.opened} tab${r.opened === 1 ? '' : 's'}).` : `“${r.title}” has no pages to reopen.` };
  },
  read_note: async (args) => {
    const want = String(args.title || '').replace(/\.md$/i, '').toLowerCase().trim();
    let files = [];
    try {
      files = fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith('.md'));
    } catch {}
    const f = files.find((x) => x.replace(/\.md$/, '').toLowerCase() === want) || files.find((x) => x.toLowerCase().includes(want));
    if (!f) throw new Error(`No note matching "${args.title}". Call my_research to list notes.`);
    return { text: `${path.join(NOTES_DIR, f)}\n\n${fs.readFileSync(path.join(NOTES_DIR, f), 'utf8').slice(0, 30000)}` };
  },
  save_skill: async (args, controller) => {
    const r = skills.learn({ ...args, by: controller?.name || 'an AI' });
    if (remembering()) memory.addSkill(memSession(controller), { name: r.skill.name, description: r.skill.description, file: r.file, topics: args.topics });
    ui('skill-learned', { ...r.skill, updated: r.updated, file: r.file });
    if (store.getSettings().shareSkillsWithClaudeCode) skills.shareWithClaudeCode();
    return { text: `${r.updated ? 'Updated' : 'Saved'} skill "${r.skill.name}" (${r.file}). It will be offered on future tasks that match its description.` };
  },
  view_capture: async (args) => {
    let id = String(args.id || '').trim().toLowerCase();
    if (!id || id === 'latest') {
      const pngs = fs.existsSync(CAPTURES_DIR) ? fs.readdirSync(CAPTURES_DIR).filter((f) => f.endsWith('.png')) : [];
      pngs.sort((a, b) => fs.statSync(path.join(CAPTURES_DIR, b)).mtimeMs - fs.statSync(path.join(CAPTURES_DIR, a)).mtimeMs);
      id = (pngs[0] || '').replace(/\.png$/, '');
    }
    const file = path.join(CAPTURES_DIR, `${id.replace(/[^a-f0-9]/g, '')}.png`);
    if (!id || !fs.existsSync(file)) throw new Error(`No Skillerr capture "${args.id}". Ask the user to click "Screenshot for your AI" in Skillerr again.`);
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(file.replace(/\.png$/, '.json'), 'utf8')); } catch {}
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromPath(file);
    const view = img.getSize().width > 1600 ? img.resize({ width: 1600 }) : img;
    return { text: `Capture ${id}: what the user saw in Skillerr${meta.url ? ` on ${meta.url} ("${meta.title || ''}")` : ''}${meta.at ? `, taken ${meta.at}` : ''}.`,
      image: { data: view.toJPEG(85).toString('base64'), mimeType: 'image/jpeg' } };
  },
  save_screenshot: async (args) => {
    const scope = ['page', 'full_page', 'window'].includes(args.scope) ? args.scope : 'page';
    let png;
    let what;
    if (scope === 'window') {
      png = await grabWindow();
      what = 'the Skillerr window';
    } else {
      const tab = pageTab(args);
      const wc = tab.view.webContents;
      what = wc.getURL();
      if (scope === 'full_page') png = await fullPage(wc).catch(() => null);
      if (!png) png = (await wc.capturePage()).toPNG();
    }
    const dir = path.join(app.getPath('pictures'), 'Skillerr');
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const base = `${safeName(args.name || scope)}-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const file = path.join(dir, `${base}.png`);
    fs.writeFileSync(file, png);
    ui('shot-saved', { file, scope });
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromBuffer(png);
    const view = img.getSize().width > 1400 ? img.resize({ width: 1400 }) : img;
    return { text: `Saved a ${scope.replace('_', ' ')} screenshot of ${what} to ${file}`, image: { data: view.toJPEG(80).toString('base64'), mimeType: 'image/jpeg' } };
  },
  open_view: async (args) => {
    const v = String(args.view || '');
    if (v === 'trails') {
      openInternal('trails');
    } else if (v === 'memory' || v === 'folders' || v === 'history' || v === 'bookmarks') {
      openInternal(v === 'memory' || v === 'folders' ? 'memory' : 'data');
      if (v === 'folders') setTimeout(() => ui('memory-mode', { mode: 'folders', query: args.query || '' }), 300);
      if (v === 'bookmarks' || v === 'history') ui('data-tab', v);
      if (v === 'memory' && args.query) setTimeout(() => ui('memory-search', String(args.query)), 400);
    } else if (['settings', 'skills', 'connect'].includes(v)) {
      togglePanel(true);
      ui('open-sheet', v);
    } else if (v === 'panel') {
      togglePanel(true);
      ui('close-sheets');
    } else throw new Error('view must be memory, folders, trails, history, bookmarks, settings, skills, connect or panel.');
    return { text: `Showing ${v}.` };
  },
  show_tabs: async (args) => {
    const ids = args.tab_ids && args.tab_ids.length ? args.tab_ids.map(Number) : tabs.filter((t) => !t.isStart).map((t) => t.id);
    if (!enterMosaic(ids)) throw new Error('Fleet view needs at least two open pages.');
    return { text: `Showing tabs ${mosaic.join(', ')} side by side. Act on each with tab_id.` };
  },
  // Window recordings caption the whole window, so any tab (even a new one) will do.
  caption: async (args) => recorder.caption(recorder.info()?.scope === 'window' ? targetTab(args) || activeTab() : pageTab(args), args.text),
  record_stop: async () => recorder.stop(),
};

// "/demo-recorder show how to check out" → run the task with that skill's instructions loaded.
function expandSkill(task) {
  const m = task.match(/^\/([a-z0-9-]+)\s*([\s\S]*)$/);
  const s = m && skills.get(m[1]);
  if (!s) return task;
  return `Use the "${s.name}" skill for this task.\n\n${skills.useText(s.name)}\n\n---\nTask: ${m[2].trim() || s.example || 'Do what the skill describes on the current page.'}`;
}

// ---------- deep research: follow relevant links, hop by hop, in visible tabs ----------
// Links from the page's main content only; menus, headers, footers and sidebars are chrome, not sources.
const LINKS_JS = `(() => {
  const root = document.querySelector('main, article, [role=main], #mw-content-text, #bodyContent, #content') || document.body;
  const skip = 'nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo], .navbox, .mw-editsection, .toc, #toc';
  return [...root.querySelectorAll('a[href]')]
    .filter((a) => !a.closest(skip))
    .map((a) => ({ href: a.href.split('#')[0], text: (a.innerText || a.title || a.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 140) }))
    .filter((l) => /^https?:/.test(l.href) && l.text).slice(0, 600);
})()`;
const SKIP_LINK = /(log ?in|sign ?(in|up)|register|account|privacy|cookie|terms|subscribe|newsletter|careers|advertis|donate|contact|facebook\.com|twitter\.com|x\.com\/|instagram|linkedin|youtube\.com\/(@|channel)|mailto:|javascript:|\/(Special|Talk|User|User_talk|Help|File|Template|Wikipedia|Wikivoyage|Portal|Category):|[?&](action|oldid|diff|curid|printable)=|\.(pdf|zip|jpg|png|gif|mp4)(\?|$))/i;
const LINKS_PER_PAGE = 3;
const BATCH = 6;

const deepSettings = () => {
  const s = store.getSettings();
  return { on: !!s.deepResearch, depth: Math.max(1, Math.min(5, Number(s.deepDepth) || 3)) };
};

// Passages from a page that bear on the question.
function passages(text, q, max = 700) {
  const JUNK = /(toggle the table of contents|\d+ languages|article talk|read edit view|jump to (content|navigation)|from wikipedia|this article is about|coordinates:)/i;
  const sentences = String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter((x) => x.length > 30 && x.length < 600 && !JUNK.test(x));
  const scored = sentences.map((x, i) => ({ x, i, s: tokens(x).filter((w) => q.has(w)).length })).filter((r) => r.s > 0);
  const top = scored.sort((a, b) => b.s - a.s).slice(0, 5).sort((a, b) => a.i - b.i);
  let out = top.map((r) => r.x).join(' … ');
  if (!out) out = sentences.slice(0, 3).join(' ');
  return out.length > max ? out.slice(0, max - 1) + '…' : out;
}

async function deepResearch(controller, args) {
  const q = new Set(tokens(args.query));
  if (!q.size) throw new Error('Give the question being researched as `query`.');
  const depth = Math.max(1, Math.min(5, Number(args.depth) || deepSettings().depth));
  const max = Math.max(3, Math.min(60, Number(args.max_pages) || 30));
  const keyOf = (u) => String(u).replace(/[#?].*$/, '').replace(/\/$/, '');
  let frontier = (args.urls || []).slice(0, 6).map((u) => ({ url: aiUrl(u), from: null, fromUrl: null }));
  if (!frontier.length) {
    frontier = tabs.filter((t) => !t.isStart && !t.internal).map((t) => ({ url: t.sleeping ? t.sleeping.url : t.view.webContents.getURL(), from: null, fromUrl: null }));
    if (!frontier.length) throw new Error('Open a page first, or pass starting urls.');
  }
  const seen = new Set();
  const report = [];
  for (let level = 0; level <= depth && frontier.length && report.length < max; level++) {
    const batch = [];
    for (const f of frontier) {
      const k = keyOf(f.url);
      if (seen.has(k) || batch.length >= max - report.length) continue;
      seen.add(k);
      batch.push(f);
    }
    const next = [];
    for (let i = 0; i < batch.length; i += BATCH) {
      const chunk = batch.slice(i, i + BATCH);
      const opened = await execute(controller, 'open_tabs', { urls: chunk.map((f) => f.url) });
      if (recorder?.active) await new Promise((r) => setTimeout(r, 1800)); // on camera: let viewers see the tiles before they're read
      const ids = [...String(opened.text).matchAll(/tab (\d+):/g)].map((m) => Number(m[1]));
      const read = await execute(controller, 'read_tabs', { tab_ids: ids });
      const texts = new Map(String(read.text).split(/^## tab /m).slice(1).map((part) => [Number(part.match(/^(\d+)/)?.[1]), part.split('\n').slice(1).join('\n')]));
      for (const [j, id] of ids.entries()) {
        const t = getTab(id);
        if (!t) continue;
        const wc = t.view.webContents;
        report.push({ level, title: guard.cleanShort(wc.getTitle()).text, url: wc.getURL(), from: chunk[j]?.from, text: passages(guard.unwrap(texts.get(id) || ''), q) });
        if (chunk[j]?.fromUrl && remembering()) memory.linksTo(chunk[j].fromUrl, [wc.getURL()]); // the link we followed
        if (level < depth) {
          const links = await wc.executeJavaScript(LINKS_JS).catch(() => []);
          const here = keyOf(wc.getURL());
          const known = new Set(tokens(wc.getTitle())); // words this page is already about add nothing new
          const ranked = links
            .filter((l) => !SKIP_LINK.test(l.href) && !SKIP_LINK.test(l.text) && keyOf(l.href) !== here && !seen.has(keyOf(l.href)))
            .map((l) => {
              const words = new Set(tokens(`${l.text} ${decodeURIComponent(l.href.replace(/^https?:\/\/[^/]+/, '')).replace(/[-_/]/g, ' ')}`));
              const hits = [...words].filter((w) => q.has(w));
              return { ...l, s: hits.filter((w) => !known.has(w)).length * 2 + hits.length };
            })
            .filter((l) => l.s > 0)
            .sort((a, b) => b.s - a.s);
          const picked = [];
          for (const l of ranked) {
            if (picked.length >= LINKS_PER_PAGE) break;
            if (!picked.some((p) => keyOf(p.href) === keyOf(l.href))) picked.push(l);
          }
          for (const l of picked) next.push({ url: l.href, from: wc.getTitle() || here, fromUrl: wc.getURL() });
        }
        if (recorder?.active) await new Promise((r) => setTimeout(r, 250));
        closeTab(id); // read and recorded; keep the tab strip tidy
      }
    }
    frontier = next;
  }
  const byLevel = report.map((r) => `### ${r.level === 0 ? 'Start' : `Hop ${r.level}`}: ${r.title}\n${r.url}${r.from ? `\n(followed from “${r.from}”)` : ''}\n${guard.wrap(guard.hostOf(r.url), r.text)}`);
  return { text: `Deep research on “${args.query}”: read ${report.length} pages, up to ${depth} link-hop${depth === 1 ? '' : 's'} away.\n\n${byLevel.join('\n\n')}`.slice(0, 40000) };
}

// ---------- fleet mode: one worker per tab, running concurrently ----------
const workers = new Set();

async function dispatch(controller, { instruction, tab_ids = [], urls = [] }) {
  if (!agentReady()) {
    throw new Error("dispatch needs Skillerr's built-in AI (set it up in Skillerr's Settings). Without it: use open_tabs, act on each tab via tab_id, then read_tabs.");
  }
  const targets = [...tab_ids.map((id) => getTab(Number(id))).filter(Boolean), ...urls.map((u) => newTab(aiUrl(u), { background: true }))];
  if (!targets.length) throw new Error('Give tab_ids of open tabs and/or urls to open.');
  if (targets.length > MAX_WORKERS) throw new Error(`At most ${MAX_WORKERS} tabs per dispatch.`);
  enterMosaic(targets.map((t) => t.id));
  const workerTools = TOOLS.filter((t) => !['list_tabs', 'new_tab', 'switch_tab', 'close_tab', 'open_tabs', 'read_tabs', 'dispatch', 'record_start', 'caption', 'record_stop', 'show_tabs', 'say', 'save_note', 'save_skill', 'recall', 'tag_session', 'deep_research', 'my_research', 'read_note', 'open_view', 'save_screenshot', 'my_trails', 'continue_trail'].includes(t.name));

  const reports = await Promise.all(targets.map(async (t) => {
    const worker = new Agent({
      getSettings: store.getSettings,
      tools: workerTools,
      systemExtra: `You are one of several parallel workers. Work only in your own tab (it is already open; every tool call is routed to it). Finish with a concise report of what you found or did.`,
      execute: (name, args) => execute(controller, name, { ...args, tab_id: t.id }),
      onEvent: () => {},
    });
    workers.add(worker);
    try {
      const r = await worker.run(instruction);
      const wc = t.view.webContents;
      return `## tab ${t.id}: ${wc.getTitle()} — ${wc.getURL()}\n${r.error ? `Error: ${r.error}` : r.answer || '(no answer)'}`;
    } finally {
      workers.delete(worker);
    }
  }));
  return { text: reports.join('\n\n') };
}

// ---------------- built-in agent ----------------

function agentLabel() {
  const s = store.getSettings();
  if (/ai-gateway\.vercel\.sh/.test(s.baseUrl || '')) return `Skillerr Pro · ${String(s.model).split('/').pop()}`;
  return s.provider === 'anthropic' ? 'Skillerr · Claude' : `Skillerr · ${s.model || 'local AI'}`;
}

const agent = new Agent({
  getSettings: store.getSettings,
  tools: TOOLS.filter((t) => t.name !== 'say'),
  execute: (name, args) => execute({ name: agentLabel(), via: 'builtin' }, name, args),
  onEvent: (ev) => ui('agent', ev),
  getContext: () => `Installed skills (call use_skill to load one when a task matches):\n${skills.catalog()}` +
    (deepSettings().on ? `\n\nDeep research mode is ON (depth ${deepSettings().depth}). For research questions, find good starting pages, then call deep_research with the question so it follows relevant links ${deepSettings().depth} hops deep; answer from what it read, citing URLs.` : ''),
});

async function runAgent(task) {
  if (!agentReady()) {
    ui('agent', { type: 'error', text: proLocked(store.getSettings()) ? 'Skillerr Pro is coming soon. Choose a local model or your own API key in Settings.' : 'Choose an AI to power Skillerr in Settings.' });
    return;
  }
  status.agentRunning = true;
  markActive({ name: agentLabel(), via: 'builtin' });
  if (remembering()) memSession({ name: agentLabel(), via: 'builtin' }, { goal: task.replace(/^Use the "[^"]+" skill[\s\S]*?Task: /, ''), fresh: true });
  try {
    await agent.run(task);
  } finally {
    status.agentRunning = false;
    pushStatus();
  }
}

// Settings saved while testing Skillerr Pro (a Pro key, the Pro endpoint) don't count until Pro opens.
const PRO_ENDPOINTS = new Set([PRO_API, 'https://ai-gateway.vercel.sh/v1']);
const proLocked = (s) => !PRO_OPEN && PRO_ENDPOINTS.has(s.baseUrl);

function agentReady() {
  const s = store.getSettings();
  if (s.builtinOff) return false; // switched off on the start page; its settings are kept for switching back on
  if (proLocked(s)) return false;
  return s.provider === 'anthropic' ? !!s.apiKey : !!(s.baseUrl && s.model);
}

// ---------------- MCP connection info ----------------

function mcpEntry() {
  // Run the bridge with Electron's bundled Node so users don't need Node installed.
  return { command: process.execPath, args: [path.join(__dirname, '..', 'mcp', 'bridge.js')], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

// ---------------- IPC from the browser chrome + HUD ----------------

function setPaused(paused) {
  status.paused = !!paused;
  if (paused) {
    agent.stop();
    for (const w of workers) w.stop();
    for (const finish of [...pendingApprovals.values()]) finish(false);
  }
  pushStatus();
}

function togglePanel(open = !panelOpen) {
  panelOpen = open;
  layout();
  ui('panel', panelOpen);
}

function wireIpc() {
  ipcMain.on('navigate', (_e, input) => loadInActive(input));
  ipcMain.on('open-url', (_e, url) => newTab(toUrl(url)));
  ipcMain.on('back', () => activeTab()?.view.webContents.navigationHistory.goBack());
  ipcMain.on('forward', () => activeTab()?.view.webContents.navigationHistory.goForward());
  ipcMain.on('reload', () => activeTab()?.view.webContents.reload());
  ipcMain.on('stop-loading', () => activeTab()?.view.webContents.stop());
  ipcMain.on('new-tab', () => newTab());
  ipcMain.on('switch-tab', (_e, id) => switchTab(id));
  ipcMain.on('close-tab', (_e, id) => closeTab(id));
  ipcMain.on('toggle-panel', (_e, open) => togglePanel(typeof open === 'boolean' ? open : undefined));
  ipcMain.on('pause', (_e, paused) => setPaused(paused));
  ipcMain.on('approval', (_e, { id, ok }) => pendingApprovals.get(id)?.(!!ok));
  ipcMain.on('undo', (_e, id) => undo(id));
  ipcMain.on('mosaic-exit', () => exitMosaic());
  ipcMain.handle('tabs-refresh', () => pushTabs());
  ipcMain.on('group-close', (_e, id) => closeGroup(Number(id)));
  ipcMain.on('group-show', (_e, id) => {
    const ids = groupTabs(Number(id)).map((t) => t.id);
    if (!enterMosaic(ids) && ids[0]) switchTab(ids[0]);
  });
  ipcMain.on('grab-window-done', (_e, { id, data, error }) => grabs.get(id)?.(data, error));
  ipcMain.on('find', (_e, { text, forward = true, next = false }) => {
    const t = activeTab();
    if (!t || t.isStart) return;
    if (!text) return t.view.webContents.stopFindInPage('clearSelection');
    t.view.webContents.findInPage(text, { forward, findNext: next });
  });
  ipcMain.on('find-stop', () => activeTab()?.view.webContents.stopFindInPage('clearSelection'));
  ipcMain.on('zoom', (_e, dir) => zoom(dir));
  ipcMain.on('popup-allow', (_e, { host, url }) => {
    const s = store.getSettings();
    store.saveSettings({ ...s, popupsAllowed: { ...(s.popupsAllowed || {}), [host]: true } });
    if (url) newTab(url);
  });
  ipcMain.on('popup-open', (_e, url) => url && newTab(url));
  ipcMain.handle('capture-for-ai', async () => {
    try {
      return { ok: true, ...(await captureForAi()) };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });
  ipcMain.on('update-open', (_e, url) => trustedUpdateUrl(url) && shell.openExternal(url));
  ipcMain.on('update-restart', () => { const u = autoUpdater(); if (u) u.quitAndInstall(); });
  ipcMain.on('update-dismiss', (_e, id) => {
    const s = store.getSettings();
    store.saveSettings({ ...s, dismissedNotices: [...new Set([...(s.dismissedNotices || []), String(id)])].slice(-50) });
  });
  // "Use another way": press the site's own alternative-sign-in button for the user.
  ipcMain.on('passkey-other-way', (_e, tabId) => {
    const t = getTab(Number(tabId)) || activeTab();
    t?.view.webContents.executeJavaScript(`(() => {
      const b = [...document.querySelectorAll('button, a, [role=button], [role=link]')]
        .find((e) => /try another way|another way|use (your )?password|other options|more options|sign in another way/i.test(e.innerText || e.textContent || ''));
      if (b) { b.click(); return true; } return false;
    })()`).catch(() => {});
  });
  ipcMain.on('download-open', (_e, { file, reveal }) => {
    if (!String(file).startsWith(app.getPath('downloads'))) return;
    if (reveal) shell.showItemInFolder(file);
    else shell.openPath(file);
  });
  ipcMain.handle('mem-stats', () => memory.stats());
  ipcMain.handle('bookmarks', () => store.readJson('bookmarks.json', []));
  ipcMain.handle('chrome-profiles', () => ({ available: chrome_.available(), profiles: chrome_.profiles() }));
  ipcMain.handle('chrome-import', (_e, { profile, bookmarks, history, tabs: openTabs }) => {
    const done = [];
    try {
      if (openTabs && learningTrails()) {
        const r = importChromeTabs(profile);
        if (r.count) done.push(`${r.count} open tabs, sorted into ${r.trails} trail${r.trails === 1 ? '' : 's'}, waiting next to the address bar`);
        else done.push('no open tabs found');
      }
      if (bookmarks) {
        const list = chrome_.bookmarks(profile);
        store.writeJson('bookmarks.json', list);
        memory.importPages(list, 'bookmark');
        done.push(`${list.length} bookmarks`);
      }
      if (history) {
        if (!remembering()) done.push('history skipped (turn on Remember research first)');
        else done.push(`${memory.importPages(chrome_.history(profile), 'chrome-history')} history pages`);
      }
      ui('bookmarks-changed');
      return { ok: true, message: `Imported ${done.join(' and ')}.` };
    } catch (err) {
      return { ok: false, message: /EACCES|EPERM/.test(err.message) ? 'macOS blocked access to Chrome\'s files. Allow Skillerr in System Settings → Privacy & Security → Full Disk Access, then try again.' : err.message };
    }
  });
  ipcMain.on('sign-in-google', () => newTab('https://accounts.google.com/signin'));
  ipcMain.on('open-memory', () => openInternal('memory'));
  ipcMain.on('open-data', () => openInternal('data'));

  // Trails (see the trails section above).
  const changed = (r) => (trailsChanged(), r);
  ipcMain.on('open-trails', () => openInternal('trails'));
  ipcMain.handle('trails-home', () => trailsHome());
  ipcMain.handle('trails-ask', (_e, q) => (kilrOn() ? askKilr(q) : null));
  ipcMain.handle('kilr-learn', () => kilrLearn());
  // History: research memory and trails as one graph, each node marked as the user's or their AI's (src/history-graph.js).
  ipcMain.handle('history-graph', () => {
    const db = trailsDb();
    const trails = db.trails.filter((t) => !t.loose && t.state !== 'hidden' && db.worth(t)).map((t) => {
      const d = db.detail(t.id);
      return { summary: d, pages: d.pages };
    });
    return buildHistoryGraph({ memoryGraph: remembering() ? memory.graph({ pages: true, max: 5000 }) : null, trails, pageId: (u) => memory.pageId(u), maxNodes: 3000 });
  });
  // Kilr's own screen: what it is, what it's doing, what it costs this computer.
  ipcMain.handle('kilr-status', () => kilrStatus());
  ipcMain.handle('jump-search', (_e, q) => {
    try {
      return jumpSearch(q);
    } catch {
      return [];
    }
  });
  ipcMain.on('jump-open', (_e, c) => c && jumpOpen(c));
  // A trail's group in the tab strip: × puts all its tabs away in the trail (they stay one click away).
  ipcMain.on('chrome-on-top', (_e, on) => {
    if (chromeOnTop === !!on) return;
    chromeOnTop = !!on;
    applyVisibility();
  });
  ipcMain.handle('kilr-learn-snooze', () => {
    store.saveSettings({ ...store.getSettings(), kilrSnoozedUntil: Date.now() + 3 * 864e5 });
    trailsChanged();
  });
  ipcMain.handle('kilr-learned-seen', () => {
    const s = store.getSettings();
    if (s.kilrLastLearn) store.saveSettings({ ...s, kilrLastLearn: { ...s.kilrLastLearn, seen: true } });
  });
  ipcMain.handle('kilr-forget', () => kilrForget());
  ipcMain.handle('kilr-suggestions', () => kilrSuggestions());
  ipcMain.handle('kilr-suggestion-save', (_e, id) => kilrSaveSuggestion(String(id)));
  ipcMain.handle('kilr-suggestion-dismiss', (_e, id) => kilrDismissSuggestion(String(id)));
  ipcMain.handle('kilr-info', () => {
    const s = store.getSettings();
    return { learn: s.kilrLearn, every: s.kilrLearnEvery, last: s.kilrLastLearn, personal: kilr.personal, learning: !!learning,
      fromYou: s.kilrLearnFromYou !== false, fromAi: s.kilrLearnFromAi !== false, research: s.trailsResearch !== false, skills: s.kilrSkills !== false };
  });
  ipcMain.handle('trails-list', (_e, { state = 'active', query = '', who = 'all' } = {}) => trailsDb().list({ state, query: String(query), who }));
  ipcMain.handle('trails-detail', (_e, id) => trailsDb().detail(String(id)));
  ipcMain.handle('trails-continue', (_e, id) => continueTrail(String(id)));
  ipcMain.handle('trails-reopen-tab', (_e, { id, url }) => reopenTuckedTab(String(id), String(url)));
  ipcMain.handle('trails-shelf', () => {
    lastShelf = '';
    pushShelf();
  });
  ipcMain.handle('trails-restore-session', () => restoreLastSession());
  ipcMain.handle('trails-dismiss-session', () => changed(trailsDb().markQuit(0)));
  ipcMain.handle('trails-state', (_e, { id, state }) => changed(trailsDb().setState(String(id), state)));
  ipcMain.handle('trails-rename', (_e, { id, title }) => changed(trailsDb().rename(String(id), title)));
  ipcMain.handle('trails-merge', (_e, { into, from }) => changed(trailsDb().merge(String(into), String(from))));
  ipcMain.handle('trails-forget', (_e, id) => changed(trailsDb().forget(String(id))));
  ipcMain.handle('trails-remove-page', (_e, { id, url }) => changed(trailsDb().removePage(String(id), String(url))));
  ipcMain.handle('trails-ignore', (_e, host) => changed(trailsDb().ignoreHost(host)));
  ipcMain.handle('trails-unignore', (_e, host) => changed(trailsDb().unignoreHost(String(host))));
  ipcMain.handle('trails-forget-all', () => changed(trailsDb().forgetAll()));
  ipcMain.handle('trails-info', () => {
    const s = store.getSettings();
    return { enabled: s.trails !== false, fresh: s.trailsFresh !== false, kilr: s.kilr !== false, ignored: trailsDb().data.ignoredHosts, everyday: trailsDb().everydaySites(),
      clients: s.trailsAllowedClients || [], chrome: chrome_.available() ? chrome_.profiles() : [] };
  });
  ipcMain.handle('trails-revoke-client', (_e, name) => {
    const s = store.getSettings();
    store.saveSettings({ ...s, trailsAllowedClients: (s.trailsAllowedClients || []).filter((c) => c !== name) });
    return true;
  });
  // History & bookmarks management, and resets.
  ipcMain.handle('data-history', (_e, { q = '', before = Infinity } = {}) => history.list({ q: String(q), before: Number(before) || Infinity }));
  ipcMain.handle('data-delete-pages', (_e, urls) => history.deleteUrls([].concat(urls || []).map(String)));
  ipcMain.handle('bookmark-delete', (_e, url) => {
    store.writeJson('bookmarks.json', store.readJson('bookmarks.json', []).filter((b) => b.url !== url));
    const n = memory.nodes.get(memory.pageId(url));
    if (n?.bookmarked) memory.upsert({ id: n.id, bookmarked: false });
    ui('bookmarks-changed');
    return true;
  });
  ipcMain.handle('bookmark-add', () => bookmarkActive());
  // Clear browsing data. since: a time (ms) or 0 for all time; history and research memory honour it. Cookies and the
  // cache can't be cleared by time in Chromium, so those go entirely.
  ipcMain.handle('data-reset', async (_e, what = {}) => {
    const done = [];
    const since = Number(what.since) || 0;
    const { session } = require('electron');
    if (what.history) {
      history.deleteSince(since);
      done.push('browsing history');
    }
    if (what.browsing) {
      await session.defaultSession.clearStorageData();
      done.push('cookies and site data');
    }
    if (what.cache) {
      await session.defaultSession.clearCache();
      done.push('cached images and files');
    }
    if (what.memory) {
      if (since) memory.forgetSince(since);
      else memory.forgetAll();
      done.push('research memory');
    }
    if (what.trails) {
      trailsDb().forgetAll();
      trailsChanged();
      done.push('trails');
    }
    if (what.bookmarks) {
      store.writeJson('bookmarks.json', []);
      done.push('bookmarks');
    }
    if (what.settings) {
      const keep = store.getSettings();
      store.saveSettings({ proSession: what.everything ? '' : keep.proSession, onboarded: !what.everything });
      applyTheme();
      done.push('settings');
    }
    ui('bookmarks-changed');
    pushStatus();
    return done.length ? `Cleared ${done.join(', ')}.` : 'Nothing selected.';
  });
  // Skillerr Pro licenses are Lemon Squeezy license keys, activated once per computer.
  ipcMain.handle('pro-status', async () => {
    try {
      return await fetch('https://skillerr.com/api/status', { signal: AbortSignal.timeout(4000) }).then((r) => r.json());
    } catch {
      return { signIn: false, pro: false, offline: true };
    }
  });
  ipcMain.on('pro-sign-in', () => shell.openExternal('https://skillerr.com/api/auth/google?app=1'));
  ipcMain.handle('pro-account', async () => {
    const token = store.getSettings().proSession;
    const info = token && sessionInfo(token);
    if (!info || info.exp < Date.now()) return { signedIn: false };
    try {
      const me = await fetch('https://skillerr.com/api/me', { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
      return { signedIn: !!me.signedIn, email: info.email, pro: !!me.pro, checkout: me.checkout };
    } catch {
      return { signedIn: true, email: info.email, pro: null };
    }
  });
  ipcMain.handle('pro-sign-out', () => {
    const s = store.getSettings();
    store.saveSettings({ ...s, proSession: '', ...(s.apiKey === s.proSession ? { apiKey: '', baseUrl: '' } : {}) });
    return true;
  });
  ipcMain.handle('pro-activate', async (_e, key) => {
    key = String(key || '').trim();
    if (!PRO_OPEN && !key.startsWith('sk1.')) return { ok: false, message: 'Skillerr Pro isn’t open yet.' };
    if (key.startsWith('sk1.')) {
      if (!sessionInfo(key)?.email) return { ok: false, message: 'That sign-in code isn’t valid.' };
      signInWith(key);
      return { ok: true, message: `Signed in as ${sessionInfo(key).email}.` };
    }
    if (!key) return { ok: false, message: 'Paste the license key from your Skillerr Pro receipt.' };
    if (/^vck_/.test(key)) return { ok: true, message: 'Using your Vercel AI Gateway key directly.' };
    try {
      const r = await fetch('https://api.lemonsqueezy.com/v1/licenses/activate', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ license_key: key, instance_name: `Skillerr on ${require('os').hostname()}` }),
      });
      const d = await r.json();
      if (!d.activated && !/already|limit/i.test(d.error || '')) return { ok: false, message: d.error || 'That license key didn’t activate.' };
      store.saveSettings({ ...store.getSettings(), proInstance: d.instance?.id || store.getSettings().proInstance });
      const who = d.meta?.customer_email ? ` for ${d.meta.customer_email}` : '';
      return { ok: true, message: `Skillerr Pro is active${who}.` };
    } catch (err) {
      return { ok: false, message: `Couldn’t reach the license server: ${err.message}` };
    }
  });
  ipcMain.handle('mem-taxonomy', () => memory.taxonomy());
  ipcMain.handle('mem-folder-open', (_e, id) => {
    const f = findFolder(memory.taxonomy(), String(id));
    if (!f) return { ok: false };
    const dir = writeResearchFolder(f);
    shell.openPath(dir);
    return { ok: true, dir };
  });
  ipcMain.handle('mem-folder-prompt', (_e, id) => {
    const f = findFolder(memory.taxonomy(), String(id));
    if (!f) return '';
    writeResearchFolder(f); // the prompt points at the folder, so make sure it exists
    const text = researchPrompt(f);
    clipboard.writeText(text);
    return text;
  });
  ipcMain.handle('mem-folder-skill', (_e, id) => {
    const f = findFolder(memory.taxonomy(), String(id));
    if (!f) return { ok: false, message: 'That folder is gone.' };
    try {
      const r = researchSkill(f);
      if (store.getSettings().shareSkillsWithClaudeCode) skills.shareWithClaudeCode();
      return { ok: true, name: r.skill.name, file: r.file };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });
  ipcMain.handle('mem-folders-root', () => {
    for (const f of memory.taxonomy()) writeResearchFolder(f);
    fs.mkdirSync(RESEARCH_DIR, { recursive: true });
    shell.openPath(RESEARCH_DIR);
    return RESEARCH_DIR;
  });
  ipcMain.handle('mem-recall', async (_e, q) => memory.recall(String(q || ''), { limit: 12, semantic: await similarTo(String(q || '')) }));
  ipcMain.handle('mem-graph', (_e, { pages = false } = {}) => memory.graph({ pages }));
  ipcMain.handle('mem-forget-node', (_e, id) => {
    const n = memory.nodes.get(String(id));
    if (!n) return false;
    if (n.type === 'session') return memory.forgetSession(n.id);
    memory.removeNode(n.id);
    return true;
  });
  ipcMain.handle('disconnect', async (_e, id) => {
    try {
      return { ok: true, message: await connectors.disconnect(id) };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });
  ipcMain.handle('set-client-blocked', (_e, { name, blocked: on }) => {
    const s = store.getSettings();
    const list = new Set(s.blockedClients || []);
    if (on) list.add(name);
    else list.delete(name);
    store.saveSettings({ ...s, blockedClients: [...list] });
    return [...list];
  });

  // The ⋮ menu in the toolbar: native, so it draws above web pages.
  ipcMain.on('app-menu', (_e, { x, y }) => {
    const s = store.getSettings();
    const sheet = (name) => () => {
      togglePanel(true);
      ui('open-sheet', name);
    };
    const open = (p) => () => {
      fs.mkdirSync(p, { recursive: true });
      shell.openPath(p);
    };
    Menu.buildFromTemplate([
      { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => newTab() },
      { label: 'Fleet View', accelerator: 'CmdOrCtrl+Shift+F', type: 'checkbox', checked: !!mosaic, click: () => (mosaic ? exitMosaic() : enterMosaic(tabs.map((t) => t.id))) },
      { type: 'separator' },
      { label: 'History', accelerator: 'CmdOrCtrl+Y', click: () => { openInternal('data'); ui('data-tab', 'history'); } },
      { label: 'Skillerr Orb', accelerator: 'CmdOrCtrl+Shift+Y', click: () => openInternal('memory') },
      { label: 'Trails', click: () => openInternal('trails') },
      { label: 'Bookmarks', click: () => { openInternal('data'); ui('data-tab', 'bookmarks'); } },
      { label: 'Bookmark This Page', accelerator: 'CmdOrCtrl+D', click: () => bookmarkActive() },
      { label: 'Skills…', click: sheet('skills') },
      { label: 'Connected AI Apps…', click: sheet('connect') },
      { label: 'Import from Chrome…', click: sheet('settings') },
      { label: 'Sign in with Google', click: () => newTab('https://accounts.google.com/signin') },
      { type: 'separator' },
      {
        label: 'Appearance',
        submenu: ['system', 'light', 'dark'].map((t) => ({
          label: t === 'system' ? 'Match System' : t[0].toUpperCase() + t.slice(1), type: 'radio', checked: (s.theme || 'system') === t,
          click: () => {
            store.saveSettings({ ...store.getSettings(), theme: t });
            applyTheme(t);
          },
        })),
      },
      { type: 'separator' },
      { label: status.paused ? 'Resume AI' : 'Pause AI', accelerator: 'CmdOrCtrl+Shift+P', click: () => setPaused(!status.paused) },
      { label: 'Remember Research', type: 'checkbox', checked: s.remember !== false, click: (item) => store.saveSettings({ ...store.getSettings(), remember: item.checked }) },
      { type: 'separator' },
      { label: 'Clear Browsing Data…', accelerator: 'CmdOrCtrl+Shift+Backspace', click: () => { openInternal('data'); ui('data-tab', 'clear'); } },
      { label: 'Recordings Folder', click: open(path.join(app.getPath('videos'), 'Skillerr')) },
      { label: 'Notes Folder', click: open(NOTES_DIR) },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: sheet('settings') },
      { label: 'About Skillerr', click: () => newTab('https://skillerr.com') },
      { label: 'Uninstall Skillerr…', click: () => uninstallSkillerr() },
    ]).popup({ window: win, x: Math.round(x), y: Math.round(y) });
  });
  ipcMain.handle('mem-forget-session', (_e, id) => memory.forgetSession(String(id)));
  ipcMain.handle('mem-forget-all', () => {
    memory.forgetAll();
    embedder.forgetAll();
    return memory.stats();
  });
  ipcMain.on('agent-run', (_e, task) => {
    if (status.paused) return ui('agent', { type: 'error', text: 'AI control is paused. Resume to continue.' });
    if (agent.running) return ui('agent', { type: 'error', text: 'Already working on a task. Stop it first.' });
    runAgent(expandSkill(String(task)));
  });
  ipcMain.on('agent-stop', () => agent.stop());
  ipcMain.handle('agent-ready', () => agentReady());
  ipcMain.handle('get-settings', () => store.getSettings());
  ipcMain.handle('save-settings', (_e, s) => {
    store.saveSettings({ ...store.getSettings(), ...s });
    if (s.shareSkillsWithClaudeCode === true) skills.shareWithClaudeCode();
    if (s.theme) applyTheme(s.theme);
    if ('trails' in s) trailsChanged(); // the shelf shows or hides
    if ('kilr' in s && trailStore) trailStore.meaning = s.kilr !== false ? kilrMeaning : null;
    if (s.searchEngine) setSearchTemplate(searchTemplateFor(s.searchEngine));
    if ('searchApi' in s || 'searchApiKey' in s) applySearchApi();
    status.requireApproval = !!store.getSettings().requireApproval;
    pushStatus();
    return store.getSettings();
  });
  ipcMain.handle('mcp-config', () => JSON.stringify({ mcpServers: { skillerr: mcpEntry() } }, null, 2));
  ipcMain.handle('connect-targets', async () => {
    await reconciling; // never show a leftover connection as connected
    return connectors.listTargets();
  });
  ipcMain.handle('restart-claude-desktop', async () => {
    try {
      return { ok: true, message: await connectors.restartClaudeDesktop() };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });
  ipcMain.handle('connect', async (_e, id) => {
    // A connection saves the path of this app; from a disk image or Downloads that path won't last.
    if (app.isPackaged && process.platform === 'darwin' && !app.isInApplicationsFolder()) {
      return { ok: false, message: 'Move Skillerr to your Applications folder first (Skillerr can do it for you when it starts).' };
    }
    try {
      const message = await connectors.connect(id, mcpEntry());
      // Connecting Claude Code is the moment to also make Skillerr's skills available there (a visible switch in Settings).
      if (id === 'claude-code' && store.getSettings().shareSkillsWithClaudeCode === undefined) {
        store.saveSettings({ ...store.getSettings(), shareSkillsWithClaudeCode: true });
        skills.shareWithClaudeCode();
      }
      return { ok: true, message };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });
  ipcMain.handle('detect-local', () => connectors.detectLocalModels());
  ipcMain.on('copy', (_e, text) => clipboard.writeText(String(text)));

  // skills
  ipcMain.handle('skills-list', () => skills.list());
  ipcMain.handle('skills-pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Install a skill',
      message: 'Choose a skill folder (one with a SKILL.md)',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Skills', extensions: ['skill', 'md'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    let file = r.filePaths[0];
    if (path.basename(file) === 'SKILL.md') file = path.dirname(file);
    try {
      return { ok: true, ...(await skills.inspect(file)) };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });
  ipcMain.handle('skills-install', (_e, staging) => {
    try {
      const skill = skills.install(String(staging));
      if (store.getSettings().shareSkillsWithClaudeCode) skills.shareWithClaudeCode();
      return { ok: true, skill };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });
  ipcMain.handle('skills-remove', (_e, name) => {
    try {
      skills.remove(name);
      if (store.getSettings().shareSkillsWithClaudeCode) skills.shareWithClaudeCode();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });

  // recordings: the user can always stop one; only files Skillerr saved can be opened from the panel
  ipcMain.on('rec-stop-user', () => recorder?.active && recorder.stop().catch(() => {}));
  ipcMain.on('open-output', (_e, { file, reveal }) => {
    const roots = [path.join(app.getPath('videos'), 'Skillerr') + path.sep, NOTES_DIR + path.sep, skills.USER_DIR + path.sep, path.join(app.getPath('pictures'), 'Skillerr') + path.sep];
    const p = path.resolve(String(file || ''));
    if (!roots.some((r) => p.startsWith(r))) return;
    if (reveal) shell.showItemInFolder(p);
    else shell.openPath(p);
  });
  ipcMain.on('ui-ready', () => {
    traceStartup('browser UI interactive');
    pushTabs();
    lastShelf = '';
    setTimeout(() => { try { pushShelf(); } catch {} }, 300); // after the first paint: it reads the trails file
    pushStatus();
    ui('panel', panelOpen);
  });
}

// ---------------- updates and notices from skillerr.com ----------------
// Asks skillerr.com/api/update (driven by site/updates.json) whether there's a newer version or a notice.
// Sends only this version and the platform: no id, no usage. Early builds aren't signed, so we point to the
// download instead of replacing the app in place.
const UPDATE_API = process.env.SKILLERR_UPDATE_API || 'https://skillerr.com/api/update'; // env: test against staging or a local server
const isNewer = (a, b) => {
  const pa = String(a).split(/[.-]/).map((n) => parseInt(n, 10) || 0), pb = String(b).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
};
const trustedUpdateUrl = (u) => { try { return /(^|\.)(skillerr\.com|github\.com)$/.test(new URL(u).hostname) && u.startsWith('https://'); } catch { return false; } };
// In-place updates (electron-updater, from the releases repo) where the OS will accept them: Windows, the Linux
// AppImage, and macOS builds signed with a Developer ID (Squirrel.Mac refuses ad-hoc signatures). Elsewhere the
// notice above points to the download.
// The packaged app's package.json carries build facts (scripts/build.mjs): signed, passkey keychain group.
function appMeta() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}
const signedBuild = () => appMeta().skillerrSigned === true;
let updater = null;
function autoUpdater() {
  if (updater !== null) return updater;
  updater = false;
  if (!app.isPackaged || process.env.SKILLERR_NO_AUTOUPDATE) return updater;
  if (process.platform === 'linux' ? !process.env.APPIMAGE : process.platform === 'darwin' ? !signedBuild() : process.platform !== 'win32') return updater;
  try {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.logger = null;
    updater.on('update-downloaded', (info) => {
      const id = `v${info.version}`;
      if (!(store.getSettings().dismissedNotices || []).includes(id)) ui('update', { id, version: info.version, text: 'Restart Skillerr to finish updating.', restart: true });
    });
    updater.on('error', () => {}); // offline or no release yet; the next check tries again
  } catch {
    updater = false;
  }
  return updater;
}

async function checkForUpdates(manual = false) {
  if (!manual && store.getSettings().updateChecks === false) return;
  const version = app.getVersion();
  const auto = autoUpdater();
  let autoFound = null, autoOk = false;
  if (auto) {
    // Staging builds (develop → "beta" prereleases on the releases repo) only reach people who opted in, and beta builds.
    auto.allowPrerelease = store.getSettings().betaUpdates === true || /-beta\./.test(version);
    try {
      const r = await auto.checkForUpdates();
      autoOk = !!r;
      autoFound = r?.updateInfo?.version && isNewer(r.updateInfo.version, version) ? r.updateInfo.version : null;
    } catch {}
  }
  let d = null;
  try {
    const q = new URLSearchParams({ v: version, os: process.platform, arch: process.arch });
    const r = await fetch(`${UPDATE_API}?${q}`, { signal: AbortSignal.timeout(10000) });
    if (r.ok) d = await r.json();
  } catch {}
  const seen = manual ? [] : store.getSettings().dismissedNotices || [];
  // With in-place updates the chip appears once the download is ready (update-downloaded), not as a link.
  const update = !auto && d?.latest && isNewer(d.latest, version) && trustedUpdateUrl(d.url) && !seen.includes(`v${d.latest}`)
    ? { id: `v${d.latest}`, version: d.latest, text: String(d.notes || '').slice(0, 200), url: d.url } : null;
  const m = d?.message;
  const notice = m?.id && m.text && !seen.includes(m.id) && (!m.below || isNewer(m.below, version)) && (!m.url || trustedUpdateUrl(m.url))
    ? { id: String(m.id), text: String(m.text).slice(0, 200), url: m.url || '' } : null;
  const show = update || notice;
  if (show) ui('update', show);
  if (manual && autoFound) {
    dialog.showMessageBox(win, { type: 'info', message: `Skillerr ${autoFound} is downloading.`, detail: "You'll be asked to restart when it's ready.", buttons: ['OK'] });
  } else if (manual && !update) {
    dialog.showMessageBox(win, { type: 'info', message: d || autoOk ? `Skillerr ${version} is the latest version.` : "Couldn't reach skillerr.com to check for updates.", buttons: ['OK'] });
  }
}

// ---------------- uninstall ----------------
// Deleting the app alone leaves Skillerr connected in Claude Desktop, Claude Code and Cursor (and Claude Code's own
// web tools off, with --prefer). This undoes all of that, then removes the app the way the platform expects.
async function uninstallSkillerr() {
  const { response, checkboxChecked: purge } = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Uninstall', 'Cancel'], defaultId: 1, cancelId: 1,
    message: 'Uninstall Skillerr?',
    detail: 'Skillerr disconnects itself from Claude Desktop, Claude Code and Cursor, gives Claude Code its own web tools back, ' +
      'and then removes itself. Your notes and research folders in ~/Skillerr stay.',
    checkboxLabel: 'Also delete my settings, research memory, skills and browsing data',
  });
  if (response !== 0) return;
  for (const id of await connectors.withEntries()) await connectors.disconnect(id).catch(() => {});
  try {
    if (require('./prefer').isPreferred()) require('./prefer').setPrefer(false);
  } catch {}
  const userData = app.getPath('userData'); // cookies, cache and site data: removed after Skillerr has quit
  if (purge) {
    quitSnapshotDone = true; // nothing is written back after the data is gone
    clearTimeout(trailStore?.timer);
    trailStore = null;
    fs.rmSync(store.DIR, { recursive: true, force: true });
  }
  const later = (cmd) => require('child_process').spawn('/bin/sh', ['-c', `sleep 2; ${cmd}`], { detached: true, stdio: 'ignore' }).unref();
  const q = (p) => `'${String(p).replace(/'/g, "'\\''")}'`;
  if (!app.isPackaged) {
    await dialog.showMessageBox(win, { type: 'info', message: 'Skillerr is disconnected from your AI apps.', detail: 'It runs from source here, so delete its folder yourself.' });
  } else if (process.platform === 'darwin') {
    const bundle = path.resolve(process.execPath, '..', '..', '..'); // …/Skillerr.app
    if (bundle.endsWith('.app')) await shell.trashItem(bundle).catch(() => {});
    if (purge) later(`rm -rf ${q(userData)}`);
  } else if (process.platform === 'win32') {
    // The NSIS uninstaller removes the app (and runs setup.js --uninstall again, harmlessly).
    const uninstaller = path.join(path.dirname(process.execPath), 'Uninstall Skillerr.exe');
    if (fs.existsSync(uninstaller)) require('child_process').spawn(uninstaller, purge ? ['/S', '--delete-app-data'] : ['/S'], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.env.APPIMAGE) {
    await dialog.showMessageBox(win, { type: 'info', message: 'Skillerr is disconnected from your AI apps.', detail: `Delete the AppImage to finish:\n${process.env.APPIMAGE}` });
    if (purge) later(`rm -rf ${q(userData)}`);
  } else {
    // Installed by install.sh into ~/.local/share/skillerr.
    const dir = path.join(app.getPath('home'), '.local', 'share', 'skillerr');
    const rm = [path.join(dir, 'app'), path.join(app.getPath('home'), '.local', 'bin', 'skillerr'), path.join(app.getPath('home'), '.local', 'share', 'applications', 'skillerr.desktop')];
    if (process.execPath.startsWith(dir)) later(`rm -rf ${rm.map(q).join(' ')}${purge ? ` ${q(userData)}` : ''}`);
  }
  app.quit();
}

// ---------------- app lifecycle ----------------

function buildMenu() {
  const guard = (fn) => () => win && fn();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'Skillerr', submenu: [
      { role: 'about' },
      { label: 'Check for Updates…', click: () => checkForUpdates(true) },
      { label: 'Uninstall Skillerr…', click: () => uninstallSkillerr() },
      { type: 'separator' }, { role: 'services' },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit' },
    ] }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: guard(() => newTab()) },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: guard(() => activeTab() && closeTab(activeTabId)) },
        { label: 'Open Location…', accelerator: 'CmdOrCtrl+L', click: guard(() => ui('focus-url')) },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: guard(() => closedTabs.length && newTab(closedTabs.pop())) },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: guard(() => activeTab()?.view.webContents.print()) },
        { label: 'History', accelerator: 'CmdOrCtrl+Y', click: guard(() => { openInternal('data'); ui('data-tab', 'history'); }) },
        { label: 'Skillerr Orb', accelerator: 'CmdOrCtrl+Shift+Y', click: guard(() => openInternal('memory')) },
        { label: 'Bookmarks', click: guard(() => { openInternal('data'); ui('data-tab', 'bookmarks'); }) },
        { label: 'Trails', accelerator: 'CmdOrCtrl+Shift+L', click: guard(() => openInternal('trails')) },
        { label: 'Bookmark This Page', accelerator: 'CmdOrCtrl+D', click: guard(() => bookmarkActive()) },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: guard(() => ui('find-open')) },
        { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: guard(() => ui('find-next', true)) },
        { label: 'Find Previous', accelerator: 'CmdOrCtrl+Shift+G', click: guard(() => ui('find-next', false)) },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: guard(() => activeTab()?.view.webContents.reload()) },
        { type: 'separator' },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: guard(() => zoom(0)) },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: guard(() => zoom(1)) },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', visible: false, acceleratorWorksWhenHidden: true, click: guard(() => zoom(1)) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: guard(() => zoom(-1)) },
        { type: 'separator' },
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: guard(() => activeTab()?.view.webContents.navigationHistory.goBack()) },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: guard(() => activeTab()?.view.webContents.navigationHistory.goForward()) },
        { type: 'separator' },
        {
          label: 'Fleet View', accelerator: 'CmdOrCtrl+Shift+F',
          click: guard(() => (mosaic ? exitMosaic() : enterMosaic(tabs.map((t) => t.id)))),
        },
        { type: 'separator' },
        { label: 'Page Developer Tools', accelerator: 'Alt+CmdOrCtrl+I', click: guard(() => activeTab()?.view.webContents.openDevTools({ mode: 'detach' })) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'AI',
      submenu: [
        { label: 'Ask Skillerr…', accelerator: 'CmdOrCtrl+K', click: guard(() => { togglePanel(true); ui('focus-composer'); }) },
        { label: 'Toggle Pilot Panel', accelerator: 'CmdOrCtrl+J', click: guard(() => togglePanel()) },
        { label: 'Pause / Resume AI', accelerator: 'CmdOrCtrl+Shift+P', click: guard(() => setPaused(!status.paused)) },
      ],
    },
    {
      label: 'Tab',
      submenu: [
        ...Array.from({ length: 8 }, (_, i) => ({ label: `Tab ${i + 1}`, accelerator: `CmdOrCtrl+${i + 1}`, click: guard(() => tabs[i] && switchTab(tabs[i].id)) })),
        { label: 'Last Tab', accelerator: 'CmdOrCtrl+9', click: guard(() => tabs.length && switchTab(tabs[tabs.length - 1].id)) },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: guard(() => { const i = tabs.findIndex((t) => t.id === activeTabId); tabs.length && switchTab(tabs[(i + 1) % tabs.length].id); }) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: guard(() => { const i = tabs.findIndex((t) => t.id === activeTabId); tabs.length && switchTab(tabs[(i - 1 + tabs.length) % tabs.length].id); }) },
      ],
    },
    { role: 'windowMenu' },
    ...(process.platform === 'darwin' ? [] : [{ label: 'Help', submenu: [{ label: 'Check for Updates…', click: () => checkForUpdates(true) }, { label: 'Uninstall Skillerr…', click: () => uninstallSkillerr() }] }]),
  ]));
}

const chromeBg = () => (nativeTheme.shouldUseDarkColors ? '#0c0c10' : '#e9ebef');

// The floating AI status bar over the page ("Claude is driving", approvals, Take over). Loaded after the first tab so it
// never holds up start-up; once loaded it's sent the current state, including approvals already waiting.
function createStatusBar() {
  hud = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } });
  hud.setBackgroundColor('#00000000');
  hud.setVisible(false);
  hud.webContents.on('will-navigate', (e) => e.preventDefault());
  hud.webContents.once('did-finish-load', () => {
    hud.webContents.send('status', { ...status });
    for (const id of pendingApprovals.keys()) if (recentSteps.has(id)) hud.webContents.send('log', recentSteps.get(id));
    pushStatus();
    traceStartup('status bar loaded');
  });
  hud.webContents.loadFile(path.join(__dirname, 'ui', 'hud.html'));
  win.contentView.addChildView(hud);
  if (captionView) win.contentView.addChildView(captionView); // captions stay on top
  layout();
}

// Recording captions: a layer created the first time a recording shows one, not at start-up.
let captionLoading = null;
function captionLayer() {
  if (!captionLoading) {
    captionView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } });
    captionView.setBackgroundColor('#00000000');
    captionView.setVisible(false);
    captionView.webContents.on('will-navigate', (e) => e.preventDefault());
    win.contentView.addChildView(captionView);
    layout();
    captionLoading = captionView.webContents.loadFile(path.join(__dirname, 'ui', 'caption.html')).then(() => captionView);
  }
  return captionLoading;
}

// Opened from the installer window or Downloads? Offer to move into Applications, so connections keep working.
function offerMoveToApplications() {
  if (!app.isPackaged || process.platform !== 'darwin' || app.isInApplicationsFolder()) return false;
  const choice = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['Move to Applications', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    message: 'Move Skillerr to your Applications folder?',
    detail: 'Skillerr is running from the installer or Downloads. Moving it lets Claude Desktop, Claude Code and Cursor connect to it reliably.',
  });
  if (choice !== 0) return false;
  try {
    return app.moveToApplicationsFolder(); // relaunches from /Applications
  } catch (err) {
    dialog.showErrorBox('Couldn’t move Skillerr', `${err.message}\n\nDrag Skillerr into Applications yourself, then open it from there.`);
    return false;
  }
}

app.whenReady().then(async () => {
  traceStartup('app ready');
  if (offerMoveToApplications()) return;
  startWidevine();
  applyTheme();
  setSearchTemplate(searchTemplateFor());
  applySearchApi();
  wirePermissions(require('electron').session.defaultSession);
  setupPasskeys(require('electron').session.defaultSession);
  if (process.platform === 'darwin') app.dock?.setIcon(path.join(__dirname, '..', 'assets', 'icon.png'));
  win = new BaseWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 560,
    title: 'Skillerr',
    backgroundColor: chromeBg(),
    // macOS: traffic lights inset in the tab strip. Windows/Linux: our own chrome, with the system's window buttons drawn over it.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 15 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#a4a4b2', height: 42 }, icon: path.join(__dirname, '..', 'assets', 'icon.png') }),
  });
  if (process.platform !== 'darwin') win.setMenuBarVisibility(false); // shortcuts still work; the ⋮ menu has everything
  nativeTheme.on('updated', () => {
    win.setBackgroundColor(chromeBg());
    redrawTabs(); // the theme changed (in Skillerr or in the OS): redraw every tab too
  });
  chrome = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } });
  chrome.setBackgroundColor('#00000000');
  // The chrome UI must never navigate away; links it shows open as tabs.
  chrome.webContents.on('will-navigate', (e) => e.preventDefault());
  chrome.webContents.setWindowOpenHandler(({ url }) => {
    newTab(url);
    return { action: 'deny' };
  });
  win.contentView.addChildView(chrome);
  win.on('resize', layout);
  win.on('focus', () => process.platform !== 'darwin' && win.flashFrame(false)); // stop the taskbar flash from a robot check
  win.on('close', snapshotForQuit); // while the tabs still exist
  win.on('closed', () => app.quit());
  wireIpc();
  buildMenu();
  setTimeout(() => embedder.index(), 20000); // semantic recall: embed what's new, if a local model is running
  setInterval(() => embedder.index(), 10 * 60 * 1000);
  setTimeout(checkForUpdates, 15000); // after start-up settles, then twice a day
  setInterval(checkForUpdates, 12 * 3600 * 1000);
  layout();
  traceStartup('window created');
  // Separate profiles (SKILLERR_PROFILE, for demos and tests) never touch the AI apps' real connections.
  if (!store.PROFILE) reconciling = connectors.reconcile({ freshData }).catch(() => []);
  // AI apps can connect while the UI is still loading: the local API starts now, and calls wait until the browser is ready.
  let markReady;
  const ready = new Promise((resolve) => (markReady = resolve));
  const apiStarting = startApiServer({
    tools: TOOLS,
    onPreview: async (client, op, args) => {
      await ready;
      return op === 'action' ? previewAction(client, args) : op === 'audit' ? previewAudit(client) : previewFrame(client, args);
    },
    onHello: (client) => ready.then(() => markActive({ name: client, via: 'mcp' })),
    onCall: async (client, name, args) => {
      await ready;
      const r = await execute({ name: client, via: 'mcp' }, name, args);
      return { text: r.text, image: r.image };
    },
  }).then((api) => {
    store.writeSession({ port: api.port, token: api.token, pid: process.pid });
    traceStartup('local API ready (AI apps can connect)');
  });

  await chrome.webContents.loadFile(path.join(__dirname, 'ui', 'index.html'));
  traceStartup('browser UI loaded');
  chrome.webContents.focus();

  recorder = new Recorder({
    ui,
    chromeWc: chrome.webContents,
    windowSource: () => ({ sourceId: win.getMediaSourceId(), size: win.getContentSize() }),
    showCaption: (text) => {
      if (!text && !captionView) return;
      captionLayer().then((view) => {
        view.setVisible(!!text);
        view.webContents.send('caption', text);
      });
    },
    onChange: () => {
      status.recording = recorder.info();
      pushStatus();
    },
  });

  newTab();
  // Each launch starts with a clean tab strip; last time's tabs wait in their trails (on the shelf). Unless the user
  // asked for them back every time.
  if (store.getSettings().trailsFresh === false && learningTrails()) {
    try {
      restoreLastSession();
    } catch {}
  }
  traceStartup('first tab open');
  markReady();
  reconciling.then((removed) => removed.length && ui('connections-reset', removed));
  createStatusBar(); // not awaited: it only matters once an AI connects, and catches up on the state when loaded
  await apiStarting;
  // Warm research memory and the embedding index in the background, after the window is usable.
  setTimeout(() => {
    memory.load();
    traceStartup(`research memory loaded (${memory.nodes.size} nodes)`);
  }, 250);
  const coldLink = process.argv.find((a) => a.startsWith('skillerr://'));
  if (coldLink) handleDeepLink(coldLink);
});

app.on('second-instance', (_e, argv) => {
  const link = argv.find((a) => a.startsWith('skillerr://')); // Windows/Linux deliver the link here
  if (link) handleDeepLink(link);
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// Protected video (Netflix, Disney+, Spotify and the like): Skillerr runs on castlabs' Electron for Content Security,
// which fetches Google's Widevine module on first launch and keeps it updated. Not awaited: browsing starts at once, and
// streaming sites play as soon as it's in place (a page opened before that plays after a reload).
let widevine = 'unavailable';
function startWidevine() {
  const { components } = require('electron');
  if (!components) return; // a stock Electron (development without the castlabs build)
  widevine = 'installing';
  components.whenReady()
    .then(() => (widevine = 'ready'))
    .catch(() => (widevine = 'failed')) // offline on first launch: it tries again next time
    .finally(() => traceStartup(`widevine ${widevine}`));
}

app.on('before-quit', snapshotForQuit);
app.on('will-quit', () => {
  store.clearSession();
  try {
    history.flush();
  } catch {}
  try {
    if (trailStore?.timer) trailStore.save(); // write what was learned in the last moments
  } catch {}
});
app.on('window-all-closed', () => app.quit());
