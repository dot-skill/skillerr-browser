// What each AI app did in its research session: the live view's tabs and its Audit list.
const test = require('node:test');
const assert = require('node:assert');
const { AiActivity, pickPreviewTabs } = require('../src/ai-activity');

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t };
  return c;
}

test('a session continues while the AI works, and a new one starts after a long pause', () => {
  const c = clock();
  const a = new AiActivity({ now: c.now });
  const s1 = a.touch('Claude');
  c.t += 5 * 60 * 1000;
  assert.strictEqual(a.touch('Claude'), s1);
  assert.notStrictEqual(a.touch('Cursor'), s1, 'each app has its own');
  c.t += 16 * 60 * 1000;
  assert.strictEqual(a.current('Claude'), null, 'over after the gap');
  assert.notStrictEqual(a.touch('Claude'), s1);
});

test('the Audit list has every attempt, one line per page, most recent first', () => {
  const c = clock();
  const a = new AiActivity({ now: c.now });
  const s = a.touch('Claude');
  a.record(s, { url: 'https://en.wikipedia.org/wiki/Dinosaur', title: 'Dinosaur', tool: 'fetch_page', state: 'read' });
  c.t += 1000;
  a.record(s, { url: 'https://dead.example/', tool: 'fetch_page', state: 'failed', reason: "The page didn't load" });
  c.t += 1000;
  a.record(s, { url: 'https://shop.example/pay', tool: 'navigate', state: 'declined', reason: 'You declined it' });
  c.t += 1000;
  a.record(s, { url: 'https://en.wikipedia.org/wiki/Dinosaur#Evolution', tool: 'navigate', state: 'opened' });
  a.record(s, { url: 'about:blank', tool: 'new_tab', state: 'opened' });
  const list = a.list('Claude');
  assert.deepStrictEqual(list.map((p) => p.state), ['read', 'declined', 'failed']);
  assert.strictEqual(list[0].title, 'Dinosaur', 'a page that was read stays read, with its title');
  assert.strictEqual(list[0].attempts, 2);
  assert.strictEqual(list[2].reason, "The page didn't load");
  assert.strictEqual(a.count('Claude'), 3);
  assert.deepStrictEqual(a.list('Cursor'), [], "another app's session is its own");
});

test('a later success replaces a failure for the same page', () => {
  const a = new AiActivity();
  const s = a.touch('Claude');
  a.record(s, { url: 'https://flaky.example/', state: 'failed', reason: 'timeout' });
  a.record(s, { url: 'https://flaky.example', state: 'read', title: 'Flaky' });
  const [p] = a.list('Claude');
  assert.strictEqual(p.state, 'read');
  assert.strictEqual(p.reason, undefined);
});

test("the live view shows only this session's tabs, never the user's", () => {
  const now = 50_000;
  const tabs = [
    { id: 1, aiBy: undefined, aiUntil: now + 3000 }, // the user's own tab (an AI only looked at it)
    { id: 2, aiBy: 'Claude', aiSession: 'old', aiUntil: now + 3000 }, // an earlier session
    { id: 3, aiBy: 'Cursor', aiSession: 'c1', aiUntil: now + 3000 }, // another app
    { id: 4, aiBy: 'Claude', aiSession: 's1', aiUntil: now - 60_000 },
    { id: 5, isStart: true, aiBy: 'Claude', aiSession: 's1', aiUntil: now + 3000 },
  ];
  assert.deepStrictEqual(pickPreviewTabs(tabs, { client: 'Claude', session: 's1', now }), { mode: 'single', ids: [4] });
  assert.deepStrictEqual(pickPreviewTabs(tabs, { client: 'Claude', session: null, now }), { mode: 'single', ids: [] }, 'no session, nothing');
  assert.deepStrictEqual(pickPreviewTabs(tabs.slice(0, 3), { client: 'Claude', session: 's1', now }).ids, [], 'no fallback to other tabs');
});

test('several tabs at once show as the fleet; side-by-side tabs only if they are the session\'s', () => {
  const now = 50_000;
  const tabs = [
    { id: 1 },
    { id: 2, aiBy: 'Claude', aiSession: 's1', aiUntil: now + 2000 },
    { id: 3, aiBy: 'Claude', aiSession: 's1', aiUntil: now + 3000 },
  ];
  assert.deepStrictEqual(pickPreviewTabs(tabs, { client: 'Claude', session: 's1', now }), { mode: 'fleet', ids: [3, 2] });
  assert.deepStrictEqual(pickPreviewTabs(tabs, { client: 'Claude', session: 's1', now: now + 120_000, mosaic: [1, 2, 3] }), { mode: 'fleet', ids: [2, 3] });
  assert.deepStrictEqual(pickPreviewTabs(tabs, { client: 'Claude', session: 's1', now: now + 120_000, mosaic: [1, 3] }), { mode: 'single', ids: [3] });
});
