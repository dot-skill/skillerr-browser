const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { History, KEEP_MS } = require('../src/history');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'skillerr-history-'));
const MIN = 60 * 1000;

test('browsing history: visits, titles, search, who opened it, and surviving a restart', () => {
  const dir = tmp();
  const clock = { t: Date.parse('2026-09-01T09:00:00Z') };
  const h = new History(dir, { now: () => clock.t });
  const a = h.add({ url: 'https://ryokan.example/gion', tabId: 1 });
  h.update(a, { title: 'Ryokan in Gion' });
  clock.t += MIN;
  assert.strictEqual(h.add({ url: 'https://ryokan.example/gion', tabId: 1 }), a, 'a reload is the same visit');
  h.add({ url: 'https://desk.example/uplift', title: 'Uplift desk', tabId: 2, by: 'Claude Desktop' });
  assert.strictEqual(h.add({ url: 'about:blank' }), null);
  assert.deepStrictEqual(h.list().map((v) => v.title), ['Uplift desk', 'Ryokan in Gion']);
  assert.deepStrictEqual(h.list({ q: 'gion' }).map((v) => v.url), ['https://ryokan.example/gion']);
  assert.strictEqual(h.list()[0].by, 'Claude Desktop');
  h.flush();
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(path.join(dir, 'history.jsonl')).mode & 0o777, 0o600);
  const again = new History(dir, { now: () => clock.t });
  assert.deepStrictEqual(again.list().map((v) => v.title), ['Uplift desk', 'Ryokan in Gion']);
});

test('browsing history: delete pages, delete the last hour, clear all; old visits fall off', () => {
  const dir = tmp();
  const clock = { t: Date.parse('2026-09-01T09:00:00Z') };
  const h = new History(dir, { now: () => clock.t });
  h.add({ url: 'https://old.example/', title: 'Old', tabId: 1 });
  clock.t += 3 * 60 * MIN;
  h.add({ url: 'https://a.example/', title: 'A', tabId: 1 });
  h.add({ url: 'https://b.example/', title: 'B', tabId: 1 });
  h.deleteUrls(['https://a.example/']);
  assert.deepStrictEqual(h.list().map((v) => v.title), ['B', 'Old']);
  h.deleteSince(clock.t - 60 * MIN);
  assert.deepStrictEqual(h.list().map((v) => v.title), ['Old']);
  h.flush();
  assert.deepStrictEqual(new History(dir, { now: () => clock.t }).list().map((v) => v.title), ['Old'], 'deletions survive a restart');
  clock.t += KEEP_MS;
  assert.deepStrictEqual(new History(dir, { now: () => clock.t }).list(), [], 'visits older than 90 days fall off');
  h.deleteSince(0);
  assert.deepStrictEqual(new History(dir, { now: () => clock.t }).list(), []);
});
