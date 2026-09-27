const fs = require('fs');
const path = require('path');
const { app, BaseWindow, WebContentsView, ipcMain, Menu, clipboard, nativeTheme, dialog, shell } = require('electron');
const { TOOLS, runTool, toUrl, setSearchTemplate, inspectTarget, restoreValue } = require('./tools');
const { startApiServer } = require('./api-server');
const { Agent } = require('./agent');
const connectors = require('./connect');
const skills = require('./skills');
const { Recorder } = require('./recorder');
const store = require('./store');
const { Memory, recallText, tokens } = require('./memory');
const chrome_ = require('./chrome-import');

const memory = new Memory(path.join(store.DIR, 'memory'));
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
        await rememberPage(controller, getTab(id), part.split('\n').slice(1).join('\n'));
      }
    } else if (name === 'open_tabs') {
      const ids = [];
      for (const m of String(result.text || '').matchAll(/tab (\d+):/g)) ids.push(await rememberPage(controller, getTab(Number(m[1]))));
      memory.openedTogether(ids); // one cluster of attention
    } else if (name === 'read_page') {
      await rememberPage(controller, tab, info?.sensitive ? '' : result.text);
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
  store.saveSettings({ ...s, proSession: token, pane: 'cloud', provider: 'openai-compatible', baseUrl: PRO_API, apiKey: token,
    model: s.proModel || 'anthropic/claude-sonnet-5' });
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
}

// ---------------- tabs ----------------

function tabInfo(t) {
  if (t.sleeping) {
    return { id: t.id, title: t.sleeping.title, url: t.sleeping.url, internal: null, isStart: false, loading: false, favicon: t.sleeping.favicon,
      canGoBack: false, canGoForward: false, active: t.id === activeTabId, tiled: false, ai: false, asleep: true,
      group: t.groupId && groups.has(t.groupId) ? groupInfo(groups.get(t.groupId)) : null };
  }
  const wc = t.view.webContents;
  return {
    id: t.id,
    title: t.internal === 'memory' ? 'Research memory' : t.internal === 'data' ? 'History & Bookmarks' : t.isStart ? 'New Tab' : wc.getTitle() || wc.getURL() || 'Loading…',
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
  return { id: g.id, title: goal || g.controller, controller: g.controller, color: g.color };
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
  pushTabs();
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
  });
  wc.setWindowOpenHandler(({ url: target }) => {
    let host = '';
    try {
      host = new URL(wc.getURL()).hostname;
    } catch {}
    if (Date.now() - tab.lastInput < 1500 || store.getSettings().popupsAllowed?.[host]) newTab(target);
    else ui('popup-blocked', { tabId: tab.id, host, url: target });
    return { action: 'deny' };
  });
  wc.on('context-menu', (_e, params) => showPageMenu(tab, params));
  // Passkeys need an Apple-notarized browser entitlement, which early builds don't have: when a site asks for one,
  // explain it and offer the site's other sign-in route instead of leaving the user stuck.
  wc.on('dom-ready', () => wc.executeJavaScript(PASSKEY_WATCH_JS).catch(() => {}));
  wc.on('did-navigate', (_e, u) => /accounts\.google\.com\/.*\/challenge\/pk/.test(u || '') && passkeyHelp(tab));
  wc.on('console-message', (...a) => {
    const msg = typeof a[0] === 'object' && a[0]?.message !== undefined ? a[0].message : a[2];
    if (msg === '__skillerr_passkey__') passkeyHelp(tab);
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
  // Chromium remembers zoom per site; Skillerr keeps it per tab instead (fleet tiles zoom out, the user's zoom stays theirs).
  wc.on('did-navigate', () => wc.setZoomFactor(tab.zoom || tab.userZoom || 1));
  wc.on('page-favicon-updated', (_e, favicons) => {
    tab.favicon = favicons[0];
    pushTabs();
  });
  win.contentView.addChildView(view);
  return view;
}

function newTab(url, { background = false } = {}) {
  const tab = { id: nextTabId++, view: null, favicon: null, isStart: !url, userZoom: 1, lastInput: 0, lastUsed: Date.now() };
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
function applyVisibility() {
  const shown = tabs.filter(isShown);
  for (const t of tabs) if (t.view && !shown.includes(t)) win.contentView.addChildView(t.view);
  if (chrome) win.contentView.addChildView(chrome);
  for (const t of shown) win.contentView.addChildView(t.view);
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
function enterMosaic(ids) {
  const list = ids.filter((id) => getTab(id) && !getTab(id).isStart).slice(0, 9);
  for (const id of list) if (getTab(id).sleeping) wake(getTab(id)); // tiles must be live
  if (list.length < 2) return false;
  mosaic = list;
  if (!list.includes(activeTabId)) activeTabId = list[0];
  applyVisibility();
  pushTabs();
  return true;
}

function exitMosaic() {
  if (!mosaic) return;
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
const PASSKEY_WATCH_JS = `(() => {
  if (window.__skPk || !navigator.credentials) return;
  window.__skPk = 1;
  const c = navigator.credentials;
  for (const k of ['get', 'create']) {
    const orig = c[k].bind(c);
    c[k] = (o) => { if (o && o.publicKey) console.info('__skillerr_passkey__'); return orig(o); };
  }
})()`;
function passkeyHelp(tab) {
  if (tab.passkeyShownFor === tab.view.webContents.getURL()) return;
  tab.passkeyShownFor = tab.view.webContents.getURL();
  let host = '';
  try {
    host = new URL(tab.view.webContents.getURL()).hostname;
  } catch {}
  ui('passkey-help', { tabId: tab.id, host });
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
      { label: 'Bookmark This Page', click: () => bookmarkActive() }, { label: 'Print…', click: () => wc.print() });
  }
  items.push({ type: 'separator' }, { label: 'Inspect Element', click: () => wc.inspectElement(p.x, p.y) });
  Menu.buildFromTemplate(items).popup({ window: win });
}

// Site permissions (camera, mic, location, notifications…): ask once per site, like Chrome, and remember.
const ASK = { media: 'use your camera or microphone', geolocation: 'know your location', notifications: 'show notifications', midi: 'use MIDI devices',
  midiSysex: 'use MIDI devices', 'clipboard-read': 'read your clipboard', 'display-capture': 'share your screen', idleDetection: 'know when you are idle',
  hid: 'use HID devices', serial: 'use serial ports', usb: 'use USB devices' };
const ALWAYS = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock', 'window-management']);
function wirePermissions(ses) {
  const fromUs = (wc) => wc && ((chrome && wc === chrome.webContents) || (hud && wc === hud.webContents) || (captionView && wc === captionView.webContents));
  const originOf = (u) => {
    try {
      return new URL(u).origin;
    } catch {
      return '';
    }
  };
  ses.setPermissionCheckHandler((wc, permission, origin) => {
    if (fromUs(wc) || ALWAYS.has(permission)) return true;
    return store.getSettings().sitePermissions?.[originOf(origin)]?.[permission] === 'allow';
  });
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (fromUs(wc) || ALWAYS.has(permission)) return callback(true); // Skillerr's own UI (e.g. the recorder)
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
  if (tab) tab.view.webContents.loadURL(toUrl(input)).catch(() => {});
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
    if (t?.sleeping) await wake(t);
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
const READ_ONLY = new Set(['web_search', 'fetch_page', 'save_screenshot', 'open_view', 'snapshot', 'read_page', 'screenshot', 'list_tabs', 'wait', 'read_tabs', 'list_skills', 'use_skill', 'caption', 'record_stop', 'show_tabs', 'save_note', 'recall', 'tag_session', 'my_research', 'read_note']);
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
  return true;
}

const blocked = (controller) => controller.via === 'mcp' && (store.getSettings().blockedClients || []).includes(controller.name);

async function execute(controller, name, args) {
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
  const tab = targetTab(args);
  if (tab?.sleeping || tab?.waking) await browser.awake(tab); // an AI touching a sleeping tab wakes it first
  const info = await inspectTarget(browser, name, args, id);
  const entry = { id, ts: Date.now(), controller: controller.name, via: controller.via, tool: name, args, target: info?.label || '', tabId: tab?.id, state: 'running' };
  if (name === 'record_start' || name === 'record_stop') entry.tabId = null; // not a page action, nothing to highlight

  if (['click', 'type', 'press_key'].includes(name) && (CHECK_FRAME.test(info?.frameUrl || '') || CHECK_LABEL.test(info?.label || ''))) {
    await humanCheck(controller, tab);
    throw new Error('That is a robot check. Only the user may complete it: Skillerr has asked them to. Wait, then take a new snapshot.');
  }

  // Sensitive actions always need a human, even with approval mode off. Enforced here, not by the prompt.
  // A learned skill steers every future task, so a page can't be allowed to plant one unseen.
  if (name === 'save_skill') entry.target = String(args.name || '');
  const reason = name === 'save_skill' ? `Skills change how AIs work on future tasks. “${trunc(args.description, 140)}”`
    : info?.sensitive ? `This looks like ${info.sensitive}.` : status.requireApproval && !READ_ONLY.has(name) ? null : undefined;
  if (reason !== undefined) {
    const ok = await requestApproval(entry, reason);
    if (!ok) {
      ui('log', { ...entry, state: 'error', summary: ok === null ? 'No one approved in time' : 'You declined this action' });
      throw new Error(ok === null
        ? 'This action needs the user\'s approval in Skillerr and nobody approved it in time. Ask the user to watch Skillerr and approve, then retry.'
        : 'The user declined this action. Do not retry it.');
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
    captureUndo(entry, name, args, tab, before, info);
    capture(controller, name, args, tab, result, info);
    // Group what this AI opened (and a fresh tab it started working in) under its current research task.
    const opened = tabs.filter((t) => !before.tabIds.includes(t.id)).map((t) => t.id);
    if (opened.length) assignGroup(controller, opened);
    if ((name === 'navigate' && tab && before.wasStart) || name === 'fetch_page') assignGroup(controller, [tab.id]);
    if (['navigate', 'click', 'snapshot', 'new_tab', 'type', 'press_key'].includes(name) && (await humanCheck(controller, name === 'new_tab' ? activeTab() : tab))) {
      result.text = `${result.text || ''}\n\nThis page is showing a robot check. Skillerr has asked the user to complete it. Don't try to solve or click it; wait for them, then take a new snapshot.`;
    }
    return result;
  } catch (err) {
    ui('log', { ...entry, state: 'error', summary: err.message });
    throw err;
  } finally {
    touchTab(tab);
    markActive(controller);
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
    const items = memory.recall(String(args.query || ''), { excludeSession: sid });
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
        'Use recall to search it. The user can browse it in Skillerr → ⋮ → Research Memory.',
    ].join('\n') };
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
    if (v === 'memory' || v === 'folders' || v === 'history' || v === 'bookmarks') {
      openInternal(v === 'memory' || v === 'folders' ? 'memory' : 'data');
      if (v === 'folders') setTimeout(() => ui('memory-mode', { mode: 'folders', query: args.query || '' }), 300);
      if (v === 'bookmarks') ui('data-tab', 'bookmarks');
      if (v === 'memory' && args.query) setTimeout(() => ui('memory-search', String(args.query)), 400);
    } else if (['settings', 'skills', 'connect'].includes(v)) {
      togglePanel(true);
      ui('open-sheet', v);
    } else if (v === 'panel') {
      togglePanel(true);
      ui('close-sheets');
    } else throw new Error('view must be memory, folders, history, bookmarks, settings, skills, connect or panel.');
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
  let frontier = (args.urls || []).slice(0, 6).map((u) => ({ url: toUrl(u), from: null, fromUrl: null }));
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
        report.push({ level, title: wc.getTitle(), url: wc.getURL(), from: chunk[j]?.from, text: passages(texts.get(id), q) });
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
  const byLevel = report.map((r) => `### ${r.level === 0 ? 'Start' : `Hop ${r.level}`}: ${r.title}\n${r.url}${r.from ? `\n(followed from “${r.from}”)` : ''}\n${r.text}`);
  return { text: `Deep research on “${args.query}”: read ${report.length} pages, up to ${depth} link-hop${depth === 1 ? '' : 's'} away.\n\n${byLevel.join('\n\n')}`.slice(0, 40000) };
}

// ---------- fleet mode: one worker per tab, running concurrently ----------
const workers = new Set();

async function dispatch(controller, { instruction, tab_ids = [], urls = [] }) {
  if (!agentReady()) {
    throw new Error("dispatch needs Skillerr's built-in AI (set it up in Skillerr's Settings). Without it: use open_tabs, act on each tab via tab_id, then read_tabs.");
  }
  const targets = [...tab_ids.map((id) => getTab(Number(id))).filter(Boolean), ...urls.map((u) => newTab(toUrl(u), { background: true }))];
  if (!targets.length) throw new Error('Give tab_ids of open tabs and/or urls to open.');
  if (targets.length > MAX_WORKERS) throw new Error(`At most ${MAX_WORKERS} tabs per dispatch.`);
  enterMosaic(targets.map((t) => t.id));
  const workerTools = TOOLS.filter((t) => !['list_tabs', 'new_tab', 'switch_tab', 'close_tab', 'open_tabs', 'read_tabs', 'dispatch', 'record_start', 'caption', 'record_stop', 'show_tabs', 'say', 'save_note', 'save_skill', 'recall', 'tag_session', 'deep_research', 'my_research', 'read_note', 'open_view', 'save_screenshot'].includes(t.name));

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

function agentReady() {
  const s = store.getSettings();
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
  ipcMain.handle('chrome-import', (_e, { profile, bookmarks, history }) => {
    const done = [];
    try {
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

  // History & bookmarks management, and resets.
  ipcMain.handle('data-history', (_e, q) => memory.history({ q: String(q || '') }));
  ipcMain.handle('data-delete-pages', (_e, ids) => {
    for (const id of [].concat(ids || [])) memory.removeNode(String(id));
    return true;
  });
  ipcMain.handle('data-delete-since', (_e, ms) => memory.forgetSince(Number(ms) || 0));
  ipcMain.handle('bookmark-delete', (_e, url) => {
    store.writeJson('bookmarks.json', store.readJson('bookmarks.json', []).filter((b) => b.url !== url));
    const n = memory.nodes.get(memory.pageId(url));
    if (n?.bookmarked) memory.upsert({ id: n.id, bookmarked: false });
    ui('bookmarks-changed');
    return true;
  });
  ipcMain.handle('bookmark-add', () => bookmarkActive());
  ipcMain.handle('data-reset', async (_e, what = {}) => {
    const done = [];
    if (what.browsing) {
      const { session } = require('electron');
      await session.defaultSession.clearStorageData();
      await session.defaultSession.clearCache();
      done.push('cookies and site data');
    }
    if (what.memory) {
      memory.forgetAll();
      done.push('research memory');
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
  ipcMain.handle('mem-folders-root', () => {
    for (const f of memory.taxonomy()) writeResearchFolder(f);
    fs.mkdirSync(RESEARCH_DIR, { recursive: true });
    shell.openPath(RESEARCH_DIR);
    return RESEARCH_DIR;
  });
  ipcMain.handle('mem-recall', (_e, q) => memory.recall(String(q || ''), { limit: 12 }));
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
      { label: 'Research Memory', click: () => openInternal('memory') },
      { label: 'History & Bookmarks', accelerator: 'CmdOrCtrl+Y', click: () => openInternal('data') },
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
      { label: 'Reset Data…', click: () => { openInternal('data'); ui('data-tab', 'reset'); } },
      { label: 'Recordings Folder', click: open(path.join(app.getPath('videos'), 'Skillerr')) },
      { label: 'Notes Folder', click: open(NOTES_DIR) },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: sheet('settings') },
      { label: 'About Skillerr', click: () => newTab('https://skillerr.com') },
    ]).popup({ window: win, x: Math.round(x), y: Math.round(y) });
  });
  ipcMain.handle('mem-forget-session', (_e, id) => memory.forgetSession(String(id)));
  ipcMain.handle('mem-forget-all', () => {
    memory.forgetAll();
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
    if (s.searchEngine) setSearchTemplate(searchTemplateFor(s.searchEngine));
    status.requireApproval = !!store.getSettings().requireApproval;
    pushStatus();
    return store.getSettings();
  });
  ipcMain.handle('mcp-config', () => JSON.stringify({ mcpServers: { skillerr: mcpEntry() } }, null, 2));
  ipcMain.handle('connect-targets', () => connectors.listTargets());
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
    pushTabs();
    pushStatus();
    ui('panel', panelOpen);
  });
}

// ---------------- app lifecycle ----------------

function buildMenu() {
  const guard = (fn) => () => win && fn();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu', label: 'Skillerr' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: guard(() => newTab()) },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: guard(() => activeTab() && closeTab(activeTabId)) },
        { label: 'Open Location…', accelerator: 'CmdOrCtrl+L', click: guard(() => ui('focus-url')) },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: guard(() => closedTabs.length && newTab(closedTabs.pop())) },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: guard(() => activeTab()?.view.webContents.print()) },
        { label: 'History & Bookmarks', accelerator: 'CmdOrCtrl+Y', click: guard(() => openInternal('data')) },
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
  ]));
}

const chromeBg = () => (nativeTheme.shouldUseDarkColors ? '#0c0c10' : '#e9ebef');

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
  if (offerMoveToApplications()) return;
  applyTheme();
  setSearchTemplate(searchTemplateFor());
  wirePermissions(require('electron').session.defaultSession);
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
  win.on('closed', () => app.quit());
  wireIpc();
  buildMenu();
  layout();
  await chrome.webContents.loadFile(path.join(__dirname, 'ui', 'index.html'));
  chrome.webContents.focus();

  hud = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } });
  hud.setBackgroundColor('#00000000');
  hud.setVisible(false);
  hud.webContents.on('will-navigate', (e) => e.preventDefault());
  await hud.webContents.loadFile(path.join(__dirname, 'ui', 'hud.html'));
  win.contentView.addChildView(hud);

  captionView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } });
  captionView.setBackgroundColor('#00000000');
  captionView.setVisible(false);
  captionView.webContents.on('will-navigate', (e) => e.preventDefault());
  await captionView.webContents.loadFile(path.join(__dirname, 'ui', 'caption.html'));
  win.contentView.addChildView(captionView);
  layout();

  recorder = new Recorder({
    ui,
    chromeWc: chrome.webContents,
    windowSource: () => ({ sourceId: win.getMediaSourceId(), size: win.getContentSize() }),
    showCaption: (text) => {
      captionView.setVisible(!!text);
      captionView.webContents.send('caption', text);
    },
    onChange: () => {
      status.recording = recorder.info();
      pushStatus();
    },
  });

  newTab();

  const api = await startApiServer({
    tools: TOOLS,
    onHello: (client) => markActive({ name: client, via: 'mcp' }),
    onCall: async (client, name, args) => {
      const r = await execute({ name: client, via: 'mcp' }, name, args);
      return { text: r.text, image: r.image };
    },
  });
  store.writeSession({ port: api.port, token: api.token, pid: process.pid });
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

app.on('will-quit', () => store.clearSession());
app.on('window-all-closed', () => app.quit());
