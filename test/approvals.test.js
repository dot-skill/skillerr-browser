// Approvals wait long enough for a person in another window to notice, and an unanswered one says so plainly.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const store = require('../src/store');

test('approval wait: 2 minutes by default, 30 s to 10 min if set', () => {
  assert.strictEqual(store.approvalWaitMs({}), 120000);
  assert.strictEqual(store.approvalWaitMs({ approvalWaitS: 300 }), 300000);
  assert.strictEqual(store.approvalWaitMs({ approvalWaitS: 5 }), 30000);
  assert.strictEqual(store.approvalWaitMs({ approvalWaitS: 99999 }), 600000);
  assert.strictEqual(store.approvalWaitMs({ approvalWaitS: 'soon' }), 120000);
});

test('an unanswered approval tells the AI "no answer yet", and the user is called over', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const gate = main.slice(main.indexOf('function requestApproval'), main.indexOf('// ---------- undo'));
  assert.match(gate, /store\.approvalWaitMs\(store\.getSettings\(\)\)/);
  assert.match(gate, /callForAttention\(/);
  assert.match(main, /'No answer yet: this action needs the user\\'s OK in Skillerr/);
  assert.doesNotMatch(main, /APPROVAL_TIMEOUT_MS/);
});
