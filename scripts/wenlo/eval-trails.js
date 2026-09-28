// Does Wenlo make Trails better? Replays realistic browsing (searches and page titles from 8 threads of work, worded
// differently on purpose), shuffled over three days, with no tab or opener hints: the hardest case, where only the
// words themselves say what belongs together. Scores how well trails match the real threads, words only vs with Wenlo.
// Usage: node scripts/wenlo/eval-trails.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Trails } = require('../../src/trails');
const { Wenlo } = require('../../src/wenlo');

const THREADS = {
  japan: ['q:cheap flights to tokyo in october', 'Tokyo Narita flights from London - compare airfares', 'q:best area to stay in kyoto',
    'Where to Stay in Kyoto: Best Neighborhoods for First-Timers', 'q:japan rail pass worth it', 'JR Pass: Is the Japan Rail Pass Still Worth It?',
    'Kyoto temples you can visit in one day', 'q:tokyo hotels near shinjuku station'],
  desk: ['q:standing desk under 500', 'Best Standing Desks of 2026, Tested', 'Uplift V2 Standing Desk Review', 'q:ergonomic office chair lower back pain',
    'The 8 Best Office Chairs for Back Pain', 'q:monitor arm for home office', 'How to set up an ergonomic home office'],
  visa: ['q:schengen visa appointment', 'Apply for a Schengen visa: documents you need', 'q:travel insurance for schengen visa',
    'Visa application form - Embassy of France', 'q:passport photo size requirements', 'Book an appointment at the visa application centre'],
  baking: ['q:sourdough starter not rising', 'Why Your Sourdough Starter Isn\'t Rising (and How to Fix It)', 'q:best flour for bread',
    'Bread flour vs all-purpose flour: what\'s the difference?', 'q:dutch oven bread recipe', 'No-knead crusty bread baked in a cast iron pot'],
  react: ['q:react useeffect runs twice', 'Why does useEffect run twice in development? - Stack Overflow', 'q:react server components tutorial',
    'Understanding React Server Components', 'q:next.js app router data fetching', 'Data Fetching: Fetching Data on the Server | Next.js'],
  running: ['q:couch to 5k plan', 'Couch to 5K: a 9-week running plan for beginners', 'q:best running shoes for flat feet',
    'The Best Running Shoes for Overpronation', 'q:how to avoid shin splints', 'Shin splints: causes, treatment and prevention'],
  mortgage: ['q:mortgage rates today', 'Compare fixed-rate mortgages and current interest rates', 'q:how much house can i afford',
    'Home affordability calculator', 'q:first time home buyer programs', 'What first-time buyers need to know about down payments'],
  laptop: ['q:macbook air vs dell xps 13', 'MacBook Air M4 review: the best laptop for most people', 'q:best laptop for programming 2026',
    'Dell XPS 13 review: a great Windows ultrabook', 'q:laptop battery life comparison', 'Thin and light laptops with the longest battery life'],
};

// Held out: never used to set Wenlo's thresholds, only to score them.
const HELD_OUT = {
  wedding: ['q:wedding venues near lake como', 'Lake Como Wedding Venues: Villas and Prices', 'q:wedding photographer italy cost',
    'How much does a destination wedding photographer cost?', 'q:save the date card ideas', 'Save-the-date etiquette: when to send them'],
  car: ['q:used electric car buying guide', 'Buying a Used EV: What to Check Before You Buy', 'q:tesla model 3 vs hyundai ioniq 5',
    'Ioniq 5 vs Model 3: Which Electric Car Should You Buy?', 'q:home ev charger installation cost', 'Level 2 home charging explained'],
  dog: ['q:best dog food for puppies', 'How Much Should I Feed My Puppy?', 'q:puppy crate training schedule',
    'Crate Training a Puppy: A Step-by-Step Guide', 'q:vaccination schedule for puppies', 'When should puppies get their shots?'],
  python: ['q:pandas groupby multiple columns', 'pandas.DataFrame.groupby - pandas documentation', 'q:python virtual environment tutorial',
    'Creating virtual environments with venv', 'q:pandas merge vs join', 'Merge, join and concatenate DataFrames in pandas'],
  garden: ['q:when to plant tomatoes', 'Growing Tomatoes: Planting, Care and Harvest', 'q:raised garden bed soil mix',
    'How to Fill a Raised Bed Garden', 'q:companion plants for tomatoes', 'Vegetable companion planting chart'],
  tax: ['q:how to file taxes as a freelancer', 'Self-employed tax guide: deductions and quarterly payments', 'q:home office tax deduction',
    'Can I deduct my home office? Rules for the self-employed', 'q:quarterly estimated tax due dates', 'Estimated taxes: how and when to pay'],
};

function run(meaning, seed = 1, threads = THREADS) {
  const items = [];
  for (const [topic, list] of Object.entries(threads)) for (const x of list) items.push({ topic, x });
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  items.sort(() => rnd() - 0.5);
  const T0 = Date.parse('2026-09-01T09:00:00Z');
  const clock = { t: T0 };
  const tr = new Trails(fs.mkdtempSync(path.join(os.tmpdir(), 'wenlo-eval-')), { now: () => clock.t, meaning });
  const got = [];
  items.forEach((it, i) => {
    clock.t = T0 + i * 40 * 60 * 1000; // one every 40 minutes, over about three days
    const isQ = it.x.startsWith('q:');
    const url = isQ ? `https://www.google.com/search?q=${encodeURIComponent(it.x.slice(2))}` : `https://site${i}.example/${i}`;
    got.push({ topic: it.topic, trail: tr.observe({ url, title: isQ ? '' : it.x }, { typed: true }) });
  });
  // Pairwise: of the pairs from the same thread, how many share a trail (recall); of the pairs sharing a trail, how many
  // are from the same thread (precision).
  let same = 0, sameTogether = 0, together = 0, togetherSame = 0;
  for (let i = 0; i < got.length; i++) {
    for (let j = i + 1; j < got.length; j++) {
      const st = got[i].topic === got[j].topic;
      const tt = got[i].trail && got[i].trail === got[j].trail;
      if (st) { same++; if (tt) sameTogether++; }
      if (tt) { together++; if (st) togetherSame++; }
    }
  }
  const recall = sameTogether / same;
  const precision = together ? togetherSame / together : 1;
  return { trails: new Set(got.map((g) => g.trail).filter(Boolean)).size, precision, recall, f1: (2 * precision * recall) / (precision + recall || 1) };
}

const wenlo = new Wenlo();
const meaning = { affinity: (p, t) => wenlo.pageAffinity(p, t), rank: (q, l) => wenlo.rankTrails(q, l).map((x) => x.trail) };
const avg = (m, threads) => {
  const rs = [1, 2, 3, 4, 5].map((seed) => run(m, seed, threads));
  const mean = (k) => rs.reduce((a, r) => a + r[k], 0) / rs.length;
  return { trails: mean('trails').toFixed(1), precision: mean('precision').toFixed(2), recall: mean('recall').toFixed(2), f1: mean('f1').toFixed(2) };
};
module.exports = { run, THREADS, HELD_OUT };
if (require.main === module) {
  for (const [name, threads] of [['tuning set', THREADS], ['held-out set', HELD_OUT]]) {
    console.log(`${name}: ${Object.keys(threads).length} threads, ${Object.values(threads).flat().length} visits, 5 shuffles, no tab hints`);
    console.log('  words only  ', avg(null, threads));
    console.log('  with Wenlo  ', avg(meaning, threads));
  }
}
