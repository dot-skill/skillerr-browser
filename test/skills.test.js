const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.HOME = process.env.USERPROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'skillerr-home-')); // before store.js reads it
const skills = require('../src/skills');

test('built-in skills load from SKILL.md frontmatter', () => {
  const names = skills.list().map((s) => s.name);
  assert.ok(names.includes('demo-recorder'));
  assert.ok(names.includes('screenshots'));
  assert.ok(names.includes('clear-popups'));
  for (const s of skills.list()) assert.ok(s.description.length > 0, s.name);
});

test('learn writes a standard skill and validates input', () => {
  assert.throws(() => skills.learn({ name: 'Bad Name', description: 'x', instructions: 'y' }), /lowercase/);
  assert.throws(() => skills.learn({ name: 'ok-name', description: 'short', instructions: 'y'.repeat(50) }), /description/);
  assert.throws(() => skills.learn({ name: 'demo-recorder', description: 'Use when recording demos of a web app flow.', instructions: 'y'.repeat(50) }), /built-in/);
  const r = skills.learn({ name: 'ana-flight-search', description: 'Use when searching ANA flights: the date picker needs two clicks.', instructions: 'Open the search form, then '.repeat(3), topics: ['Travel'], by: 'Claude' });
  assert.strictEqual(r.updated, false);
  assert.ok(fs.readFileSync(r.file, 'utf8').startsWith('---\nname: ana-flight-search\n'));
  const got = skills.get('ana-flight-search');
  assert.strictEqual(got.trust.state, 'learned');
  assert.strictEqual(skills.learn({ name: 'ana-flight-search', description: 'Use when searching ANA flights: the date picker needs two clicks.', instructions: 'x'.repeat(60), by: 'Claude' }).updated, true);
});
