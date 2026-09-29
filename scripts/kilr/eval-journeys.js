// How well does the Orb sort tabs kept open for weeks (moving over from Chrome) into journeys? Tabs from 14 threads of
// work (scripts/kilr/threads.js: searches and pages, worded differently on purpose), each thread opened over 1–3
// sittings on random days of four weeks, a few minutes between tabs, sittings of different threads interleaved. Every
// tab is on its own site, so nothing but the words and the times say what belongs together.
//
// Compared: the Chrome import rule before (titles only: clusterItems on the Orb's meaning plus shared words, threshold
// 0.2) and now (src/kilr/journeys.js: sittings joined by topic), each with the Orb and with words only. None of these
// threads were used to choose the new rule. "Hard": a quarter of the pages have titles that say nothing ("Log In",
// "Dashboard"), as long-kept tabs often do.
// Scored pairwise over tabs: precision (tabs put together that belong together), recall (tabs that belong together,
// put together), F1. Averaged over 20 random layouts.
// Usage: node scripts/kilr/eval-journeys.js
const { THREADS, HELD_OUT } = require('./threads');
const { Kilr } = require('../../src/kilr');
const { cosine } = require('../../src/kilr/embed');
const { groupTabs, readableTitle } = require('../../src/kilr/journeys');
const { clusterItems, cleanTitle, pageWords } = require('../../src/trails');

const orb = new Kilr({ dir: require('path').join(__dirname, '..', '..', 'assets', 'kilr') });
const meaning = { vec: (x) => orb.vec(x), cosine };
const MIN = 60e3;
const DAY = 24 * 60 * MIN;
const NOTHING = ['Log In', 'Dashboard', 'Sign in', 'Home', 'Overview'];

function layout(seed, { hard = false } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const T0 = Date.parse('2026-09-01T00:00:00Z');
  const tabs = [];
  let n = 0;
  for (const [topic, list] of Object.entries({ ...THREADS, ...HELD_OUT })) {
    const sittings = 1 + Math.floor(rnd() * 3);
    const parts = Array.from({ length: sittings }, () => []);
    list.forEach((x, i) => parts[i < sittings ? i : Math.floor(rnd() * sittings)].push(x));
    for (const part of parts) {
      let t = T0 + Math.floor(rnd() * 28) * DAY + (8 + rnd() * 14) * 60 * MIN;
      for (const x of part) {
        n++;
        const isQ = x.startsWith('q:');
        const says = !(hard && !isQ && rnd() < 0.25);
        tabs.push({
          topic,
          url: isQ ? `https://www.google.com/search?q=${encodeURIComponent(x.slice(2))}` : `https://site${n}.example/page`,
          title: isQ ? `${x.slice(2)} - Google Search` : says ? x : NOTHING[Math.floor(rnd() * NOTHING.length)],
          firstVisit: t,
        });
        t += (1 + rnd() * 8) * MIN;
      }
    }
  }
  return tabs;
}

// Before: all tabs clustered at once on their titles.
function before(tabs, withOrb) {
  const vecs = tabs.map((t) => (withOrb ? orb.vec(cleanTitle(t.title)) : null));
  const words = tabs.map((t) => new Set(pageWords({ url: t.url, title: t.title })));
  return clusterItems(tabs.length, (i, j) => (vecs[i] && vecs[j] ? cosine(vecs[i], vecs[j]) : 0) + 0.1 * Math.min([...words[i]].filter((w) => words[j].has(w)).length, 2), { threshold: 0.2 });
}

function score(tabs, groups) {
  const where = new Map();
  groups.forEach((g, k) => g.forEach((i) => where.set(i, k)));
  let tp = 0, fp = 0, fn = 0;
  for (let i = 0; i < tabs.length; i++) {
    for (let j = i + 1; j < tabs.length; j++) {
      const same = tabs[i].topic === tabs[j].topic;
      const together = where.has(i) && where.get(i) === where.get(j);
      if (together && same) tp++;
      else if (together) fp++;
      else if (same) fn++;
    }
  }
  const p = tp / (tp + fp || 1), r = tp / (tp + fn || 1);
  return { p, r, f1: (2 * p * r) / (p + r || 1), trails: groups.filter((g) => g.length > 1).length };
}

const RULES = {
  'Before, words only': (tabs) => before(tabs, false),
  'Before, with the Orb': (tabs) => before(tabs, true),
  'Now, words only': (tabs) => groupTabs(tabs, null).journeys,
  'Now, with the Orb': (tabs) => groupTabs(tabs, meaning).journeys,
};

const out = {};
for (const hard of [false, true]) {
  const name = hard ? 'hard (a quarter of titles say nothing)' : 'titles as written';
  const acc = Object.fromEntries(Object.keys(RULES).map((k) => [k, { p: 0, r: 0, f1: 0, trails: 0 }]));
  const SEEDS = 20;
  let tabCount = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const tabs = layout(seed * 7919, { hard });
    tabCount += tabs.length;
    for (const [k, rule] of Object.entries(RULES)) {
      const s = score(tabs, rule(tabs));
      for (const m of Object.keys(s)) acc[k][m] += s[m] / SEEDS;
    }
  }
  console.log(`\n${name}: ${Object.keys({ ...THREADS, ...HELD_OUT }).length} threads, ${Math.round(tabCount / SEEDS)} tabs, 1–3 sittings each over 4 weeks, ${SEEDS} layouts`);
  for (const [k, a] of Object.entries(acc)) console.log(`  ${k.padEnd(22)} precision ${a.p.toFixed(2)}  recall ${a.r.toFixed(2)}  F1 ${a.f1.toFixed(2)}  trails ${a.trails.toFixed(1)}`);
  out[name] = acc;
}
module.exports = out;
