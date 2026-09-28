const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Trails, chooseTabsToTuck, searchQuery, cleanTitle, pageKey } = require('../src/trails');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'skillerr-trails-'));
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-09-01T09:00:00Z');

// A trails store with a clock the test moves.
function make(dir = tmp()) {
  const clock = { t: T0 };
  const tr = new Trails(dir, { now: () => clock.t });
  return { tr, clock, dir };
}

test('search queries, titles and page keys', () => {
  assert.strictEqual(searchQuery('https://www.google.co.in/search?q=kyoto+ryokan+near+gion&hl=en'), 'kyoto ryokan near gion');
  assert.strictEqual(searchQuery('https://duckduckgo.com/?q=standing%20desk'), 'standing desk');
  assert.strictEqual(searchQuery('https://www.youtube.com/results?search_query=ramen'), 'ramen');
  assert.strictEqual(searchQuery('https://www.google.com/maps'), null);
  assert.strictEqual(cleanTitle('Best ryokan in Kyoto - Booking.com'), 'Best ryokan in Kyoto');
  assert.strictEqual(cleanTitle('Gion | Kyoto | Japan Guide'), 'Gion');
  assert.strictEqual(pageKey('https://a.example/x?utm_source=n&id=3#top'), 'https://a.example/x?id=3');
});

test('a search and the pages opened from it make one trail, titled by the search', () => {
  const { tr, clock } = make();
  const a = tr.observe({ url: 'https://www.google.com/search?q=kyoto+ryokan+near+gion' }, { typed: true });
  clock.t += MIN;
  const b = tr.observe({ url: 'https://www.booking.com/hotel/jp/gion-ryokan.html', title: 'Gion Ryokan Karaku, Kyoto - Booking.com' }, { tabTrail: a, tabAt: clock.t - MIN });
  clock.t += MIN;
  const c = tr.observe({ url: 'https://www.japan-guide.com/e/e3902.html', title: 'Gion - Kyoto Travel' }, { openerTrail: a });
  assert.strictEqual(b, a);
  assert.strictEqual(c, a);
  const [t] = tr.list();
  assert.strictEqual(t.title, 'Kyoto ryokan near gion');
  assert.strictEqual(t.pageCount, 2);
  assert.deepStrictEqual(t.searches, ['kyoto ryokan near gion']);
  assert.strictEqual(t.stoppedAt.title, 'Gion');
});

test('an unrelated search in the same tab starts a new trail; a related one later joins the old trail', () => {
  const { tr, clock } = make();
  const kyoto = tr.observe({ url: 'https://www.google.com/search?q=kyoto+ryokan' }, { typed: true });
  tr.observe({ url: 'https://ryokan.example/kyoto-gion', title: 'Ryokan in Kyoto Gion' }, { tabTrail: kyoto, tabAt: clock.t });
  tr.observe({ url: 'https://ryokan.example/kyoto-arashiyama', title: 'Ryokan in Kyoto Arashiyama' }, { tabTrail: kyoto, tabAt: clock.t });
  clock.t += 5 * MIN;
  const desk = tr.observe({ url: 'https://www.google.com/search?q=standing+desk+under+500' }, { tabTrail: kyoto, tabAt: clock.t - MIN, typed: true });
  assert.notStrictEqual(desk, kyoto);
  tr.observe({ url: 'https://desks.example/uplift-v2', title: 'Uplift V2 standing desk' }, { tabTrail: desk, tabAt: clock.t });
  clock.t += 3 * DAY;
  const back = tr.observe({ url: 'https://www.google.com/search?q=kyoto+gion+ryokan+dinner' }, { typed: true });
  assert.strictEqual(back, kyoto);
  const k = tr.list().find((t) => t.id === kyoto);
  assert.strictEqual(k.sessions, 2); // came back to it
});

test('one-off pages and routine sites do not become trails', () => {
  const { tr, clock } = make();
  const once = tr.observe({ url: 'https://news.example/story/volcano-iceland', title: 'Volcano erupts in Iceland' }, { typed: true });
  assert.ok(once);
  assert.strictEqual(tr.list().length, 0, 'a single page is not a trail yet');
  // mail.example used every day is routine
  for (let d = 0; d < 6; d++) {
    clock.t = T0 + d * DAY;
    tr.observe({ url: `https://mail.example/inbox/${d}`, title: `Inbox (${d}) message from bank` }, { typed: true });
  }
  clock.t += MIN;
  assert.strictEqual(tr.observe({ url: 'https://mail.example/inbox/7', title: 'Quarterly invoice' }, { typed: true }), null);
  // ...unless the user got there from a trail
  const t = tr.observe({ url: 'https://www.google.com/search?q=quarterly+invoice+template' }, { typed: true });
  assert.strictEqual(tr.observe({ url: 'https://mail.example/inbox/8', title: 'Invoice draft' }, { tabTrail: t, tabAt: clock.t }), t);
  // one-offs are pruned after a few days
  clock.t += 5 * DAY;
  tr.prune();
  assert.ok(!tr.get(once));
});

test('unfinished work: forms, reading, videos and carts', () => {
  const { tr } = make();
  const id = tr.observe({ url: 'https://www.google.com/search?q=visa+japan' }, { typed: true });
  tr.observe({ url: 'https://visa.example/apply', title: 'Japan visa application' }, { tabTrail: id, tabAt: Date.now() });
  tr.leave(id, 'https://visa.example/apply', { form: true, scroll: 0.4, long: false });
  tr.observe({ url: 'https://blog.example/japan-visa-guide', title: 'Japan visa guide' }, { tabTrail: id, tabAt: Date.now() });
  tr.leave(id, 'https://blog.example/japan-visa-guide', { long: true, scroll: 0.45, dwellMs: 60000, scrollY: 1800 });
  tr.observe({ url: 'https://shop.example/cart', title: 'Your cart - Shop' }, { openerTrail: id });
  const kinds = tr.list()[0].unfinished.map((u) => u.kind).sort();
  assert.deepStrictEqual(kinds, ['cart', 'form', 'read']);
  assert.strictEqual(tr.list()[0].unfinished.find((u) => u.kind === 'read').pct, 45);
  // finishing clears them
  tr.leave(id, 'https://visa.example/apply', { form: false });
  tr.leave(id, 'https://blog.example/japan-visa-guide', { long: true, scroll: 0.95, dwellMs: 90000 });
  tr.observe({ url: 'https://shop.example/order-confirmation/123', title: 'Thank you for your order' }, { openerTrail: id });
  assert.deepStrictEqual(tr.list()[0].unfinished, []);
});

test('pages with password or payment fields keep only the visit', () => {
  const { tr } = make();
  const id = tr.observe({ url: 'https://www.google.com/search?q=pay+electricity+bill' }, { typed: true });
  tr.observe({ url: 'https://power.example/pay', title: 'Pay your bill', h1: 'Card 4111 1111', desc: 'secret', sensitive: true }, { tabTrail: id, tabAt: Date.now() });
  const t = tr.get(id);
  assert.ok(!('4111' in t.words) && !('secret' in t.words));
  assert.ok(t.pages[0].sensitive);
});

test('tucked tabs, the last session, and reopening', () => {
  const { tr, clock } = make();
  const id = tr.observe({ url: 'https://www.google.com/search?q=rust+async' }, { typed: true });
  tr.observe({ url: 'https://tokio.example/tutorial', title: 'Tokio tutorial' }, { tabTrail: id, tabAt: clock.t });
  assert.strictEqual(tr.tuck(id, [{ url: 'https://tokio.example/tutorial', title: 'Tokio tutorial', scrollY: 900 }, { url: 'about:blank' }], 'tidy'), 1);
  const quitAt = tr.markQuit();
  tr.tuck(id, [{ url: 'https://tokio.example/select', title: 'select!' }], 'quit');
  tr.get(id).tucked[0].at = quitAt; // tucked at the moment of quitting
  assert.strictEqual(tr.lastSession()[0].tabs.length, 1);
  assert.strictEqual(tr.list()[0].tucked, 2);
  const shelf = tr.shelf();
  assert.strictEqual(shelf.trails[0].id, id);
  assert.deepStrictEqual(shelf.trails[0].tabs.map((x) => x.url), ['https://tokio.example/select', 'https://tokio.example/tutorial']);
  assert.ok(tr.list()[0].tabs.every((x) => x.tucked));
  const back = tr.untuck(id, (x) => x.why === 'quit');
  assert.deepStrictEqual(back.map((x) => x.url), ['https://tokio.example/select']);
  assert.strictEqual(tr.untuck(id)[0].scrollY, 900);
  assert.strictEqual(tr.get(id).tucked.length, 0);
});

test('choosing tabs to tuck keeps protected and recent tabs', () => {
  const now = T0;
  const list = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, lastUsed: now - (i + 1) * HOUR * 2, protected: i === 10 }));
  // auto: only the idle ones beyond the 5 most recent (idle > 12 h), never the protected one
  assert.deepStrictEqual(chooseTabsToTuck(list, { now }), [7, 8, 9, 10, 12]);
  // tidy now: everything beyond the 5 most recent
  assert.deepStrictEqual(chooseTabsToTuck(list, { now, force: true }), [6, 7, 8, 9, 10, 12]);
  assert.deepStrictEqual(chooseTabsToTuck(list.slice(0, 4), { now, force: true }), []);
});

test('rename, merge, done, forget, remove a page, never learn from a site', () => {
  const { tr, clock } = make();
  const a = tr.observe({ url: 'https://www.google.com/search?q=sourdough+starter' }, { typed: true });
  tr.observe({ url: 'https://bread.example/starter', title: 'Sourdough starter' }, { tabTrail: a, tabAt: clock.t });
  clock.t += MIN;
  const b = tr.observe({ url: 'https://www.google.com/search?q=dutch+oven+sizes' }, { typed: true });
  tr.observe({ url: 'https://pots.example/dutch-oven', title: 'Dutch oven sizes' }, { tabTrail: b, tabAt: clock.t });
  assert.notStrictEqual(a, b);
  assert.ok(tr.rename(a, '  Baking   bread '));
  assert.strictEqual(tr.get(a).title, 'Baking bread');
  assert.ok(tr.merge(a, b));
  assert.strictEqual(tr.get(b), null);
  assert.strictEqual(tr.get(a).pages.length, 2);
  // the merged trail now catches both topics
  clock.t += MIN;
  assert.strictEqual(tr.observe({ url: 'https://www.google.com/search?q=dutch+oven+sourdough' }, { typed: true }), a);
  tr.removePage(a, 'https://pots.example/dutch-oven');
  assert.strictEqual(tr.get(a).pages.length, 1);
  tr.ignoreHost('www.bread.example');
  assert.strictEqual(tr.get(a).pages.length, 0);
  assert.strictEqual(tr.observe({ url: 'https://bread.example/levain', title: 'Levain' }, { tabTrail: a, tabAt: clock.t }), null);
  tr.setState(a, 'done');
  assert.strictEqual(tr.list().length, 0);
  assert.strictEqual(tr.list({ state: 'done' })[0].id, a);
  assert.ok(tr.forget(a));
  assert.strictEqual(tr.trails.length, 0);
});

test('trails survive a restart; forget everything keeps excluded sites', () => {
  const { tr, dir } = make();
  const id = tr.observe({ url: 'https://www.google.com/search?q=espresso+grinder' }, { typed: true });
  tr.observe({ url: 'https://coffee.example/grinders', title: 'Espresso grinders compared' }, { tabTrail: id, tabAt: T0 });
  tr.ignoreHost('private.example');
  tr.save();
  // Readable only by the user (Windows has no Unix permissions; its per-user folders do that job).
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(path.join(dir, 'trails.json')).mode & 0o777, 0o600);
  const again = new Trails(dir, { now: () => T0 });
  assert.strictEqual(again.get(id).title, 'Espresso grinder');
  again.forgetAll();
  const wiped = new Trails(dir, { now: () => T0 });
  assert.strictEqual(wiped.trails.length, 0);
  assert.deepStrictEqual(wiped.data.ignoredHosts, ['private.example']);
});

test('Chrome history seeds trails from groups of related pages', () => {
  const { tr } = make();
  const at = (h) => new Date(T0 - h * HOUR).toISOString();
  const made = tr.seed([
    { url: 'https://www.google.com/search?q=mechanical+keyboard+switches', title: 'mechanical keyboard switches - Google Search', visits: 2, lastVisited: at(50) },
    { url: 'https://kb.example/switches-linear-tactile', title: 'Linear vs tactile keyboard switches', visits: 3, lastVisited: at(49) },
    { url: 'https://kb.example/hot-swap-keyboard', title: 'Best hot-swap mechanical keyboard', visits: 1, lastVisited: at(48) },
    { url: 'https://shop.example/keychron-q1', title: 'Keychron Q1 mechanical keyboard', visits: 4, lastVisited: at(20) },
    { url: 'https://news.example/elections', title: 'Election results live', visits: 1, lastVisited: at(10) },
    { url: 'https://old.example/ancient', title: 'Something from long ago', visits: 9, lastVisited: new Date(T0 - 60 * DAY).toISOString() },
  ]);
  assert.strictEqual(made, 1);
  const [t] = tr.list();
  assert.ok(t.seeded);
  assert.strictEqual(t.pageCount, 3);
  assert.strictEqual(t.title, 'Mechanical keyboard switches');
});

test('with Wenlo, pages join trails by meaning and search finds by meaning', () => {
  // A stand-in for Wenlo: two topics, known by a few words each.
  const topic = (s) => (/kyoto|ryokan|gion|stay|lodging|japan/i.test(s) ? 'kyoto' : /desk|standing|ergonomic|chair/i.test(s) ? 'desk' : null);
  const trailTopic = (t) => topic([...t.searches, ...t.pages.map((p) => p.title)].join(' '));
  const meaning = {
    affinity: (page, t) => (topic([page.query, page.title, page.h1].join(' ')) === trailTopic(t) && trailTopic(t) ? 0.9 : 0),
    rank: (q, trails) => trails.filter((t) => topic(q) && trailTopic(t) === topic(q)),
  };
  const clock = { t: T0 };
  const tr = new Trails(tmp(), { now: () => clock.t, meaning });
  const a = tr.observe({ url: 'https://www.google.com/search?q=ryokan+near+gion' }, { typed: true });
  clock.t += 5 * DAY;
  // No shared words with "ryokan near gion", but the same topic: joins by meaning.
  const b = tr.observe({ url: 'https://www.google.com/search?q=where+to+stay+in+japan' }, { typed: true });
  assert.strictEqual(b, a);
  tr.observe({ url: 'https://inn.example/hotel/8', title: 'Lodging 8' }, { tabTrail: a, tabAt: clock.t });
  assert.strictEqual(tr.get(a).title, 'Ryokan near gion'); // named by its first search, as without Wenlo
  const d = tr.observe({ url: 'https://www.google.com/search?q=standing+desk' }, { typed: true });
  assert.notStrictEqual(d, a);
  tr.observe({ url: 'https://desk.example/uplift', title: 'Uplift desk' }, { tabTrail: d, tabAt: clock.t });
  assert.deepStrictEqual(tr.list({ query: 'somewhere to stay' }).map((t) => t.id), [a]);
  // A broken Wenlo never breaks learning.
  const broken = new Trails(tmp(), { meaning: { affinity: () => { throw new Error('x'); }, rank: () => { throw new Error('x'); } } });
  assert.ok(broken.observe({ url: 'https://www.google.com/search?q=espresso' }, { typed: true }));
  assert.deepStrictEqual(broken.list({ query: 'espresso' }).length, 0);
});

test('research an AI did: its own trail, titled from the best source, kept apart from the user\'s trails', () => {
  const { tr, clock } = make();
  const r = tr.research({ key: 'session:abc', by: 'Claude Desktop', sessionId: 'session:abc' });
  assert.strictEqual(tr.research({ key: 'session:abc', by: 'Claude Desktop' }), r); // one per research
  tr.researchPage(r, { url: 'https://audio.example/best-anc', title: 'The best noise-cancelling headphones - Audio Mag' });
  assert.strictEqual(tr.get(r).title, ''); // not named by the first page it happened to open
  tr.researchTitle(r, 'Sony WH-1000XM6 vs Bose QC Ultra', 'page');
  tr.researchSearch(r, 'best noise cancelling headphones under 200');
  tr.researchTitle(r, 'best noise cancelling headphones under 200', 'search');
  assert.strictEqual(tr.get(r).title, 'Best noise cancelling headphones under 200'); // a search beats a page title
  tr.researchSearch(r, 'sony vs bose');
  tr.researchTitle(r, 'sony vs bose', 'search');
  assert.strictEqual(tr.get(r).title, 'Best noise cancelling headphones under 200'); // the first search names it
  tr.researchTitle(r, 'headphones for flights under $200', 'goal');
  assert.strictEqual(tr.get(r).title, 'Headphones for flights under $200'); // the AI's own question beats all
  tr.researchSummary(r, 'Sony WH-1000XM6 on sale is the pick');
  const s = tr.list().find((x) => x.id === r);
  assert.strictEqual(s.by, 'Claude Desktop');
  assert.strictEqual(s.researchSummary, 'Sony WH-1000XM6 on sale is the pick');
  // The user's own pages don't join it by topic…
  clock.t += MIN;
  const mine = tr.observe({ url: 'https://www.google.com/search?q=noise+cancelling+headphones+under+200' }, { typed: true });
  assert.notStrictEqual(mine, r);
  // …but do when the user carries on from it.
  assert.strictEqual(tr.observe({ url: 'https://shop.example/sony-xm6', title: 'Sony WH-1000XM6 headphones' }, { tabTrail: r, tabAt: clock.t }), r);
  // Wenlo learns the user, not the AI.
  assert.ok(!tr.trainingSet().some((x) => x.id === r));
  // A user's page that was also in the research isn't filed back into it.
  assert.notStrictEqual(tr.trailOfUrl('https://audio.example/best-anc'), r);
});
