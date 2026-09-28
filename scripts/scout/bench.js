// Scout's speed and footprint: load time, memory, and embeddings per second for page titles and sentences.
// Usage: node scripts/scout/bench.js [texts.txt]   (defaults to generated page-title-like texts)
const fs = require('fs');
const { ScoutEmbed } = require('../../src/scout/embed');

const before = process.memoryUsage();
let t = performance.now();
const e = ScoutEmbed.load();
const loadMs = performance.now() - t;
const after = process.memoryUsage();

const texts = process.argv[2]
  ? fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).slice(0, 20000)
  : Array.from({ length: 20000 }, (_, i) => `Best ryokan in Kyoto near Gion ${i} - Travel guide and reviews for ${i % 7 ? 'families' : 'couples'}`);

for (let i = 0; i < 200; i++) e.embed(texts[i]); // warm up
t = performance.now();
for (const x of texts) e.embed(x);
const ms = performance.now() - t;

console.log(JSON.stringify({
  vocab: e.V,
  dims: e.D,
  fileMB: +(fs.statSync(require('path').join(require('../../src/scout/embed').DIR, 'scout-embed.bin')).size / 1e6).toFixed(1),
  loadMs: +loadMs.toFixed(1),
  heapMB: +((after.heapUsed + after.arrayBuffers - before.heapUsed - before.arrayBuffers) / 1e6).toFixed(1),
  texts: texts.length,
  perTextMicroseconds: +((ms * 1000) / texts.length).toFixed(1),
  textsPerSecond: Math.round(texts.length / (ms / 1000)),
}, null, 1));
