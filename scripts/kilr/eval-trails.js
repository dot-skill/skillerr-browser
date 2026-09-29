// Does Kilr make Trails better? Replays realistic browsing (searches and page titles from 8 threads of work, worded
// differently on purpose), shuffled over three days, with no tab or opener hints: the hardest case, where only the
// words themselves say what belongs together. Scores how well trails match the real threads, words only vs with Kilr.
// Usage: node scripts/kilr/eval-trails.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Trails } = require('../../src/trails');
const { Kilr } = require('../../src/kilr');

const { THREADS, HELD_OUT } = require('./threads');

function run(meaning, seed = 1, threads = THREADS) {
  const items = [];
  for (const [topic, list] of Object.entries(threads)) for (const x of list) items.push({ topic, x });
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  items.sort(() => rnd() - 0.5);
  const T0 = Date.parse('2026-09-01T09:00:00Z');
  const clock = { t: T0 };
  const tr = new Trails(fs.mkdtempSync(path.join(os.tmpdir(), 'kilr-eval-')), { now: () => clock.t, meaning });
  const got = [];
  items.forEach((it, i) => {
    clock.t = T0 + i * 40 * 60 * 1000; // one every 40 minutes, over about three days
    const isQ = it.x.startsWith('q:');
    const url = isQ ? `https://www.google.com/search?q=${encodeURIComponent(it.x.slice(2))}` : `https://site${i}.example/${i}`;
    got.push({ topic: it.topic, trail: tr.observe({ url, title: isQ ? '' : it.x }, { typed: true }) });
  });
  // Pairwise: of the pairs from the same thread, how many share a trail (recall); of the pairs sharing a trail, how many
  // are from the same thread (precision).
  let same = 0, sameTogether = 0, together = 0, togetherSame = 0;
  for (let i = 0; i < got.length; i++) {
    for (let j = i + 1; j < got.length; j++) {
      const st = got[i].topic === got[j].topic;
      const tt = got[i].trail && got[i].trail === got[j].trail;
      if (st) { same++; if (tt) sameTogether++; }
      if (tt) { together++; if (st) togetherSame++; }
    }
  }
  const recall = sameTogether / same;
  const precision = together ? togetherSame / together : 1;
  return { trails: new Set(got.map((g) => g.trail).filter(Boolean)).size, precision, recall, f1: (2 * precision * recall) / (precision + recall || 1) };
}

const kilr = new Kilr();
const meaning = { affinity: (p, t) => kilr.pageAffinity(p, t), rank: (q, l) => kilr.rankTrails(q, l).map((x) => x.trail) };
const avg = (m, threads) => {
  const rs = [1, 2, 3, 4, 5].map((seed) => run(m, seed, threads));
  const mean = (k) => rs.reduce((a, r) => a + r[k], 0) / rs.length;
  return { trails: mean('trails').toFixed(1), precision: mean('precision').toFixed(2), recall: mean('recall').toFixed(2), f1: mean('f1').toFixed(2) };
};
module.exports = { run, THREADS, HELD_OUT };
if (require.main === module) {
  for (const [name, threads] of [['tuning set', THREADS], ['held-out set', HELD_OUT]]) {
    console.log(`${name}: ${Object.keys(threads).length} threads, ${Object.values(threads).flat().length} visits, 5 shuffles, no tab hints`);
    console.log('  words only  ', avg(null, threads));
    console.log('  with Kilr  ', avg(meaning, threads));
  }
}
