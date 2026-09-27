// Checks that `recall` surfaces the right past research, before we claim it does.
// Seeds a throwaway memory with sessions modelled on real Skillerr sessions (page titles and
// keywords as the app would store them), asks new questions, and scores the top results.
// Run: node scripts/eval-recall.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Memory } = require('../src/memory');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillerr-recall-'));
const m = new Memory(dir);
const ai = (name) => ({ name, via: 'mcp' });

function session(controller, goal, pages, filing, extras = {}) {
  const { id } = m.session(ai(controller), { goal, fresh: true });
  for (const p of pages) m.visit(id, p);
  if (extras.note) m.addNote(id, { ...extras.note, file: `/notes/${extras.note.title}.md` });
  if (extras.skill) m.addSkill(id, { ...extras.skill, file: `/skills/${extras.skill.name}/SKILL.md` });
  m.fileSession(id, filing);
  return id;
}

// 1. The Tokyo weekend showcase (real pages and figures from the 27 Sep recording).
const tokyo = session('Claude Code', 'Plan a weekend in Tokyo from Delhi', [
  { url: 'https://www.google.com/travel/flights?q=Flights%20to%20Tokyo%20from%20Delhi', title: 'New Delhi to Tokyo | Google Flights',
    text: 'Cheapest from ₹62,467 Nonstop 7 hr 55 min JAL IndiGo DEL NRT round trip Cathay Pacific Vietjet emissions' },
  { url: 'https://www.google.com/travel/hotels/Tokyo', title: 'Search for accommodations in Tokyo - Google hotels',
    text: 'Hotel Indigo Tokyo Shibuya Peninsula Tokyo Hyatt Regency Tokyo Grand Hyatt 5-star hotel free cancellation spa pool' },
  { url: 'https://wttr.in/Tokyo', title: 'wttr.in — Weather Report', text: 'Weather report Tokyo light rain shower overcast patchy rain' },
  { url: 'https://en.wikivoyage.org/wiki/Tokyo', title: 'Tokyo – Travel guide at Wikivoyage',
    text: 'Tokyo districts Shibuya Shinjuku Asakusa understand get in Narita Haneda airport see do eat sleep' },
  { url: 'https://www.openstreetmap.org/search?query=ramen%20shibuya', title: 'ramen shibuya | OpenStreetMap', text: 'ramen restaurant Shibuya Jingumae Dogenzaka' },
], { summary: 'Nonstop JAL/IndiGo ₹72,542 return; Hyatt Regency Tokyo ₹31,077; rainy; ramen in Shibuya.',
  topics: ['Travel > Japan > Tokyo', 'Travel > Flights'], entities: ['place:Tokyo', 'place:Delhi', 'company:JAL', 'company:IndiGo'] },
{ note: { title: 'Tokyo trip', content: 'Flights nonstop JAL IndiGo. Stay Hyatt Regency Tokyo. Weather light rain. Eat ramen Shibuya.',
  topics: ['Travel > Japan > Tokyo'], entities: ['place:Tokyo'] } });

// 2. Demo checkout recording, with a learned procedure.
const checkout = session('Claude Code', 'Record a demo of filling in the demo checkout', [
  { url: 'file:///demo/safety-demo.html', title: 'Skillerr safety demo — fake checkout', sensitive: true },
], { summary: 'Captioned demo of the fake checkout; card field and Pay now need approval.', topics: ['Product > Skillerr > Demos'], entities: ['product:Skillerr'] },
{ skill: { name: 'demo-checkout-flow', description: 'Use when filling the Skillerr demo checkout page: which fields are safe and what needs approval.',
  topics: ['Product > Skillerr > Demos'] } });

// 3. Headphones comparison (a typical shopping session).
const headphones = session('Claude Desktop', 'Find well-reviewed noise-cancelling headphones under $200', [
  { url: 'https://www.rtings.com/headphones/reviews/best/noise-cancelling', title: 'The 6 Best Noise Cancelling Headphones - RTINGS.com',
    text: 'noise cancelling headphones Sony WH-1000XM5 Bose QuietComfort Anker Soundcore Space Q45 battery ANC comfort price' },
  { url: 'https://www.amazon.in/s?k=anker+soundcore+q45', title: 'Amazon.in : anker soundcore q45', text: 'Anker Soundcore Space Q45 adaptive noise cancelling headphones price rating' },
], { summary: 'Anker Soundcore Space Q45 is the best ANC pick under $200.', topics: ['Shopping > Electronics > Headphones'], entities: ['product:Anker Soundcore Space Q45', 'company:Sony', 'company:Bose'] },
{ note: { title: 'ANC headphones under 200', content: 'Anker Soundcore Space Q45 best value noise cancelling, Sony XM5 over budget.', topics: ['Shopping > Electronics > Headphones'] } });

// 4. Hacker News summary (unrelated noise).
const hn = session('Skillerr · Claude', 'Summarize today’s top story on Hacker News', [
  { url: 'https://news.ycombinator.com/', title: 'Hacker News', text: 'Does Georgism work DeepSeek Elastic Compute PipePipe NewPipe fork programming languages' },
], { summary: 'Top story was about Georgism and land value tax.', topics: ['News > Tech'], entities: ['org:Hacker News'] });

// 5. Osaka and Japan Rail Pass research, weeks later: should connect to Tokyo through Japan.
const osaka = session('Claude Code', 'Is the Japan Rail Pass worth it for Tokyo to Osaka?', [
  { url: 'https://en.wikivoyage.org/wiki/Rail_travel_in_Japan', title: 'Rail travel in Japan – Wikivoyage',
    text: 'Japan Rail Pass JR shinkansen Tokyo Osaka Kyoto Nozomi Hikari price reservation' },
], { summary: 'JR Pass rarely pays off for a single Tokyo–Osaka return since the 2023 price rise.', topics: ['Travel > Japan > Rail'], entities: ['place:Osaka', 'place:Tokyo', 'product:Japan Rail Pass'] });

const cases = [
  { q: 'Book a hotel in Tokyo for next month', expect: [tokyo, 'note:'], why: 'same city, hotel pages seen before' },
  { q: 'Find cheap flights from Delhi to Japan', expect: [tokyo], why: 'Delhi and flights, Japan via topic' },
  { q: 'Plan a Kyoto and Osaka trip by train', expect: [osaka], why: 'Osaka and train ↔ rail pass session' },
  { q: 'Best ramen near Shibuya', expect: [tokyo], why: 'ramen page on OpenStreetMap' },
  { q: 'Which Sony headphones have the best ANC?', expect: [headphones], why: 'Sony entity, noise cancelling' },
  { q: 'Record a product demo video of our checkout', expect: ['skill:demo-checkout-flow', checkout], why: 'learned skill for that page' },
  { q: 'What is on Hacker News today?', expect: [hn], why: 'same site' },
  { q: 'Recipe for banana bread', expect: [], why: 'unrelated: should return little or nothing strong' },
];

let pass = 0;
for (const c of cases) {
  const got = m.recall(c.q, { limit: 5 });
  const top3 = got.slice(0, 3);
  const hit = (want) => top3.some((r) => (want.startsWith('session:') || want.startsWith('skill:') ? r.id === want : r.id.startsWith(want)));
  const ok = c.expect.length ? c.expect.every(hit) : !got.length || got[0].score < 1.5;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.q}\n      expected: ${c.expect.map((e) => (m.nodes.get(e) ? m.label(m.nodes.get(e)) : e)).join(' + ') || '(nothing strong)'}  — ${c.why}`);
  for (const r of got.slice(0, 3)) console.log(`      ${r.score.toFixed(2).padStart(5)}  [${r.type}] ${r.label.slice(0, 60)} — ${r.why}`);
}
const inferred = [...m.edges.values()].filter((e) => e.source === 'inferred');
console.log(`\n${pass}/${cases.length} passed. Inferred relates_to links: ${inferred.map((e) => `${m.label(m.nodes.get(e.from)).slice(0, 30)} ↔ ${m.label(m.nodes.get(e.to)).slice(0, 30)} (${e.confidence})`).join('; ') || 'none'}`);
console.log(`Checkout page kept keywords: ${JSON.stringify([...m.nodes.values()].find((n) => n.url && n.url.includes('safety-demo')).keywords)}`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(pass === cases.length ? 0 : 1);
