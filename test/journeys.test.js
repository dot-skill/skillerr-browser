// Moving over from Chrome: the Orb sorts long-kept open tabs into journeys by sitting and topic, with no other AI.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { Kilr } = require('../src/kilr');
const { cosine } = require('../src/kilr/embed');
const { groupTabs, readableTitle } = require('../src/kilr/journeys');

const orb = new Kilr({ dir: path.join(__dirname, '..', 'assets', 'kilr') });
const meaning = { vec: (x) => orb.vec(x), cosine };
const H = 3600e3;
const D = 24 * H;
const T0 = Date.UTC(2026, 8, 3, 16, 0);

test('a title that says nothing is read as its site', () => {
  assert.strictEqual(readableTitle({ url: 'https://vercel.com/login', title: 'Login – Vercel' }), 'vercel');
  assert.strictEqual(readableTitle({ url: 'https://dashboard.render.com/login', title: 'Render Dashboard' }), 'render');
  assert.strictEqual(readableTitle({ url: 'https://support.stripe.com/q', title: 'How do I open a Stripe account as a sole trader? : Stripe' }), 'How do I open a Stripe account as a sole trader? : Stripe');
  assert.match(readableTitle({ url: 'https://github.com/acme/rocket/releases', title: 'Releases · acme/rocket' }), /releases.*github.*rocket/i, 'a short title gets its site and path');
});

test('tabs kept open for weeks become journeys: sittings, joined across days by topic; everyday pages aside', () => {
  const tabs = [
    // One evening, setting up hosting for a project: opened within a minute, titles that say little.
    { url: 'https://dashboard.render.com/login', title: 'Render Dashboard', firstVisit: T0 },
    { url: 'https://github.com/acme/tradebot', title: 'acme/tradebot: Describe a trading strategy in plain English', firstVisit: T0 + 20e3 },
    { url: 'https://vercel.com/login', title: 'Login – Vercel', firstVisit: T0 + 35e3, hostDays: 6 },
    // Weeks later, payments: a question on Stripe's help, then Stripe's own page the next day.
    { url: 'https://auth.lemonsqueezy.com/login', title: 'Lemon Squeezy', firstVisit: T0 + 24 * D },
    { url: 'https://support.stripe.com/questions/open-account-sole-trader', title: 'How do I open a Stripe account as a sole trader? : Stripe', firstVisit: T0 + 24 * D + 8 * 60e3 },
    { url: 'https://connect.stripe.com/express/acct_1/abc', title: 'Invalid link', firstVisit: T0 + 25 * D },
    // A login opened on its own, ten days after the hosting evening: not part of it.
    { url: 'https://console.neon.tech/login', title: 'Log In', firstVisit: T0 + 10 * D },
    // Everyday: a mail inbox and a plain chat page on sites used most days.
    { url: 'https://mail.google.com/mail/u/0/', title: 'Inbox (1,204) - me@example.com - Gmail', firstVisit: T0 + 12 * D, hostDays: 19 },
    { url: 'https://claude.ai/new', title: 'Claude', firstVisit: T0 + 20 * D, hostDays: 15 },
  ];
  const { journeys, everyday } = groupTabs(tabs, meaning);
  const titles = (g) => g.map((i) => tabs[i].title);
  const withTab = (i) => journeys.find((g) => g.includes(i));
  assert.deepStrictEqual(everyday.sort(), [7, 8]);
  assert.deepStrictEqual(withTab(0).slice().sort(), [0, 1, 2], `hosting evening: ${titles(withTab(0))}`);
  assert.strictEqual(withTab(0)[0], 1, 'led (and so named) by the tab that says what it is');
  assert.deepStrictEqual(withTab(4).slice().sort(), [3, 4, 5], `payments: ${titles(withTab(4))}`);
  assert.strictEqual(withTab(4)[0], 4);
  assert.deepStrictEqual(withTab(6), [6], 'a login on its own stays on its own');
  assert.strictEqual(journeys[0].includes(5), true, 'most recent journey first');
});

test('without the Orb, or without dates, it still groups by words and sittings', () => {
  const tabs = [
    { url: 'https://a.example/tokyo-flights', title: 'Cheap flights to Tokyo in October', firstVisit: T0 },
    { url: 'https://b.example/tokyo-hotels', title: 'Tokyo hotels near Shinjuku station', firstVisit: T0 + 5 * 60e3 },
    { url: 'https://c.example/chair', title: 'Best ergonomic office chair review', firstVisit: T0 + 3 * D },
  ];
  const { journeys } = groupTabs(tabs, null);
  assert.ok(journeys.some((g) => g.length === 2 && g.includes(0) && g.includes(1)));
  const undated = groupTabs(tabs.map(({ firstVisit, ...t }) => t), meaning);
  assert.ok(undated.journeys.some((g) => g.includes(0) && g.includes(1) && !g.includes(2)));
});
