// Journeys from a set of open tabs (moving over from Chrome): which tabs belong together, which are everyday pages.
// The Orb alone, on this computer, with no language model: its meaning of each page, when each page was first opened,
// and fixed rules. Chosen on a real set of long-kept tabs, where titles alone ("Log In", "Dashboard") said too little:
//
//   1. Everyday pages (a mail inbox, a plain AI chat page, on a site used most days) aren't a journey.
//   2. Sittings: tabs opened in one go, each within SITTING_GAP of the one before.
//   3. Sittings join across days when they're about the same thing on the whole (average linkage over their tabs of
//      the Orb's meaning, shared words, and the same small site), and never when they're weeks apart.
//
// Tabs without an opening time are sittings of their own, joined by meaning alone.
const { clusterItems, cleanTitle, pageWords, hostOf } = require('../trails');

const SITTING_GAP_MS = 30 * 60 * 1000;
const JOIN = 0.25; // how alike two sittings must be, on average, to be one journey
const FAR_APART_MS = 7 * 24 * 3600 * 1000;
const FAR_APART_PENALTY = 0.2;
const SAME_SITE = 0.25; // same site, when it's a small one here (Stripe's help and Stripe's dashboard), not a platform
const WORD_BONUS = 0.1; // per shared topic word, up to two
const EVERYDAY_DAYS = 5; // of the last 21, as Trails' own rule
const EVERYDAY_ALONE_MS = 15 * 60 * 1000; // an everyday-looking page opened right next to other work is part of it

// A title that says nothing about what the page is for.
const GENERIC_TITLE = /^(log ?in|sign ?in|sign ?up|log ?on|dashboard|home|overview|inbox|welcome|untitled|new tab|invalid link|claude|chatgpt|gemini|copilot)\b/i;

// The site's own name: "dashboard.render.com" → "render", "support.stripe.com" → "stripe".
function siteName(url) {
  return hostOf(url).replace(/^(www|app|dashboard|dash|console|auth|support|connect|mail|docs|accounts|login|my)\./, '').split('.')[0] || '';
}

// A title without the site's own name in it: "Render Dashboard" on render.com is just "Dashboard".
function ownWords({ url, title }) {
  const site = siteName(url || '').toLowerCase();
  return cleanTitle(title).split(/\s+/).filter((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '') !== site).join(' ').trim();
}

// What the Orb reads for a page: its title without the site's name; the site's name when the title says nothing
// ("Log In"); and a very short title ("Releases") with the site and the words of its path, which say what it's of.
function readableTitle({ url, title }) {
  const t = cleanTitle(title);
  if (!url) return t;
  if (!t || GENERIC_TITLE.test(t) || GENERIC_TITLE.test(ownWords({ url, title }))) return siteName(url) || t;
  if (t.split(/\s+/).length > 2) return t;
  let path = '';
  try {
    path = new URL(url).pathname.split('/').filter((p) => p && p.length < 30 && !/\d{3,}|^[a-f0-9-]{16,}$/i.test(p)).join(' ').replace(/[-_]/g, ' ');
  } catch {}
  return `${t} ${siteName(url)} ${path}`.trim();
}

// tabs: [{ url, title, firstVisit?, hostDays? }] (hostDays: days of the last 21 the site was used)
// meaning: { vec(text), cosine(a, b) }, or null for words only.
// Returns { journeys: [[index…]…] (most recent first; each led by the tab most central to it, which names the
// trail), everyday: [index…] }.
function groupTabs(tabs, meaning = null) {
  const n = tabs.length;
  const routineLooking = (t) => {
    if ((t.hostDays || 0) < EVERYDAY_DAYS) return false;
    const title = cleanTitle(t.title);
    return /^mail\./.test(hostOf(t.url)) ? /^inbox\b/i.test(title) : GENERIC_TITLE.test(title);
  };
  const looks = tabs.map(routineLooking);
  const everyday = tabs.map((t, i) => looks[i] && !tabs.some((o, j) => j !== i && !looks[j] && o.firstVisit && t.firstVisit && Math.abs(o.firstVisit - t.firstVisit) < EVERYDAY_ALONE_MS));

  const text = tabs.map(readableTitle);
  const vecs = meaning ? text.map((x) => meaning.vec(x)) : [];
  const words = tabs.map((t, i) => new Set(pageWords({ url: t.url, title: text[i] })));
  const sites = tabs.map((t) => siteName(t.url));
  const perSite = new Map();
  for (const s of sites) perSite.set(s, (perSite.get(s) || 0) + 1);
  const link = (i, j) => {
    let s = vecs[i] && vecs[j] ? meaning.cosine(vecs[i], vecs[j]) : 0;
    s += WORD_BONUS * Math.min([...words[i]].filter((w) => words[j].has(w)).length, 2);
    if (sites[i] && sites[i] === sites[j] && perSite.get(sites[i]) <= 2) s += SAME_SITE;
    if (tabs[i].firstVisit && tabs[j].firstVisit && Math.abs(tabs[i].firstVisit - tabs[j].firstVisit) > FAR_APART_MS) s -= FAR_APART_PENALTY;
    return s;
  };

  // Sittings, in the order the tabs were first opened.
  const order = [...Array(n).keys()].filter((i) => !everyday[i]).sort((a, b) => (tabs[a].firstVisit || Infinity) - (tabs[b].firstVisit || Infinity));
  const sittings = [];
  for (const i of order) {
    const last = sittings[sittings.length - 1];
    const prev = last && tabs[last[last.length - 1]].firstVisit;
    if (prev && tabs[i].firstVisit && tabs[i].firstVisit - prev <= SITTING_GAP_MS) last.push(i);
    else sittings.push([i]);
  }

  const joined = clusterItems(sittings.length, (a, b) => {
    let s = 0;
    for (const i of sittings[a]) for (const j of sittings[b]) s += link(i, j);
    return s / (sittings[a].length * sittings[b].length);
  }, { threshold: JOIN }).map((g) => g.flatMap((k) => sittings[k]));
  const latest = (g) => Math.max(...g.map((i) => tabs[i].firstVisit || 0));
  // Lead with the tab closest to the rest of its journey, among those whose title says something.
  const says = (i) => { const t = ownWords(tabs[i]); return !!t && !GENERIC_TITLE.test(t) && t.split(/\s+/).length >= 2; };
  const centre = (g, i) => g.reduce((s, j) => (j === i ? s : s + link(i, j)), 0);
  const led = (g) => {
    const can = g.filter(says).length ? g.filter(says) : g;
    const lead = can.reduce((b, i) => (centre(g, i) > centre(g, b) ? i : b), can[0]);
    return [lead, ...g.filter((i) => i !== lead)];
  };
  return {
    journeys: joined.sort((a, b) => latest(b) - latest(a)).map(led),
    everyday: [...Array(n).keys()].filter((i) => everyday[i]),
  };
}


module.exports = { groupTabs, readableTitle, siteName, GENERIC_TITLE };
