const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Trails } = require('../src/trails');
const { Kilr } = require('../src/kilr');
const { suggestSkills, skillMarkdown, kindOf, pattern } = require('../src/kilr/suggest');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-06-01T09:00:00Z');
const kilr = new Kilr();

const google = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

// Browse like a person: each session is a search or two, then pages, a minute apart, in one tab.
function browse(sessions) {
  const clock = { t: T0 };
  const tr = new Trails(fs.mkdtempSync(path.join(os.tmpdir(), 'skillerr-suggest-')), { now: () => clock.t, meaning: kilr });
  for (const s of sessions) {
    clock.t = T0 + s.day * DAY;
    let trail = null;
    let first = true;
    for (const step of s.steps) {
      clock.t += 60 * 1000;
      const page = typeof step === 'string' ? { url: google(step), title: `${step} - Google Search` } : step;
      const ctx = first ? { typed: true } : { tabTrail: trail, tabAt: clock.t - 60 * 1000 };
      trail = tr.observe({ ...page, at: clock.t }, ctx) || trail;
      first = false;
    }
  }
  return tr;
}

const product = (day, thing, slug, thread) => ({
  day,
  steps: [
    `best ${thing} 2026`,
    { url: `https://www.rtings.com/${slug}/reviews/best`, title: `The 6 Best ${thing} of 2026 - RTINGS.com` },
    `${thing} review reddit`,
    { url: `https://www.reddit.com/r/${thread[0]}/comments/x${day}/${slug}`, title: `${thread[1]} : r/${thread[0]}` },
    { url: `https://www.amazon.com/${slug}-pro/dp/B0${day}`, title: `${thing} Pro 2 - Amazon.com` },
  ],
});

const SESSIONS = [
  product(0, 'noise cancelling headphones', 'headphones', ['headphones', 'Sony XM5 or Bose QC Ultra for flights?']),
  product(2, 'standing desk', 'desk', ['StandingDesk', 'Uplift V2 vs Flexispot E7 after a year']),
  product(5, '4k monitor', 'monitor', ['Monitors', 'Is 27 inch 4K worth it for coding?']),
  product(9, 'robot vacuum', 'vacuum', ['RobotVacuums', 'Roborock S8 or Roomba j7 with pets']),
  // Coding questions on different days: a kind of task done three times, but no shared searches or sites in most.
  { day: 20, steps: ['rust tokio select timeout', { url: 'https://docs.rs/tokio/latest/tokio/macro.select.html', title: 'select in tokio - Rust' }, { url: 'https://tokio.rs/tokio/tutorial/select', title: 'Select | Tokio - An asynchronous Rust runtime' }] },
  { day: 36, steps: ['rust async trait lifetime error', { url: 'https://stackoverflow.com/questions/1/async-trait-lifetime', title: 'Lifetime error with async fn in trait' }, { url: 'https://docs.rs/async-trait/latest/async_trait/', title: 'async_trait - Rust' }] },
  { day: 52, steps: ['rust pin future explained', { url: 'https://docs.rs/pin-project/latest/pin_project/', title: 'pin_project - Rust' }, { url: 'https://tokio.rs/tokio/tutorial/async', title: 'Async in depth | Tokio - An asynchronous Rust runtime' }] },
  // One-offs that shouldn't become anything.
  { day: 3, steps: ['kyoto ryokan near gion', { url: 'https://www.japan-guide.com/e/e3902.html', title: 'Gion - Kyoto Travel' }, { url: 'https://www.booking.com/hotel/jp/gion-ryokan.html', title: 'Gion Ryokan, Kyoto' }] },
  { day: 7, steps: ['banana bread recipe', { url: 'https://www.allrecipes.com/recipe/20144/banana-banana-bread/', title: 'Banana Banana Bread Recipe' }] },
];


test('suggest: kinds of task and search patterns', () => {
  assert.equal(kindOf({ searches: ['best standing desk under 500'], pages: [] }).key, 'buy');
  assert.equal(kindOf({ searches: ['best hotels in kyoto'], pages: [] }).key, 'travel');
  assert.equal(kindOf({ searches: ['easy banana bread recipe'], pages: [] }).key, 'cook');
  assert.equal(kindOf({ searches: ['npm install error EACCES'], pages: [] }).key, 'fix');
  assert.equal(kindOf({ searches: ['kyoto'], pages: [] }), null);
  assert.equal(pattern('best noise cancelling headphones 2026'), `best … ${new Date().getFullYear()}`);
  assert.equal(pattern('sony xm5 vs bose qc ultra'), '… vs …');
  assert.equal(pattern('standing desk review reddit'), '… review reddit');
  assert.equal(pattern('tokio select timeout'), null);
});

test('suggest: a way of doing a task, learned from repeated trails', () => {
  const tr = browse(SESSIONS);
  const trails = tr.forSkills();
  const out = suggestSkills(trails);
  const how = out.find((s) => s.id === 'how:buy');
  assert.ok(how, JSON.stringify(out.map((s) => s.id)));
  assert.equal(how.count, 4);
  assert.match(how.instructions, /best … \d{4}/);
  assert.match(how.instructions, /… review reddit/);
  assert.ok(how.instructions.indexOf('best …') < how.instructions.indexOf('… review reddit'), 'searches in the order they are typed');
  const order = ['rtings.com', 'reddit.com', 'amazon.com'].map((h) => how.instructions.indexOf(h));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'sites in the order they are used');
  assert.match(how.why, /You did this 4 times on 4 days/);
  assert.ok(!out.some((s) => s.id === 'how:travel' || s.id === 'how:cook'), 'one-offs are not habits');
  const md = skillMarkdown(how);
  assert.match(md, /^---\nname: how-i-choose-products\ndescription: "Use when/);
});

test('suggest: research an AI did counts, and says who did it; nothing when there is no habit', () => {
  const tr = browse(SESSIONS.slice(0, 2));
  assert.deepEqual(suggestSkills(tr.forSkills()), []);
  const t = browse(SESSIONS);
  const trails = t.forSkills().map((x, i) => (i % 2 ? { ...x, by: 'Claude Desktop' } : x));
  const how = suggestSkills(trails).find((s) => s.id === 'how:buy');
  assert.match(how.why, /You and Claude Desktop did this 4 times/);
  assert.ok(suggestSkills(trails.filter((x) => !x.by)).every((s) => s.id !== 'how:buy'), 'two trails are not a habit');
});
