const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Trails, searchQuery, cleanTitle, pageKey } = require('../src/trails');

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

test('an unrelated search starts a new trail; days later the same topic is a new journey unless the old one is continued', () => {
  const { tr, clock } = make();
  const kyoto = tr.observe({ url: 'https://www.google.com/search?q=kyoto+ryokan' }, { typed: true });
  tr.observe({ url: 'https://ryokan.example/kyoto-gion', title: 'Ryokan in Kyoto Gion' }, { tabTrail: kyoto, tabAt: clock.t });
  tr.observe({ url: 'https://ryokan.example/kyoto-arashiyama', title: 'Ryokan in Kyoto Arashiyama' }, { tabTrail: kyoto, tabAt: clock.t });
  clock.t += 5 * MIN;
  const desk = tr.observe({ url: 'https://www.google.com/search?q=standing+desk+under+500' }, { tabTrail: kyoto, tabAt: clock.t - MIN, typed: true });
  assert.notStrictEqual(desk, kyoto);
  tr.observe({ url: 'https://desks.example/uplift-v2', title: 'Uplift V2 standing desk' }, { tabTrail: desk, tabAt: clock.t });
  // Within the same sitting, a related search joins the journey that's going on.
  clock.t += 10 * MIN;
  assert.strictEqual(tr.observe({ url: 'https://www.google.com/search?q=kyoto+gion+ryokan+prices' }, { typed: true }), kyoto);
  // Days later, a trail is one journey: the same topic typed afresh is a new journey, not the old one's pages.
  clock.t += 3 * DAY;
  const fresh = tr.observe({ url: 'https://www.google.com/search?q=kyoto+gion+ryokan+dinner' }, { typed: true });
  assert.notStrictEqual(fresh, kyoto);
  // …while a page opened from the old trail's own tab (the user continued it) carries on that journey.
  clock.t += MIN;
  assert.strictEqual(tr.observe({ url: 'https://ryokan.example/kyoto-higashiyama', title: 'Ryokan in Kyoto Higashiyama' }, { tabTrail: kyoto, tabAt: clock.t - MIN }), kyoto);
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

test('closed pages are done with: never among a trail\'s tabs, never reopened; progress through the journey', () => {
  const { tr, clock } = make();
  const id = tr.observe({ url: 'https://www.google.com/search?q=espresso+machine' }, { typed: true });
  const pages = ['https://coffee.example/a', 'https://coffee.example/b', 'https://coffee.example/c', 'https://coffee.example/d'];
  pages.forEach((u, i) => tr.observe({ url: u, title: `Espresso machine ${'abcd'[i]}` }, { tabTrail: id, tabAt: clock.t }));
  // a and b were closed during the sitting; c was read halfway; c and d were still open when Skillerr quit.
  assert.ok(tr.closePage(id, pages[0]));
  assert.ok(tr.closePage(id, pages[1]));
  tr.leave(id, pages[2], { long: true, scroll: 0.5, dwellMs: 60000 });
  tr.tuck(id, [{ url: pages[2], title: 'c' }, { url: pages[3], title: 'd' }], 'quit');
  const s = tr.list()[0];
  assert.deepStrictEqual(s.tabs.map((x) => x.url), [pages[2], pages[3]]); // only what was still open
  assert.strictEqual(s.progress, 0.63); // a, b done; c half read; d still waiting, unread: 2.5 of 4
  // a page closed after being put away leaves the shelf too
  tr.closePage(id, pages[3]);
  assert.deepStrictEqual(tr.shelf().trails[0].tabs.map((x) => x.url), [pages[2]]);
  // visiting a closed page again brings it back into the journey
  tr.observe({ url: pages[0], title: 'Espresso machine a' }, { tabTrail: id, tabAt: clock.t });
  assert.ok(!tr.get(id).pages.find((p) => p.url === pages[0]).closed);
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

test('with Kilr, pages join trails by meaning and search finds by meaning', () => {
  // A stand-in for Kilr: two topics, known by a few words each.
  const topic = (s) => (/kyoto|ryokan|gion|stay|lodging|japan/i.test(s) ? 'kyoto' : /desk|standing|ergonomic|chair/i.test(s) ? 'desk' : null);
  const trailTopic = (t) => topic([...t.searches, ...t.pages.map((p) => p.title)].join(' '));
  const meaning = {
    affinity: (page, t) => (topic([page.query, page.title, page.h1].join(' ')) === trailTopic(t) && trailTopic(t) ? 0.9 : 0),
    rank: (q, trails) => trails.filter((t) => topic(q) && trailTopic(t) === topic(q)),
  };
  const clock = { t: T0 };
  const tr = new Trails(tmp(), { now: () => clock.t, meaning });
  const a = tr.observe({ url: 'https://www.google.com/search?q=ryokan+near+gion' }, { typed: true });
  clock.t += 20 * MIN;
  // No shared words with "ryokan near gion", but the same topic, in the same sitting: joins by meaning.
  const b = tr.observe({ url: 'https://www.google.com/search?q=where+to+stay+in+japan' }, { typed: true });
  assert.strictEqual(b, a);
  tr.observe({ url: 'https://inn.example/hotel/8', title: 'Lodging 8' }, { tabTrail: a, tabAt: clock.t });
  tr.observe({ url: 'https://inn.example/hotel/9', title: 'Lodging 9' }, { tabTrail: a, tabAt: clock.t });
  assert.strictEqual(tr.get(a).title, 'Ryokan near gion'); // named by its first search, as without Kilr
  const d = tr.observe({ url: 'https://www.google.com/search?q=standing+desk' }, { typed: true });
  assert.notStrictEqual(d, a);
  tr.observe({ url: 'https://desk.example/uplift', title: 'Uplift desk' }, { tabTrail: d, tabAt: clock.t });
  assert.deepStrictEqual(tr.list({ query: 'somewhere to stay' }).map((t) => t.id), [a]);
  // Days later the same topic typed afresh is a new journey: meaning joins only a journey that's going on.
  clock.t += 5 * DAY;
  assert.notStrictEqual(tr.observe({ url: 'https://www.google.com/search?q=japan+lodging+october' }, { typed: true }), a);
  // A broken Kilr never breaks learning.
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
  // Kilr learns from the AI's research too, unless the user turns that off; and the list can show either.
  assert.strictEqual(tr.trainingSet().find((x) => x.id === r).source, 'ai');
  assert.ok(!tr.trainingSet({ ai: false }).some((x) => x.id === r));
  assert.ok(tr.trainingSet({ you: false }).every((x) => x.source === 'ai'));
  assert.ok(tr.list({ who: 'ai' }).every((x) => x.by));
  assert.ok(tr.list({ who: 'you' }).every((x) => !x.by));
  // A user's page that was also in the research isn't filed back into it.
  assert.notStrictEqual(tr.trailOfUrl('https://audio.example/best-anc'), r);
});

test('Chrome session files: the tabs open now, at their current page, in window order', () => {
  const { parseSession } = require('../src/chrome-import');
  const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f));
  // Recorded from Chromium 141 with six tabs; the last one opened is in front.
  const a = parseSession(fx('chrome-session.snss'));
  assert.deepStrictEqual(a.map((t) => t.url.split('/').pop()), ['hp1.html', 'hp2.html', 'py1.html', 'japan0.html', 'rust1.html', 'baby2.html']);
  assert.deepStrictEqual(a.filter((t) => t.active).map((t) => t.url.split('/').pop()), ['baby2.html']);
  // Recorded after navigating one tab (hp2 → hp3) and closing another (py1).
  const b = parseSession(fx('chrome-session-2.snss'));
  assert.deepStrictEqual(b.map((t) => t.url.split('/').pop()), ['hp1.html', 'hp3.html']);
  assert.throws(() => parseSession(Buffer.from('not a session')), /Not a Chrome session/);
});

test('an import of many tabs is grouped all at once, merging only what is alike', () => {
  const { clusterItems } = require('../src/trails');
  // 0,1,2 alike; 3,4 alike; 5 alone. Groups merge while their average similarity stays at the threshold or above.
  const S = [
    [0, 0.6, 0.5, 0, 0, 0], [0.6, 0, 0.4, 0, 0, 0.1], [0.5, 0.4, 0, 0, 0.05, 0],
    [0, 0, 0, 0, 0.7, 0], [0, 0, 0.05, 0.7, 0, 0], [0, 0.1, 0, 0, 0, 0]];
  const groups = clusterItems(6, (i, j) => S[i][j], { threshold: 0.2 }).map((g) => g.sort().join(',')).sort();
  assert.deepStrictEqual(groups, ['0,1,2', '3,4', '5']);
});
