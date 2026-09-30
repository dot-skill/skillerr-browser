// The "Connect an AI app" card is for someone with no way to drive Skillerr yet, never while an AI app is connected.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('connect card: only with no built-in AI, no connected app and no app calls this run', () => {
  const ctx = {};
  vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'shared.js'), 'utf8')}\nthis.needsConnectCard = needsConnectCard;`, ctx);
  assert.strictEqual(ctx.needsConnectCard({ aiReady: false, appConnected: false, appActed: false }), true);
  assert.strictEqual(ctx.needsConnectCard({ aiReady: false, appConnected: true, appActed: false }), false, 'Claude Code configured');
  assert.strictEqual(ctx.needsConnectCard({ aiReady: false, appConnected: false, appActed: true }), false, 'an app called in this run');
  assert.strictEqual(ctx.needsConnectCard({ aiReady: true, appConnected: false, appActed: false }), false);
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ui.js'), 'utf8');
  assert.match(ui, /\$\('noPilot'\)\.hidden = !needsConnectCard\(\{ aiReady, appConnected, appActed \}\)/);
  assert.doesNotMatch(ui, /\$\('noPilot'\)\.hidden = aiReady/);
});
