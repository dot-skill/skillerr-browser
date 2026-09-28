const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Scout, describe } = require('../src/scout');
const { ScoutEmbed, cosine } = require('../src/scout/embed');
const { WordPiece } = require('../src/scout/tokenizer');
const { Trails } = require('../src/trails');
const { Embedder } = require('../src/embed');
const { Memory } = require('../src/memory');

const scout = new Scout();
const T0 = Date.parse('2026-09-01T09:00:00Z');
const DAY = 864e5;

test('tokenizer: BERT uncased WordPiece', () => {
  const wp = new WordPiece(['[PAD]', '[UNK]', 'the', 'ryo', '##kan', 'cafe', ',', 'naive', '!']);
  assert.deepStrictEqual(wp.encode('The Ryokan, café!'), [2, 3, 4, 6, 5, 8]);
  assert.deepStrictEqual(wp.encode('Naïve zebra'), [7, 1]);
});

test('the model loads, is small, and embeds to unit vectors', () => {
  const e = ScoutEmbed.load();
  assert.strictEqual(e.V, 30522);
  assert.ok(e.D >= 128 && e.D <= 384);
  const v = e.embed('Best ryokan in Kyoto near Gion');
  assert.ok(Math.abs(cosine(v, v) - 1) < 1e-4);
  assert.strictEqual(e.embed(''), null);
});

test('meaning: related texts are closer than unrelated ones, even with no shared words', () => {
  const sim = (a, b) => scout.similarity(a, b);
  assert.ok(sim('cheap flights to Tokyo', 'airfare to Japan') > sim('cheap flights to Tokyo', 'sourdough starter recipe') + 0.2);
  assert.ok(sim('mechanical keyboard switches', 'linear vs tactile keys') > sim('mechanical keyboard switches', 'visa application form') + 0.2);
  assert.ok(sim('best office chair for back pain', 'ergonomic seating') > sim('best office chair for back pain', 'mortgage rates today') + 0.1);
});

test('Scout answers from a trail\'s facts', () => {
  const s = { id: 't1', title: 'Standing desk', lastAt: T0 - 2 * DAY, stoppedAt: { title: 'Your cart' }, unfinished: [{ kind: 'cart', title: 'Your cart' }], tucked: 2 };
  const text = describe(s, T0);
  assert.match(text, /Standing desk, 2 days ago/);
  assert.match(text, /stopped at “Your cart”/);
  assert.match(text, /cart/);
  assert.match(text, /2 of its tabs are tucked/);
});

test('Trails with Scout group real threads of work better than words alone (held-out threads)', () => {
  const { run, HELD_OUT } = require('../scripts/scout/eval-trails');
  const meaning = { affinity: (p, t) => scout.pageAffinity(p, t), rank: (q, l) => scout.rankTrails(q, l).map((x) => x.trail) };
  const f1 = (m) => [1, 2, 3].reduce((a, seed) => a + run(m, seed, HELD_OUT).f1, 0) / 3;
  const words = f1(null);
  const withScout = f1(meaning);
  assert.ok(withScout > words + 0.1, `Scout ${withScout.toFixed(2)} vs words ${words.toFixed(2)}`);
});

test('search finds trails by meaning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillerr-scout-'));
  const clock = { t: T0 };
  const tr = new Trails(dir, { now: () => clock.t, meaning: { affinity: () => 0, rank: (q, l) => scout.rankTrails(q, l, { now: clock.t }).map((x) => x.trail) } });
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
  assert.strictEqual(scout.answer('where was I with the office chair?', summaries, shown, { now: clock.t }).trailId, chair);
  assert.strictEqual(scout.answer('What was I doing about plane tickets', summaries, shown, { now: clock.t }).trailId, flights);
  assert.strictEqual(scout.answer('where was I?', summaries, shown, { now: clock.t }).trailId, summaries[0].id);
});

test('recall by meaning uses Scout when no endpoint is set, with nothing written to disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillerr-scout-mem-'));
  const memory = new Memory(dir);
  const { id: sid } = memory.session({ name: 'AI', via: 'mcp' }, { goal: 'cheap flights to Tokyo' });
  memory.fileSession(sid, { summary: 'Booked a direct flight to Narita for October', topics: ['Travel > Japan'] });
  const e = new Embedder({ memory, dir, builtin: () => scout.embedder, getConfig: () => ({ on: true }) });
  const sims = await e.similar('airfare to Japan');
  assert.ok(sims && sims.get(sid) >= 0.55, 'the flights session is found by meaning');
  assert.ok(!(await e.similar('sourdough starter recipe'))?.get(sid), 'and not for something unrelated');
  assert.ok(!fs.existsSync(path.join(dir, 'vectors.jsonl')));
});
