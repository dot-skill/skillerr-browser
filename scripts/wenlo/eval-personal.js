// Does personal retraining help? A user's own jargon is where Wenlo's base model is weakest: rare words split into
// pieces it never learned well (ryokan, tokio, bassinet). "This week" is what the user browsed; Wenlo retrains on it.
// "Next week" is new pages on the same threads, worded differently, never seen in training. Scored: how many of next
// week's pages land nearest their own trail, before and after retraining.
// Usage: node scripts/wenlo/eval-personal.js
const { WenloEmbed } = require('../../src/wenlo/embed');
const { trainPersonal, heldOutAccuracy } = require('../../src/wenlo/train');

const { WEEK1, WEEK2 } = require('./personal-data');

const e = WenloEmbed.load();
const toItems = (set) => Object.entries(set).flatMap(([trail, l]) => l.map((t) => ({ trail, ids: e.tok.encode(t) })));
const row = (emb) => (id) => {
  const r = new Float64Array(emb.D);
  for (let k = 0; k < emb.D; k++) r[k] = emb.vec[id * emb.D + k] * emb.scale[id];
  return r;
};
const trails = Object.entries(WEEK1).map(([id, texts]) => ({ id, texts }));
const t0 = Date.now();
const r = trainPersonal(trails, e);
console.log('retrain:', JSON.stringify(r.report), 'accepted', r.accepted, `${Date.now() - t0} ms`);
const train = toItems(WEEK1);
const next = toItems(WEEK2);
const before = heldOutAccuracy(train, next, row(e), e.D);
const personal = r.rows ? e.withRows(r.rows) : e;
const after = heldOutAccuracy(train, next, row(personal), e.D);
console.log(`next week's pages in the right trail: before ${(before * 100).toFixed(0)}%, after ${(after * 100).toFixed(0)}%`);

// The measure that matters in the app: would Trails join next week's page to its trail by meaning alone?
// (Wenlo's closeness to the trail's centre, as Trails uses it, reaching the join threshold.)
const { Wenlo } = require('../../src/wenlo');
const { cosine, centroid } = require('../../src/wenlo/embed');
function joinRate(emb) {
  const w = new Wenlo({ embedder: emb });
  let joined = 0, total = 0, sum = 0;
  for (const [trail, texts] of Object.entries(WEEK2)) {
    const c = centroid(WEEK1[trail].map((t) => w.vec(t)));
    for (const t of texts) {
      const cos = cosine(w.vec(t), c);
      sum += cos;
      if (0.8 * w.closeness(cos) >= 0.34) joined++;
      total++;
    }
  }
  return { joined: joined / total, meanCos: sum / total };
}
const b = joinRate(e);
const a = joinRate(personal);
console.log(`next week's pages Trails would join by meaning: before ${(b.joined * 100).toFixed(0)}% (closeness ${b.meanCos.toFixed(2)}), after ${(a.joined * 100).toFixed(0)}% (closeness ${a.meanCos.toFixed(2)})`);
// And the cost to watch: next week's pages that would wrongly join another trail.
function wrongRate(emb) {
  const w = new Wenlo({ embedder: emb });
  let wrong = 0, total = 0;
  for (const [trail, texts] of Object.entries(WEEK2)) {
    for (const [other, ot] of Object.entries(WEEK1)) {
      if (other === trail) continue;
      const c = centroid(ot.map((t) => w.vec(t)));
      for (const t of texts) {
        if (0.8 * w.closeness(cosine(w.vec(t), c)) >= 0.34) wrong++;
        total++;
      }
    }
  }
  return wrong / total;
}
console.log(`next week's pages that would join a wrong trail: before ${(wrongRate(e) * 100).toFixed(1)}%, after ${(wrongRate(personal) * 100).toFixed(1)}%`);
