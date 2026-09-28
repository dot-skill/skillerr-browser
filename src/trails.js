// Trails: the user's own ongoing work, learned on this computer from how they browse.
//
// Every page the user visits is filed into a trail: one thread of work, like "Kyoto trip" or "Standing desk". A page
// joins the trail of the tab it was opened in, the tab it was opened from, or the trail it's about (shared words with
// the trail's searches and pages). Trails remember where the user stopped and what they left unfinished (a form typed
// into but never sent, an article read partway, a cart not checked out, a video half watched), and keep the tabs the
// user tucked away. Research memory (memory.js) is what AIs read; trails are what the user did.
//
// Privacy: a trail keeps each page's URL, title, favicon and a few keywords. Never page text, never what was typed into
// a form (only that something was), and only the visit for pages with password or payment fields. Sites the user
// excludes are never recorded. Stored in one file, readable only by the user, and nothing leaves the computer unless the
// user lets an AI app see their trails.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { keywords } = require('./memory');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const CONTINUE_MS = 30 * 60 * 1000; // the same tab, used again within this long, is still on the same trail
const SESSION_GAP_MS = 2 * HOUR; // coming back to a trail after this long counts as returning to it
const MATCH_DAYS = 14; // a page can join a trail touched in the last two weeks
const JOIN = 0.34; // how alike a page and a trail must be for the page to join it on topic alone
const MEANING_WEIGHT = 0.8; // Kilr's "same topic" (1.0) counts as a strong word match; a loose one stays under JOIN
const PAGE_WORDS = 12;
const TRAIL_WORDS = 60;
const MAX_TRAILS = 300;
const MAX_PAGES = 80;
const MAX_TUCKED = 60;
const EVERYDAY_DAYS = 5; // a site used on this many of the last 21 days is routine (mail, news, video), not a trail
const EPHEMERAL_DAYS = 3; // a one-off that never became a trail is dropped after this long
const KEEP_DAYS = 90; // trails untouched this long are dropped, unless the user named them
const DONE_KEEP_DAYS = 30;

// Words that say nothing about what the work is.
const GENERIC = new Set(`best top review guide official free online buy price cheap compare comparison list latest ultimate complete tips idea
website site app blog article news video watch official store shop deal sale discount coupon login account dashboard inbox welcome index
untitled loading error untitled document edit docs sheet slide file folder open new tab pdf`.split(/\s+/));

// Search pages: the query is the best signal of what someone is working on. [host, path prefix, query parameter]
const SEARCHES = [
  [/(^|\.)google\.[a-z.]+$/, '/search', 'q'],
  [/(^|\.)bing\.com$/, '/search', 'q'],
  [/(^|\.)duckduckgo\.com$/, '/', 'q'],
  [/^search\.brave\.com$/, '/search', 'q'],
  [/(^|\.)search\.yahoo\.com$/, '/search', 'p'],
  [/(^|\.)ecosia\.org$/, '/search', 'q'],
  [/(^|\.)perplexity\.ai$/, '/search', 'q'],
  [/(^|\.)youtube\.com$/, '/results', 'search_query'],
  [/(^|\.)amazon\.[a-z.]+$/, '/s', 'k'],
  [/(^|\.)reddit\.com$/, '/search', 'q'],
  [/(^|\.)wikipedia\.org$/, '/w/index.php', 'search'],
];
const CART = /(^|[\/_\-.\s])(cart|basket|bag|checkout)([\/_\-.\s?]|$)/i;
const ORDERED = /(order[-_ ]?(confirm|complete|received|placed|success)|thank[-_ ]?you|purchase[-_ ]?complete|checkout\/(success|complete|thank))/i;

const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const newId = () => 't' + crypto.randomBytes(5).toString('hex');

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// One URL per page: no fragment, no tracking parameters.
function pageKey(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|ved$|ei$|gclid$|fbclid$|ref$|ref_$|si$|sca_|spm$)/.test(p)) u.searchParams.delete(p);
    return u.toString();
  } catch {
    return String(url || '');
  }
}

function searchQuery(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    for (const [h, p, q] of SEARCHES) {
      if (h.test(host) && u.pathname.startsWith(p)) {
        const text = (u.searchParams.get(q) || '').replace(/\s+/g, ' ').trim();
        if (text) return text.slice(0, 200);
      }
    }
  } catch {}
  return null;
}

// "Best ryokan in Kyoto - Booking.com" → "Best ryokan in Kyoto": drop a short site name at the end.
function cleanTitle(title) {
  const parts = String(title || '').replace(/\s+/g, ' ').trim().split(/\s+[-|–—·•]\s+/);
  while (parts.length > 1 && parts[parts.length - 1].split(' ').length <= 4) parts.pop();
  return parts.join(' - ').slice(0, 140);
}

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// A page's keywords: title (twice, it matters most), heading, description and the URL's path, minus the site's own name.
function pageWords({ url, title, h1, desc, query }) {
  if (query) return keywords(query, PAGE_WORDS).filter((w) => !GENERIC.has(w));
  const host = hostOf(url);
  const own = new Set(host.split('.').flatMap((p) => [p, p.replace(/s$/, '')]));
  let pathWords = '';
  try {
    pathWords = decodeURIComponent(new URL(url).pathname).replace(/[\/_\-+.]+/g, ' ');
  } catch {}
  const t = cleanTitle(title);
  return keywords(`${t} ${t} ${h1 || ''} ${String(desc || '').slice(0, 300)} ${pathWords}`, PAGE_WORDS + 8)
    .filter((w) => !GENERIC.has(w) && !own.has(w) && w.length < 30)
    .slice(0, PAGE_WORDS);
}

function topWords(trail, n = 30) {
  return Object.entries(trail.words || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

// How alike a page is to a trail: the share of the page's keywords (up to 4) the trail is about.
function similarity(words, trail) {
  if (!words.length) return 0;
  const top = new Set(topWords(trail));
  let hit = 0;
  for (const w of words) if (top.has(w)) hit++;
  return Math.min(1, hit / Math.min(words.length, 4));
}

// Which open tabs to tuck away. Every tab the user protects (the active one, what an AI is working in, a form being
// typed, audio playing, a page they keep coming back to) stays, and so do the `keep` most recently used others.
// A forced tidy tucks the rest; otherwise only the ones idle for `idleMs`.
function chooseTabsToTuck(list, { now = Date.now(), keep = 5, idleMs = 12 * HOUR, force = false } = {}) {
  const open = list.filter((t) => !t.protected).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  return open.slice(keep).filter((t) => force || now - (t.lastUsed || 0) > idleMs).map((t) => t.id);
}

// Group many pages at once (an import of open tabs): average-linkage clustering. sim(i, j) → similarity of two items;
// groups merge while their average similarity stays at or above `threshold`. Returns arrays of item indexes.
function clusterItems(n, sim, { threshold = 0.3 } = {}) {
  const S = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : sim(i, j))));
  let groups = Array.from({ length: n }, (_, i) => [i]);
  for (;;) {
    let best = null;
    let bestS = threshold;
    for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        let s = 0;
        for (const i of groups[a]) for (const j of groups[b]) s += S[i][j];
        s /= groups[a].length * groups[b].length;
        if (s >= bestS) [best, bestS] = [[a, b], s];
      }
    }
    if (!best) return groups;
    const [a, b] = best;
    groups[a] = [...groups[a], ...groups[b]];
    groups = groups.filter((_, k) => k !== b);
  }
}

class Trails {
  // meaning: optional, Kilr (src/kilr): { affinity(page, trail) → 0…1, rank(query, trails) → trails }.
  // Without it, trails match by shared words only.
  constructor(dir, { now = Date.now, meaning = null } = {}) {
    this.meaning = meaning;
    this.dir = dir;
    this.file = path.join(dir, 'trails.json');
    this.now = now;
    this.timer = null;
    this.load();
  }

  load() {
    let data = null;
    try {
      data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {}
    this.data = { version: 1, trails: [], ignoredHosts: [], hostDays: {}, quitAt: 0, ...(data || {}) };
    this.prune();
  }

  save() {
    clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  // Many small changes (every page visit) become one write a moment later.
  saveSoon() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      try {
        this.save();
      } catch {}
    }, 2000);
    this.timer.unref?.();
  }

  get trails() {
    return this.data.trails;
  }

  get(id) {
    return this.trails.find((t) => t.id === id) || null;
  }

  ignored(url) {
    const host = hostOf(url);
    return !!host && this.data.ignoredHosts.some((h) => host === h || host.endsWith('.' + h));
  }

  // A site the user is on most days is part of their routine: its pages never start a trail of their own.
  everyday(host) {
    const since = dayOf(this.now() - 21 * DAY);
    return (this.data.hostDays[host] || []).filter((d) => d >= since).length >= EVERYDAY_DAYS;
  }

  noteHostDay(host, at) {
    const day = dayOf(at);
    const days = this.data.hostDays[host] || [];
    if (days[days.length - 1] !== day) {
      days.push(day);
      this.data.hostDays[host] = days.slice(-21);
    }
  }

  // ---------- learning ----------
  // A page the user visited. ctx: { tabTrail, tabAt } (the trail this tab was last on, and when), openerTrail (the trail
  // of the tab it was opened from), typed (the user typed the address or a search, so it may be a new thread).
  // Returns the trail id, or null when the page isn't filed (not a web page, an excluded site, a routine site on its own).
  observe({ url, title = '', favicon = null, h1 = '', desc = '', sensitive = false, at = this.now() }, ctx = {}) {
    if (!/^https?:/i.test(url || '') || this.ignored(url)) return null;
    const host = hostOf(url);
    const query = searchQuery(url);
    const words = pageWords({ url, title, h1: sensitive ? '' : h1, desc: sensitive ? '' : desc, query });
    const typed = !!ctx.typed || !!query;
    this.noteHostDay(host, at);

    let best = null;
    let bestScore = 0;
    for (const t of this.trails) {
      if (t.state !== 'active' || t.loose || at - t.lastAt > MATCH_DAYS * DAY) continue;
      // An AI's research trail takes the user's pages only when they carry on from it (same tab, or opened from it).
      if (t.research && ctx.tabTrail !== t.id && ctx.openerTrail !== t.id) continue;
      let score = similarity(words, t);
      if (this.meaning && !sensitive) score = Math.max(score, MEANING_WEIGHT * this.meaningOf(() => this.meaning.affinity({ title, h1, query }, t)));
      if (ctx.tabTrail === t.id && at - (ctx.tabAt || 0) < CONTINUE_MS) score += typed ? 0.15 : 0.6;
      if (ctx.openerTrail === t.id) score += 0.5;
      if (!query && t.hosts?.[host] && !this.everyday(host)) score += 0.12;
      if (at - t.lastAt < DAY) score += 0.04;
      if (score > bestScore) [best, bestScore] = [t, score];
    }
    let trail = bestScore >= JOIN ? best : null;
    if (!trail) {
      if (!query && this.everyday(host) && !CART.test(url)) return null; // a routine site on its own isn't a thread of work
      if (!query && !words.length) return null;
      trail = { id: newId(), title: '', titleByUser: false, state: 'active', createdAt: at, lastAt: 0, sessions: 0, days: [],
        words: {}, hosts: {}, searches: [], pages: [], tucked: [] };
      this.trails.push(trail);
    }
    this.addTo(trail, { url, title, favicon, host, query, words, sensitive, at });
    this.saveSoon();
    return trail.id;
  }

  // Kilr must never break learning: any failure counts as "no opinion".
  meaningOf(fn, fallback = 0) {
    try {
      const v = fn();
      return v == null || Number.isNaN(v) ? fallback : v;
    } catch {
      return fallback;
    }
  }



  addTo(trail, { url, title, favicon, host, query, words, sensitive, at }) {
    if (at - trail.lastAt > SESSION_GAP_MS) trail.sessions++;
    if (trail.days[trail.days.length - 1] !== dayOf(at)) trail.days = [...trail.days, dayOf(at)].slice(-30);
    trail.lastAt = Math.max(trail.lastAt, at);
    for (const w of words) trail.words[w] = (trail.words[w] || 0) + (query ? 2 : 1);
    const kept = Object.entries(trail.words).sort((a, b) => b[1] - a[1]).slice(0, TRAIL_WORDS);
    trail.words = Object.fromEntries(kept);
    if (query) {
      trail.searches = [query, ...trail.searches.filter((q) => q.toLowerCase() !== query.toLowerCase())].slice(0, 12);
      if (!trail.titleByUser && !trail.title && !trail.research) trail.title = capitalize(query).slice(0, 80); // research: researchTitle names it
      return;
    }
    trail.hosts[host] = (trail.hosts[host] || 0) + 1;
    const key = pageKey(url);
    let p = trail.pages.find((x) => x.url === key);
    if (!p) {
      p = { url: key, title: '', host, favicon: null, firstAt: at, lastAt: at, visits: 0, days: [], unfinished: {} };
      trail.pages.push(p);
    }
    p.title = cleanTitle(title) || p.title || key;
    p.favicon = favicon || p.favicon;
    p.lastAt = at;
    p.visits++;
    if (sensitive) p.sensitive = true;
    if (p.days[p.days.length - 1] !== dayOf(at)) p.days = [...p.days, dayOf(at)].slice(-10);
    if (CART.test(url) || CART.test(title)) p.unfinished.cart = { at };
    if (ORDERED.test(url) || ORDERED.test(title)) this.ordered(host);
    if (!trail.titleByUser && !trail.title && !trail.research) trail.title = cleanTitle(title).slice(0, 80) || host;
    if (trail.pages.length > MAX_PAGES) {
      trail.pages.sort((a, b) => b.lastAt - a.lastAt);
      trail.pages.length = MAX_PAGES;
    }
  }

  // An order went through on this site: its carts aren't unfinished any more.
  ordered(host) {
    for (const t of this.trails) for (const p of t.pages) if (p.host === host && p.unfinished.cart) delete p.unfinished.cart;
  }

  // The user left a page (navigated away, closed or tucked the tab). state, reported by the page:
  // { scroll: 0..1 read so far, long: an article-length page, form: typed into a form and didn't send it,
  //   video: 0..1 watched, videoLong: over 3 minutes, dwellMs }.
  leave(trailId, url, state = {}) {
    const t = this.get(trailId);
    const p = t?.pages.find((x) => x.url === pageKey(url));
    if (!p) return;
    const at = this.now();
    if (state.form) p.unfinished.form = { at };
    else if (state.form === false) delete p.unfinished.form;
    if (state.long && state.scroll != null) {
      if (state.scroll >= 0.9) delete p.unfinished.read;
      else if (state.scroll >= 0.12 && (state.dwellMs || 0) > 20000) p.unfinished.read = { at, pct: Math.round(state.scroll * 100) };
    }
    if (state.videoLong && state.video != null) {
      if (state.video >= 0.92) delete p.unfinished.watch;
      else if (state.video >= 0.05) p.unfinished.watch = { at, pct: Math.round(state.video * 100) };
    }
    if (state.scrollY != null) p.scrollY = Math.round(state.scrollY);
    this.saveSoon();
  }

  // ---------- tucked tabs ----------
  tuck(trailId, tabs, why = 'tidy', at = this.now()) {
    const t = this.get(trailId);
    if (!t) return 0;
    const list = tabs.filter((x) => this.tuckable(x.url))
      .map((x) => ({ url: x.url, title: x.title || x.url, favicon: x.favicon || null, scrollY: Math.round(x.scrollY || 0), at, why, ...(x.active ? { active: true } : {}) }));
    t.tucked = [...list, ...t.tucked.filter((x) => !list.some((y) => y.url === x.url))].slice(0, MAX_TUCKED);
    t.lastAt = Math.max(t.lastAt, at - 1); // tucking isn't a visit, but keeps the trail near the top
    this.saveSoon();
    return list.length;
  }

  tuckable(url) {
    return /^https?:/i.test(url || '') && !this.ignored(url);
  }

  // ---------- research an AI did in Skillerr ----------
  // The tabs an AI app (Claude Desktop, Cursor…) opens for one piece of research make a trail of their own, marked with
  // who did it. key: the research session (or app and day) it belongs to.
  research({ key, by, sessionId = null, at = this.now() }) {
    let t = this.trails.find((x) => x.research?.key === key);
    if (!t) {
      t = { id: newId(), title: '', titleByUser: false, state: 'active', createdAt: at, lastAt: at, sessions: 1, days: [dayOf(at)],
        words: {}, hosts: {}, searches: [], pages: [], tucked: [], research: { key, by, sessionId, titleFrom: '' } };
      this.trails.push(t);
      this.saveSoon();
    }
    if (t.state !== 'active') t.state = 'active';
    return t.id;
  }

  // A page the AI read or opened for the research.
  researchPage(id, { url, title = '', favicon = null, at = this.now() }) {
    const t = this.get(id);
    if (!t?.research || !/^https?:/i.test(url || '') || this.ignored(url) || searchQuery(url)) return false;
    this.addTo(t, { url, title, favicon, host: hostOf(url), query: null, words: pageWords({ url, title }), sensitive: false, at });
    this.saveSoon();
    return true;
  }

  // A web search the AI ran for it.
  researchSearch(id, query, at = this.now()) {
    const t = this.get(id);
    const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!t?.research || !q) return false;
    this.addTo(t, { url: '', title: '', favicon: null, host: '', query: q, words: pageWords({ query: q }), sensitive: false, at });
    this.saveSoon();
    return true;
  }

  // The research's name, from the best source there is: the AI's own question (goal), else its first web search, else
  // the clearest page title. A better source replaces a weaker one; a name the user gave is never replaced.
  researchTitle(id, text, from) {
    const t = this.get(id);
    const rank = { '': 0, page: 1, search: 2, goal: 3 };
    const title = capitalize(String(text || '').replace(/\s+/g, ' ').trim()).slice(0, 80);
    if (!t?.research || !title || t.titleByUser) return false;
    const cur = t.research.titleFrom || '';
    if (rank[from] < rank[cur] || (from === 'search' && cur === 'search')) return false; // the first search names it
    t.title = title;
    t.research.titleFrom = from;
    this.saveSoon();
    return true;
  }

  // What the AI concluded (its tag_session summary), shown with the trail.
  researchSummary(id, summary) {
    const t = this.get(id);
    if (!t?.research || !summary) return false;
    t.research.summary = String(summary).slice(0, 300);
    this.saveSoon();
    return true;
  }

  // Where tabs go that belong to no trail (a routine site, a page that said too little to file): "Other tabs".
  loose() {
    let t = this.trails.find((x) => x.loose);
    if (!t) {
      const at = this.now();
      t = { id: newId(), title: 'Other tabs', titleByUser: false, loose: true, state: 'active', createdAt: at, lastAt: at, sessions: 0, days: [],
        words: {}, hosts: {}, searches: [], pages: [], tucked: [] };
      this.trails.push(t);
    }
    if (t.state !== 'active') t.state = 'active';
    return t.id;
  }

  // Take a trail's tucked tabs out (to reopen them). only: a filter, e.g. just what was open when Skillerr quit.
  untuck(trailId, only = () => true) {
    const t = this.get(trailId);
    if (!t) return [];
    const out = t.tucked.filter(only);
    t.tucked = t.tucked.filter((x) => !out.includes(x));
    this.saveSoon();
    return out;
  }

  // The shelf in the tab strip: trails holding tucked tabs, most recently tucked first, each with its tabs' icons.
  shelf(limit = 6) {
    const newest = (t) => Math.max(0, ...t.tucked.map((x) => x.at));
    const all = this.trails.filter((t) => t.state === 'active' && t.tucked.length).sort((a, b) => newest(b) - newest(a));
    return {
      trails: all.slice(0, limit).map((t) => ({ id: t.id, title: t.title || 'Untitled trail', loose: !!t.loose,
        tabs: t.tucked.slice(0, 24).map((x) => ({ url: x.url, title: x.title || x.url, favicon: x.favicon || null })), count: t.tucked.length })),
      more: Math.max(0, all.length - limit),
    };
  }

  // The tabs that were open when Skillerr last quit, by trail.
  lastSession() {
    const at = this.data.quitAt;
    if (!at) return [];
    return this.trails.map((t) => ({ trail: t, tabs: t.tucked.filter((x) => x.why === 'quit' && x.at === at) })).filter((x) => x.tabs.length);
  }

  markQuit(at = this.now()) {
    this.data.quitAt = at;
    this.saveSoon();
    return at;
  }

  // ---------- what the user sees ----------
  unfinished(t) {
    const out = [];
    for (const p of t.pages) {
      for (const [kind, v] of Object.entries(p.unfinished || {})) out.push({ kind, url: p.url, title: p.title, favicon: p.favicon, pct: v.pct, at: v.at });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  // A thread of work, or just a page that was looked at once?
  worth(t) {
    if (t.loose) return t.tucked.length > 0;
    if (t.research) return t.pages.length + t.searches.length >= 2 || t.tucked.length > 0;
    return t.titleByUser || t.seeded || t.tucked.length > 0 || this.unfinished(t).length > 0 || t.pages.length >= 3 ||
      (t.pages.length >= 2 && (t.searches.length > 0 || t.sessions >= 2)) || (t.pages.length >= 1 && t.searches.length > 0 && t.sessions >= 2);
  }

  summary(t) {
    const last = [...t.pages].sort((a, b) => b.lastAt - a.lastAt)[0] || null;
    const hosts = Object.entries(t.hosts).sort((a, b) => b[1] - a[1]).map(([h]) => h);
    return {
      id: t.id,
      title: t.title || (last ? last.title : 'Untitled trail'),
      state: t.state,
      createdAt: t.createdAt,
      lastAt: t.lastAt,
      doneAt: t.doneAt || null,
      sessions: t.sessions,
      days: t.days.length,
      pageCount: t.pages.length,
      searches: t.searches.slice(0, 5),
      hosts: hosts.slice(0, 5),
      favicons: [...new Set(t.pages.filter((p) => p.favicon).sort((a, b) => b.visits - a.visits).map((p) => p.favicon))].slice(0, 4),
      stoppedAt: last && { url: last.url, title: last.title, favicon: last.favicon, at: last.lastAt, scrollY: last.scrollY || 0 },
      unfinished: this.unfinished(t).slice(0, 5),
      tucked: t.tucked.length,
      // What the trail looks like as tabs: its tucked tabs, or else its latest pages. People know their tabs by their icons.
      tabs: (t.tucked.length ? t.tucked : [...t.pages].sort((a, b) => b.lastAt - a.lastAt)).slice(0, 8)
        .map((x) => ({ url: x.url, title: x.title || x.url, favicon: x.favicon || null, tucked: t.tucked.includes(x) })),
      seeded: !!t.seeded,
      loose: !!t.loose,
      by: t.research?.by || null, // research an AI app did, and which
      researchSummary: t.research?.summary || null,
      returning: t.pages.filter((p) => p.days.length >= 3).map((p) => ({ url: p.url, title: p.title, days: p.days.length })).slice(0, 3),
    };
  }

  detail(id) {
    const t = this.get(id);
    if (!t) return null;
    return { ...this.summary(t), titleByUser: !!t.titleByUser, pages: [...t.pages].sort((a, b) => b.lastAt - a.lastAt), tuckedTabs: t.tucked };
  }

  // Trails worth showing, most relevant first: recent, returned to, unfinished work and tucked tabs rank higher.
  // who: 'all', 'you' (the user's own trails) or 'ai' (research their AI apps did).
  list({ state = 'active', query = '', limit = 100, who = 'all' } = {}) {
    const now = this.now();
    const q = keywords(query, 8);
    const rank = (t) => {
      const age = (now - t.lastAt) / DAY;
      return Math.pow(0.5, age / 3) * (1 + 0.4 * Math.min(t.sessions, 6) + 0.8 * Math.min(this.unfinished(t).length, 3) + (t.tucked.length ? 0.6 : 0));
    };
    const shown = this.trails.filter((t) => (state === 'all' || t.state === state) && this.worth(t) && (who === 'all' || (who === 'ai') === !!t.research));
    // With Kilr, a search finds trails by meaning ("where to stay" finds "ryokan near Gion"), best match first.
    if (query && this.meaning) {
      const hits = this.meaningOf(() => this.meaning.rank(query, shown), null);
      if (hits) {
        const words = new Set(shown.filter((t) => q.length && (similarity(q, t) > 0 || q.some((w) => (t.title || '').toLowerCase().includes(w)))));
        return [...new Set([...hits, ...words])].slice(0, limit).map((t) => this.summary(t));
      }
    }
    return shown
      .filter((t) => !q.length || similarity(q, t) > 0 || q.some((w) => (t.title || '').toLowerCase().includes(w)))
      .sort((a, b) => (state === 'done' ? (b.doneAt || 0) - (a.doneAt || 0) : rank(b) - rank(a)))
      .slice(0, limit)
      .map((t) => this.summary(t));
  }

  // Which trail an open page belongs to, for pages that were open before trails learned about them.
  trailOfUrl(url) {
    const key = pageKey(url);
    let hit = null;
    for (const t of this.trails) if (t.state === 'active' && !t.research && t.pages.some((p) => p.url === key) && (!hit || t.lastAt > hit.lastAt)) hit = t;
    return hit?.id || null;
  }

  // What Kilr learns from when it retrains (src/kilr/train.js): each trail's searches and page titles, newest trails
  // first, from the user's own browsing (you) and research their AI apps did (ai), as the user chooses. Never pages with
  // password or payment fields, never "Other tabs".
  trainingSet({ you = true, ai = true } = {}) {
    return this.trails
      .filter((t) => !t.loose && (t.research ? ai : you))
      .sort((a, b) => b.lastAt - a.lastAt)
      .map((t) => ({
        id: t.id,
        source: t.research ? 'ai' : 'you',
        texts: [...t.searches, ...[...t.pages].filter((p) => !p.sensitive).sort((a, b) => b.lastAt - a.lastAt).map((p) => p.title)].filter(Boolean),
      }))
      .filter((t) => t.texts.length);
  }

  // Pages first visited since a time: what's new for Kilr to learn from.
  newPagesSince(at, { you = true, ai = true } = {}) {
    let n = 0;
    for (const t of this.trails) if (!t.loose && (t.research ? ai : you)) for (const p of t.pages) if (p.firstAt > at && !p.sensitive) n++;
    return n;
  }

  isReference(url) {
    const key = pageKey(url);
    return this.trails.some((t) => t.pages.some((p) => p.url === key && p.days.length >= 3));
  }

  // ---------- the user's controls ----------
  rename(id, title) {
    const t = this.get(id);
    if (!t) return false;
    t.title = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80) || t.title;
    t.titleByUser = true;
    this.saveSoon();
    return true;
  }

  setState(id, state) {
    const t = this.get(id);
    if (!t || !['active', 'done'].includes(state)) return false;
    t.state = state;
    t.doneAt = state === 'done' ? this.now() : null;
    if (state === 'active') t.lastAt = Math.max(t.lastAt, this.now());
    this.saveSoon();
    return true;
  }

  // Fold trail `from` into trail `into`.
  merge(into, from) {
    const a = this.get(into);
    const b = this.get(from);
    if (!a || !b || a === b) return false;
    for (const [w, n] of Object.entries(b.words)) a.words[w] = (a.words[w] || 0) + n;
    for (const [h, n] of Object.entries(b.hosts)) a.hosts[h] = (a.hosts[h] || 0) + n;
    a.searches = [...new Set([...a.searches, ...b.searches])].slice(0, 12);
    for (const p of b.pages) if (!a.pages.some((x) => x.url === p.url)) a.pages.push(p);
    a.tucked = [...a.tucked, ...b.tucked.filter((x) => !a.tucked.some((y) => y.url === x.url))].slice(0, MAX_TUCKED);
    a.days = [...new Set([...a.days, ...b.days])].sort().slice(-30);
    a.sessions += b.sessions;
    a.lastAt = Math.max(a.lastAt, b.lastAt);
    a.createdAt = Math.min(a.createdAt, b.createdAt);
    a.state = 'active';
    this.data.trails = this.trails.filter((t) => t !== b);
    this.saveSoon();
    return true;
  }

  forget(id) {
    const n = this.trails.length;
    this.data.trails = this.trails.filter((t) => t.id !== id);
    this.saveSoon();
    return this.trails.length < n;
  }

  removePage(id, url) {
    const t = this.get(id);
    if (!t) return false;
    const key = pageKey(url);
    t.pages = t.pages.filter((p) => p.url !== key);
    t.tucked = t.tucked.filter((x) => pageKey(x.url) !== key);
    this.saveSoon();
    return true;
  }

  // Never learn from this site again, and forget what was learned from it.
  ignoreHost(host) {
    host = String(host || '').toLowerCase().replace(/^www\./, '').trim();
    if (!host) return false;
    if (!this.data.ignoredHosts.includes(host)) this.data.ignoredHosts.push(host);
    for (const t of this.trails) {
      t.pages = t.pages.filter((p) => !this.ignored(p.url));
      t.tucked = t.tucked.filter((x) => !this.ignored(x.url));
      for (const h of Object.keys(t.hosts)) if (h === host || h.endsWith('.' + host)) delete t.hosts[h];
    }
    delete this.data.hostDays[host];
    this.data.trails = this.trails.filter((t) => t.pages.length || t.tucked.length || t.titleByUser);
    this.saveSoon();
    return true;
  }

  unignoreHost(host) {
    this.data.ignoredHosts = this.data.ignoredHosts.filter((h) => h !== host);
    this.saveSoon();
    return true;
  }

  everydaySites() {
    return Object.keys(this.data.hostDays).filter((h) => this.everyday(h)).sort();
  }

  forgetAll() {
    clearTimeout(this.timer);
    this.timer = null;
    this.data = { version: 1, trails: [], ignoredHosts: this.data.ignoredHosts, hostDays: {}, quitAt: 0 };
    this.save();
  }

  // Drop what never became a trail, trails long untouched, and trails long done.
  prune() {
    const now = this.now();
    this.data.trails = this.trails.filter((t) => {
      if (t.titleByUser && t.state === 'active') return true;
      if (t.state === 'done') return now - (t.doneAt || t.lastAt) < DONE_KEEP_DAYS * DAY;
      if (!this.worth(t)) return now - t.lastAt < EPHEMERAL_DAYS * DAY;
      return now - t.lastAt < KEEP_DAYS * DAY;
    });
    if (this.trails.length > MAX_TRAILS) this.data.trails = this.trails.sort((a, b) => b.lastAt - a.lastAt).slice(0, MAX_TRAILS);
  }

  // ---------- a head start: Chrome history ----------
  // Chrome keeps one row per page (most visits, last visit), not the order pages were opened in, so pages are grouped
  // by topic alone, oldest first. Only groups of three or more pages become trails.
  seed(pages) {
    const before = new Set(this.trails.map((t) => t.id));
    const rows = pages.filter((p) => /^https?:/i.test(p.url || '') && !this.ignored(p.url))
      .map((p) => ({ ...p, at: Date.parse(p.lastVisited) || this.now() }))
      .filter((p) => this.now() - p.at < 30 * DAY)
      .sort((a, b) => a.at - b.at);
    // Chrome's visit counts tell which sites are routine better than a month of seeding would.
    const perHost = new Map();
    for (const p of rows) perHost.set(hostOf(p.url), (perHost.get(hostOf(p.url)) || 0) + (p.visits || 1));
    const busy = new Set([...perHost.entries()].filter(([, n]) => n >= 60).map(([h]) => h));
    for (const p of rows) {
      const host = hostOf(p.url);
      if (busy.has(host) && !searchQuery(p.url)) continue;
      this.observe({ url: p.url, title: p.title, at: p.at });
    }
    let made = 0;
    this.data.trails = this.trails.filter((t) => {
      if (before.has(t.id)) return true;
      const keep = t.pages.length >= 3 || (t.pages.length >= 2 && t.searches.length > 0);
      if (keep) {
        t.seeded = true;
        made++;
      }
      return keep;
    });
    this.save();
    return made;
  }
}

module.exports = { Trails, chooseTabsToTuck, clusterItems, searchQuery, cleanTitle, pageWords, pageKey, hostOf };
