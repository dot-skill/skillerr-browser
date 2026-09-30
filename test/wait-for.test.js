// wait_for: what counts as "it happened". main.js only watches the tab; it never clicks or types.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { checkUntil, met, labelMatches } = require('../src/wait-for');

test('wait_for: exactly one condition, checked, with a clamped wait', () => {
  assert.throws(() => checkUntil({}), /exactly one/);
  assert.throws(() => checkUntil({ navigated: true, text_appears: 'x' }), /exactly one/);
  assert.throws(() => checkUntil({ clicked: 'Reply' }), /Unknown condition/);
  assert.throws(() => checkUntil({ user_clicked: ' ' }), /label/);
  assert.throws(() => checkUntil({ element_gone: ['x'] }), /\[id\]/);
  assert.throws(() => checkUntil({ url_matches: '/(/' }), /regular expression/);
  assert.strictEqual(checkUntil({ navigated: true }).ms, 120000);
  assert.strictEqual(checkUntil({ navigated: true }, 9999).ms, 600000);
  assert.deepStrictEqual(checkUntil({ element_gone: 12 }).ids, [12]);
});

test('wait_for: url, text, elements and navigation', () => {
  const url = (p, u) => met(checkUntil({ url_matches: p }), { url: u });
  assert.ok(url('x.com/*/status/*', 'https://x.com/someone/status/123'));
  assert.ok(!url('x.com/*/status/*', 'https://x.com/home'));
  assert.ok(url('/status\\/\\d+$/', 'https://x.com/a/status/42'));
  assert.ok(url('checkout/done', 'https://shop.example/checkout/done?x=1'));
  const text = checkUntil({ text_appears: 'Your post was sent' });
  assert.ok(met(text, { text: 'Top\nYour  post was\nsent. View' }), 'whitespace and case don\'t matter');
  assert.ok(!met(text, { text: 'Sending…' }));
  const gone = checkUntil({ element_gone: [7, 9] });
  assert.ok(!met(gone, { present: null }), 'not checked yet is not gone');
  assert.ok(!met(gone, { present: { 7: false, 9: true } }));
  assert.deepStrictEqual(met(gone, { present: { 7: false, 9: false } }), { what: 'element_gone', ids: [7, 9] });
  const nav = checkUntil({ navigated: true });
  assert.ok(!met(nav, { url: 'https://a.example/', startUrl: 'https://a.example/', navigations: 0 }));
  assert.ok(met(nav, { url: 'https://a.example/', startUrl: 'https://a.example/', navigations: 1 }));
  assert.ok(met(nav, { url: 'https://a.example/b', startUrl: 'https://a.example/', navigations: 0 }));
});

test('wait_for: user_clicked matches the label of what the user clicked', () => {
  const reply = checkUntil({ user_clicked: 'Reply' });
  assert.ok(!met(reply, { clicks: [] }));
  assert.ok(!met(reply, { clicks: ['Post', 'Replying to @someone'] }), '"Replying" is not "Reply"');
  assert.deepStrictEqual(met(reply, { clicks: ['Cancel', '  reply '] }), { what: 'user_clicked' });
  assert.ok(labelMatches('reply', 'Reply all'));
  assert.ok(labelMatches('reply', 'Reply · 3'));
  assert.ok(!labelMatches('reply', ''));
});

// main.js: the watcher only listens and reads; the AI's own clicks are not the user's.
test('wait_for only observes the tab', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const fn = main.slice(main.indexOf('async function waitFor'), main.indexOf('// The `ask` tool'));
  assert.doesNotMatch(fn, /sendInputEvent|\.click\(|runTool|BROWSER_TOOLS|loadURL|[^-]navigate\(/);
  assert.match(fn, /skillerrAiInputAt/);
  assert.match(main, /const READ_ONLY = new Set\(\['wait_for',/);
});
