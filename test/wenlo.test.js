const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Wenlo, describe } = require('../src/wenlo');
const { WenloEmbed, cosine } = require('../src/wenlo/embed');
const { WordPiece } = require('../src/wenlo/tokenizer');
const { Trails } = require('../src/trails');
const { Embedder } = require('../src/embed');
const { Memory } = require('../src/memory');

const wenlo = new Wenlo();
const T0 = Date.parse('2026-09-01T09:00:00Z');
const DAY = 864e5;

test('tokenizer: BERT uncased WordPiece', () => {
  const wp = new WordPiece(['[PAD]', '[UNK]', 'the', 'ryo', '##kan', 'cafe', ',', 'naive', '!']);
  assert.deepStrictEqual(wp.encode('The Ryokan, café!'), [2, 3, 4, 6, 5, 8]);
  assert.deepStrictEqual(wp.encode('Naïve zebra'), [7, 1]);
});

test('the model loads, is small, and embeds to unit vectors', () => {
  const e = WenloEmbed.load();
  assert.strictEqual(e.V, 30522);
  assert.ok(e.D >= 128 && e.D <= 384);
  const v = e.embed('Best ryokan in Kyoto near Gion');
  assert.ok(Math.abs(cosine(v, v) - 1) < 1e-4);
  assert.strictEqual(e.embed(''), null);
});

test('meaning: related texts are closer than unrelated ones, even with no shared words', () => {
  const sim = (a, b) => wenlo.similarity(a, b);
  assert.ok(sim('cheap flights to Tokyo', 'airfare to Japan') > sim('cheap flights to Tokyo', 'sourdough starter recipe') + 0.2);
  assert.ok(sim('mechanical keyboard switches', 'linear vs tactile keys') > sim('mechanical keyboard switches', 'visa application form') + 0.2);
  assert.ok(sim('best office chair for back pain', 'ergonomic seating') > sim('best office chair for back pain', 'mortgage rates today') + 0.1);
});

test('Wenlo answers from a trail\'s facts', () => {
  const s = { id: 't1', title: 'Standing desk', lastAt: T0 - 2 * DAY, stoppedAt: { title: 'Your cart' }, unfinished: [{ kind: 'cart', title: 'Your cart' }], tucked: 2 };
  const text = describe(s, T0);
  assert.match(text, /Standing desk, 2 days ago/);
  assert.match(text, /stopped at “Your cart”/);
  assert.match(text, /cart/);
  assert.match(text, /2 of its tabs are tucked/);
});

test('Trails with Wenlo group real threads of work better than words alone (held-out threads)', () => {
  const { run, HELD_OUT } = require('../scripts/wenlo/eval-trails');
  const meaning = { affinity: (p, t) => wenlo.pageAffinity(p, t), rank: (q, l) => wenlo.rankTrails(q, l).map((x) => x.trail) };
  const f1 = (m) => [1, 2, 3].reduce((a, seed) => a + run(m, seed, HELD_OUT).f1, 0) / 3;
  const words = f1(null);
  const withWenlo = f1(meaning);
  assert.ok(withWenlo > words + 0.1, `Wenlo ${withWenlo.toFixed(2)} vs words ${words.toFixed(2)}`);
});

test('search finds trails by meaning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillerr-wenlo-'));
  const clock = { t: T0 };
  const tr = new Trails(dir, { now: () => clock.t, meaning: { affinity: () => 0, rank: (q, l) => wenlo.rankTrails(q, l, { now: clock.t }).map((x) => x.trail) } });
  const flights = tr.observe({ url: 'https://www.google.com/search?q=cheap+flights+to+tokyo' }, { typed: true });
  tr.observe({ url: 'https://air.example/a', title: 'Tokyo Narita flights - compare airfares' }, { tabTrail: flights, tabAt: clock.t });
  tr.observe({ url: 'https://air.example/b', title: 'Direct flights from London to Tokyo' }, { tabTrail: flights, tabAt: clock.t });
  clock.t += 60000;
  const chair = tr.observe({ url: 'https://www.google.com/search?q=ergonomic+office+chair' }, { typed: true });
  tr.observe({ url: 'https://chair.example/a', title: 'The best office chairs for back pain' }, { tabTrail: chair, tabAt: clock.t });
  tr.observe({ url: 'https://chair.example/b', title: 'Herman Miller Aeron chair review' }, { tabTrail: chair, tabAt: clock.t });
  assert.strictEqual(tr.list({ query: 'plane tickets to Japan' })[0].id, flights);
  assert.strictEqual(tr.list({ query: 'furniture for my desk' })[0].id, chair);
  // "Where was I with …" is about what follows; "where was I?" alone is the latest trail.
  const summaries = tr.list();
  const shown = tr.trails;
  assert.strictEqual(wenlo.answer('where was I with the office chair?', summaries, shown, { now: clock.t }).trailId, chair);
  assert.strictEqual(wenlo.answer('What was I doing about plane tickets', summaries, shown, { now: clock.t }).trailId, flights);
  assert.strictEqual(wenlo.answer('where was I?', summaries, shown, { now: clock.t }).trailId, summaries[0].id);
});

test('recall by meaning uses Wenlo when no endpoint is set, with nothing written to disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillerr-wenlo-mem-'));
  const memory = new Memory(dir);
  const { id: sid } = memory.session({ name: 'AI', via: 'mcp' }, { goal: 'cheap flights to Tokyo' });
  memory.fileSession(sid, { summary: 'Booked a direct flight to Narita for October', topics: ['Travel > Japan'] });
  const e = new Embedder({ memory, dir, builtin: () => wenlo.embedder, getConfig: () => ({ on: true }) });
  const sims = await e.similar('airfare to Japan');
  assert.ok(sims && sims.get(sid) >= 0.55, 'the flights session is found by meaning');
  assert.ok(!(await e.similar('sourdough starter recipe'))?.get(sid), 'and not for something unrelated');
  assert.ok(!fs.existsSync(path.join(dir, 'vectors.jsonl')));
});

test('personal retraining: learns the user\'s jargon, proves it on held-back items, and is kept only if it helps', () => {
  const { trainPersonal } = require('../src/wenlo/train');
  const { WEEK1, WEEK2 } = require('../scripts/wenlo/personal-data');
  const { encodePersonal, decodePersonal, centroid } = require('../src/wenlo/embed');
  const base = WenloEmbed.load();
  const trails = Object.entries(WEEK1).map(([id, texts]) => ({ id, texts }));
  const r = trainPersonal(trails, base);
  assert.ok(r.accepted, JSON.stringify(r.report));
  assert.ok(r.report.after > r.report.before);
  // Saved and loaded again, it still makes next week's unseen pages closer to their own trails.
  const { rows } = decodePersonal(encodePersonal(r.rows, base.D));
  const personal = base.withRows(rows);
  const closeness = (emb) => {
    let s = 0, n = 0;
    for (const [t, texts] of Object.entries(WEEK2)) {
      const c = centroid(WEEK1[t].map((x) => emb.embed(x)));
      for (const x of texts) { s += cosine(emb.embed(x), c); n++; }
    }
    return s / n;
  };
  assert.ok(closeness(personal) > closeness(base) + 0.1, `${closeness(base).toFixed(2)} → ${closeness(personal).toFixed(2)}`);
  assert.notStrictEqual(personal.id, base.id); // recall re-makes its vectors
  // Too little to learn from: nothing changes.
  const few = trainPersonal([{ id: 'a', texts: ['one', 'two'] }], base);
  assert.ok(!few.accepted);
  assert.strictEqual(few.report.reason, 'not-enough');
});

test('personal retraining runs in a worker thread under a memory cap', async () => {
  const { Worker } = require('worker_threads');
  const { WEEK1 } = require('../scripts/wenlo/personal-data');
  const trails = Object.entries(WEEK1).map(([id, texts]) => ({ id, texts }));
  const result = await new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, '..', 'src', 'wenlo', 'train-worker.js'), {
      workerData: { dir: path.join(__dirname, '..', 'assets', 'wenlo'), trails },
      resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 },
    });
    w.on('message', (m) => m.done && (resolve(m), w.terminate()));
    w.on('error', reject);
  });
  assert.ok(result.accepted, JSON.stringify(result));
  assert.ok(result.file && result.file.length > 12);
});
