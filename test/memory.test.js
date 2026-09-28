const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Memory, keywords, tokens, recallText } = require('../src/memory');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'skillerr-mem-'));
const ai = { name: 'Test AI', via: 'mcp' };

test('tokens drop stop words, numbers and fold plurals', () => {
  assert.deepStrictEqual(tokens('The hotels in Tokyo 2026'), ['hotel', 'tokyo']);
  assert.ok(keywords('ramen ramen ramen sushi').indexOf('ramen') === 0);
});

test('visit keeps keywords, never text, and nothing for sensitive pages', () => {
  const m = new Memory(tmp());
  const { id: sid } = m.session(ai, { goal: 'Tokyo trip' });
  const page = m.visit(sid, { url: 'https://example.com/tokyo?utm_source=x#top', title: 'Tokyo hotels', text: 'Shinjuku hotel with pool' });
  const n = m.nodes.get(page);
  assert.strictEqual(n.url, 'https://example.com/tokyo');
  assert.ok(n.keywords.includes('shinjuku'));
  assert.ok(!('text' in n));
  const pay = m.visit(sid, { url: 'https://shop.example/checkout', title: 'Checkout', text: 'card number 4111', sensitive: true });
  assert.deepStrictEqual(m.nodes.get(pay).keywords, []);
  assert.strictEqual(m.visit(sid, { url: 'about:blank' }), undefined);
});

test('graph survives a restart and forgetting removes it', () => {
  const dir = tmp();
  const m = new Memory(dir);
  const { id: sid } = m.session(ai, { goal: 'headphones' });
  m.visit(sid, { url: 'https://rtings.com/anc', title: 'Best ANC headphones', text: 'noise cancelling sony bose' });
  m.fileSession(sid, { summary: 'Sony wins', topics: ['Shopping > Headphones'], entities: ['company:Sony'] });
  const again = new Memory(dir);
  assert.strictEqual(again.nodes.size, m.nodes.size);
  assert.strictEqual(again.edges.size, m.edges.size);
  assert.ok(again.nodes.has('topic:shopping>headphones'));
  again.forgetSession(sid);
  assert.strictEqual(again.stats().session, 0);
  assert.strictEqual(again.stats().page, 0);
  again.forgetAll();
  assert.strictEqual(new Memory(dir).nodes.size, 0);
});

test('recall finds filed research by words and through topics', () => {
  const m = new Memory(tmp());
  const { id: sid } = m.session(ai, { goal: 'Plan a weekend in Tokyo' });
  m.visit(sid, { url: 'https://hotels.example/tokyo', title: 'Tokyo hotels', text: 'Shibuya hotel pool breakfast' });
  m.addNote(sid, { title: 'Tokyo trip', file: '/notes/tokyo.md', content: 'Stay in Shibuya', topics: ['Travel > Japan > Tokyo'] });
  m.fileSession(sid, { summary: 'Hotel picked', topics: ['Travel > Japan > Tokyo'], entities: ['place:Tokyo'] });
  const got = m.recall('hotel in Tokyo');
  assert.ok(got.length);
  assert.ok(got.some((r) => r.id === sid));
  assert.ok(got.some((r) => r.type === 'note'));
  assert.deepStrictEqual(m.recall('banana bread recipe'), []);
  assert.match(recallText(got, m.topics()), /Related past research/);
});

test('semantic similarity recalls research phrased differently', () => {
  const m = new Memory(tmp());
  const { id: sid } = m.session(ai, { goal: 'Where to stay in Kyoto' });
  m.fileSession(sid, { summary: 'Ryokan near Gion', topics: ['Travel > Japan > Kyoto'] });
  assert.deepStrictEqual(m.recall('accommodation options'), []); // no shared words
  const got = m.recall('accommodation options', { semantic: new Map([[sid, 0.82]]) });
  assert.strictEqual(got[0].id, sid);
  assert.strictEqual(got[0].why, 'similar in meaning');
  // Weak similarity alone doesn't count; the excluded session never comes back.
  assert.deepStrictEqual(m.recall('accommodation options', { semantic: new Map([[sid, 0.5]]) }), []);
  assert.deepStrictEqual(m.recall('accommodation', { semantic: new Map([[sid, 0.9]]), excludeSession: sid }), []);
});

test('taxonomy builds folders from topics', () => {
  const m = new Memory(tmp());
  const { id: sid } = m.session(ai, { goal: 'rail pass' });
  m.fileSession(sid, { summary: 'JR pass', topics: ['Travel > Japan > Rail'] });
  const [travel] = m.taxonomy();
  assert.strictEqual(travel.path, 'Travel');
  assert.strictEqual(travel.children[0].children[0].path, 'Travel > Japan > Rail');
  assert.strictEqual(travel.total, 1);
});

test('lazy memory reads nothing until used, and a first write keeps what was there', () => {
  const dir = tmp();
  const m = new Memory(dir);
  const { id: sid } = m.session(ai, { goal: 'first' });
  m.visit(sid, { url: 'https://a.example/1', title: 'One', text: 'alpha beta' });
  const lazy = new Memory(dir, { lazy: true });
  assert.strictEqual(lazy.loaded, false);
  lazy.visit(null, { url: 'https://a.example/2', title: 'Two', text: 'gamma' }); // write before any read
  assert.strictEqual(lazy.loaded, true);
  const again = new Memory(dir);
  assert.ok(again.nodes.has(lazy.pageId('https://a.example/1')), 'earlier page kept');
  assert.ok(again.nodes.has(lazy.pageId('https://a.example/2')));
  assert.ok(again.nodes.has(sid));
});
