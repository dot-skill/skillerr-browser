// `ask`: buttons in the Pilot panel that steer the AI. The call waits for a click, and a click is never an approval.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { checkAsk, Asks } = require('../src/ask');

test('ask: options are checked and cleaned, the wait is clamped', () => {
  const q = checkAsk({ text: 'Posted it?', options: ['  Done,   next ', 'Skip this one'] });
  assert.deepStrictEqual(q, { text: 'Posted it?', options: ['Done, next', 'Skip this one'], ms: 300000 });
  assert.strictEqual(checkAsk({ text: 'x', options: ['a', 'b'], timeout_s: 9999 }).ms, 600000);
  assert.strictEqual(checkAsk({ text: 'x', options: ['a', 'b'], timeout_s: 0 }).ms, 5000);
  assert.throws(() => checkAsk({ text: '', options: ['a', 'b'] }), /question/);
  assert.throws(() => checkAsk({ text: 'x', options: ['only one'] }), /2 to 5/);
  assert.throws(() => checkAsk({ text: 'x', options: ['a', 'b', 'c', 'd', 'e', 'f'] }), /2 to 5/);
  assert.throws(() => checkAsk({ text: 'x', options: ['a', ' '] }), /empty/);
  assert.throws(() => checkAsk({ text: 'x', options: ['a', 'x'.repeat(41)] }), /40 characters/);
  assert.throws(() => checkAsk({ text: 'x', options: ['Next', 'next'] }), /different/);
});

test('ask: a click returns the label; only an offered label counts', async () => {
  const asks = new Asks();
  const wait = asks.open(1, 'Claude Code', ['Done, next', 'Skip'], 60000);
  assert.strictEqual(asks.answer(1, 'Allow'), false, 'a label the AI never offered is ignored');
  assert.strictEqual(asks.answer(2, 'Skip'), false, 'an id that is not an open ask is ignored');
  assert.strictEqual(asks.answer(1, 'Done, next'), true);
  assert.deepStrictEqual(await wait, { choice: 'Done, next' });
  assert.strictEqual(asks.answer(1, 'Skip'), false, 'answered once');
  assert.strictEqual(asks.size, 0);
});

test('ask: no click in time is "no answer yet", not an error', async () => {
  const asks = new Asks();
  assert.deepStrictEqual(await asks.open(1, 'Cursor', ['a', 'b'], 20), { choice: null, status: 'no answer yet' });
  assert.strictEqual(asks.size, 0);
});

test('ask: a newer ask from the same app supersedes; pausing ends them all', async () => {
  const asks = new Asks();
  const first = asks.open(1, 'Claude Code', ['a', 'b'], 60000);
  const other = asks.open(2, 'Cursor', ['a', 'b'], 60000);
  const second = asks.open(3, 'Claude Code', ['c', 'd'], 60000);
  assert.deepStrictEqual(await first, { choice: null, status: 'superseded' });
  asks.finishAll('paused');
  assert.deepStrictEqual(await other, { choice: null, status: 'paused' });
  assert.deepStrictEqual(await second, { choice: null, status: 'paused' });
});

// The approval gate lives in src/main.js (Electron), so this reads its wiring: an ask returns before the gate, and a
// click in the panel resolves asks only. Approvals are only ever decided by the 'approval' message and requestApproval.
test('ask buttons never reach the approval gate', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const exec = main.slice(main.indexOf('async function executeInSession'));
  assert.ok(exec.indexOf("if (name === 'ask') return askUser(") < exec.indexOf('requestApproval('), 'ask returns before the approval gate');
  const askFn = main.slice(main.indexOf('async function askUser'), main.indexOf('const tabTitle'));
  assert.doesNotMatch(askFn, /pendingApprovals|requestApproval|awaitingApproval/);
  const ipc = main.split('\n').find((l) => l.includes("ipcMain.on('ask-choice'"));
  assert.match(ipc, /asks\.answer\(/);
  assert.doesNotMatch(ipc, /pendingApprovals/);
  assert.match(main, /ipcMain\.on\('approval', \(_e, \{ id, ok \}\) => pendingApprovals\.get\(id\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'src', 'ask.js'), 'utf8'), /pendingApprovals|require\(/, 'ask.js holds no approval state and loads nothing');
});

test('ask cards escape their labels and are not approval prompts', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ui.js'), 'utf8');
  const card = ui.slice(ui.indexOf('function askCard'), ui.indexOf("skillerr.on('undo-top'"));
  assert.match(card, /\$\{esc\(o\)\}/, 'labels are escaped');
  assert.doesNotMatch(card, /class="[^"]*\b(allow|deny)\b/, 'no Allow / Deny buttons');
  assert.match(ui, /skillerr\.send\('ask-choice', \{ id: e\.id, choice: e\.args\.options\[i\] \}\)/);
});

test('the step log says what was asked and what the user chose', () => {
  const ctx = {};
  vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'shared.js'), 'utf8')}\nthis.describeStep = describeStep;`, ctx);
  const e = { tool: 'ask', args: { text: '\nPosted it?\nMore detail', options: ['Done, next', 'Skip'] } };
  assert.strictEqual(ctx.describeStep(e).text, 'Asked: Posted it?');
  assert.strictEqual(ctx.describeStep({ ...e, choice: 'Done, next' }).text, 'Asked: Posted it? → Done, next');
  assert.strictEqual(ctx.describeStep({ ...e, choice: null, status: 'no answer yet' }).text, 'Asked: Posted it? → no answer yet');
  assert.strictEqual(ctx.describeStep({ tool: 'ask', args: { text: '## **Posted** `reply 2`?' } }).text, 'Asked: Posted reply 2?');
});
