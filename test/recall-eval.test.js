// The recall quality check (scripts/eval-recall.js) must keep passing.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');

test('recall eval passes every case', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'eval-recall.js')], { encoding: 'utf8' });
  assert.match(out, /(\d+)\/\1 passed/);
});
