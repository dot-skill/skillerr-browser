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

test('skills never carry personal details: the AI is told what to generalise', () => {
  const opts = { home: '/Users/sam', user: 'samdoe' };
  const ok = { name: 'x-post-thread', description: 'Use when posting a thread on x.com: replies go under the first post.', instructions: 'Open https://x.com/<handle>, click [data-testid="tweetButton"], wait 1500 ms. Upload from ~/<file>. See x.com/home and reddit.com/r/foo.' };
  assert.doesNotThrow(() => skills.checkShareable(ok, opts));
  const bad = (instructions) => () => skills.checkShareable({ ...ok, instructions }, opts);
  assert.throws(bad('Log in as sam@example.com first.'), /email address.*<email>/);
  assert.throws(bad('Open https://x.com/samdoe_real and post.'), /profile link with a real handle.*x\.com\/<handle>/);
  assert.throws(bad('Call +1 (415) 555-0199 if stuck.'), /phone number/);
  assert.throws(bad('Attach /Users/sam/Pictures/me.png.'), /home folder/);
  assert.throws(bad('Use key sk-abcdefghijklmnop1234 for the API.'), /key or token/);
  assert.throws(bad('password: hunter22 goes in the box.'), /password or secret/);
  assert.throws(bad('Check order 112233445566 status.'), /long number/);
  assert.throws(bad('Mention @samsfriend in the reply.'), /@handle/);
  assert.throws(bad('Sign as samdoe at the end.'), /user's name/);
  assert.throws(bad('Log in as sam@example.com first.'), /Not saved.*placeholder/);
});

test('drafts: kept as suggestions, refined by name, installed only when accepted', () => {
  const d = { name: 'x-post-thread', description: 'Use when posting a thread on x.com: replies go under the first post.', instructions: 'Post the first one, then reply to it. '.repeat(3), by: 'Claude Code' };
  assert.strictEqual(skills.draft(d).refined, false);
  assert.strictEqual(skills.draft({ ...d, instructions: 'Post the first, then reply to your own post each time. '.repeat(2) }).refined, true);
  assert.strictEqual(skills.drafts().length, 1, 'same name refines, never duplicates');
  assert.match(skills.drafts()[0].instructions, /your own post/);
  assert.match(skills.listText(), /1 suggested skill awaiting the user .*: x-post-thread/);
  assert.ok(!skills.get('x-post-thread'), 'not a skill yet');
  assert.throws(() => skills.useText('x-post-thread'), /hasn't saved yet, so it can't be used/);
  const r = skills.acceptDraft('x-post-thread');
  assert.strictEqual(r.skill.name, 'x-post-thread');
  assert.match(skills.get('x-post-thread').trust.summary, /Learned by Claude Code/);
  assert.match(skills.useText('x-post-thread'), /your own post/);
  assert.strictEqual(skills.drafts().length, 0);
  assert.doesNotMatch(skills.listText(), /awaiting the user/);
  skills.draft(d);
  skills.dropDraft('x-post-thread');
  assert.strictEqual(skills.drafts().length, 0);
  assert.throws(() => skills.acceptDraft('x-post-thread'), /gone/);
});

// The approval gate lives in src/main.js (Electron): an unanswered save_skill (or Later) becomes a draft, never a skill,
// and "Later" can't count as a yes for anything.
test('save_skill without an answer is kept as a suggestion, and Later is never a yes', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /const ok = answer === 'later' \? null : answer;/);
  assert.match(main, /if \(name === 'save_skill' && ok === null\) \{\n\s+const \{ draft, refined \} = skills\.draft\(/);
  assert.ok(main.indexOf('skills.checkShareable(args)') < main.indexOf('const answer = await requestApproval('), 'personal details are refused before anyone is asked');
});
