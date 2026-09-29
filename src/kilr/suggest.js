// Skills Kilr suggests: noticing that the user (or their AI apps) keep doing the same kind of task, and writing down
// how they do it as a standard skill (SKILL.md) their AI can follow next time. Choosing headphones, then a desk, then a
// monitor, each time with the same kind of searches and the same review sites, becomes "How you choose what to buy".
//
// No language model writes these, and nothing leaves the computer. Everything in a skill was observed in trails (which
// Kilr filed by meaning): the searches typed, which sites were read and in what order, how long it usually takes. The
// words around it are fixed templates, one per kind of task.

const MIN_TRAILS = 3; // a habit, not a coincidence
const MIN_DAYS = 2; // …on more than one day
const SHARED = 0.34; // a site or a way of searching counts as a habit when it's in a third of the trails (and at least two)

// Kinds of task, first match wins where they overlap ("best hotels in Kyoto" is a trip, not shopping).
// finish: what the user evidently does at the end, said as an instruction to their AI.
const KINDS = [
  { key: 'cook', slug: 'how-i-find-recipes', title: 'How you find recipes', task: 'find a recipe or plan a meal',
    re: /\b(recipes?|cook(ing)?|bake|baking|roast(ed)?|marinade|slow cooker|instant pot|air fryer|vegan|vegetarian|dinner ideas)\b/i,
    finish: 'Give the recipe in full (ingredients with amounts, then steps), note substitutions, and link where it came from.' },
  { key: 'travel', slug: 'how-i-plan-trips', title: 'How you plan trips', task: 'plan a trip: where to go, stay and get around',
    re: /\b(flights?|hotels?|ryokan|hostels?|airbnb|itinerary|visa|things to do|day trip|where to stay|trip|travel|train (to|from)|airport)\b/i,
    finish: 'Lay out options with dates, prices and travel times side by side, and say what needs booking first.' },
  { key: 'fix', slug: 'how-i-fix-problems', title: 'How you fix problems', task: 'fix an error or something that stopped working',
    re: /\b(error|errors|fix|fixing|not working|doesn'?t work|won'?t|issue|failed|failing|exception|crash(es|ing)?|bug|broken|undefined|cannot|can'?t|unable|stuck)\b/i,
    finish: 'Start from the exact error message, try the most common cause first, and say which fix worked for others with the same setup.' },
  { key: 'jobs', slug: 'how-i-look-for-jobs', title: 'How you look for jobs', task: 'look for a job or prepare for one',
    re: /\b(jobs?|hiring|salary|salaries|interview(s|ing)?|resume|cv|cover letter|careers?|remote roles?|openings?)\b/i,
    finish: 'List roles with company, pay range if known, location and a link, and flag anything that needs applying soon.' },
  { key: 'home', slug: 'how-i-find-a-place', title: 'How you look for a place to live', task: 'find a place to rent or buy',
    re: /\b(apartments?|rent(al|als)?|flats?|studio|mortgage|neighbou?rhoods?|lease|landlord|house hunting)\b/i,
    finish: 'Compare places on price, size, area and commute, with links, and note what to ask on a viewing.' },
  { key: 'buy', slug: 'how-i-choose-products', title: 'How you choose what to buy', task: 'choose something to buy',
    re: /\b(best|vs|versus|reviews?|under \$?\d+|cheap(est)?|budget|buy|price|deals?|worth it|alternatives?|recommend(ed|ations?)?|specs|compared?)\b/i,
    finish: 'Narrow it to two or three finalists and compare them in a table: price, the specs that matter, and what reviewers complain about.' },
  { key: 'learn', slug: 'how-i-learn-new-things', title: 'How you learn new things', task: 'learn how something works',
    re: /\b(how to|how does|how do|tutorial|guide|learn(ing)?|what is|what are|explained|explain|introduction|intro to|course|beginners?|basics|examples?)\b/i,
    finish: 'Explain it plainly first, then go deeper, with a worked example, and point to the best source for more.' },
];

// Words that say what kind of search it is, not what it's about: kept when writing the user's searches as patterns.
const FRAME = new Set(`best top vs versus review reviews reddit under over cheap cheapest budget buy price prices deal deals worth it
alternative alternatives recommend recommended recommendations compare comparison specs how to does do what is are why when where
tutorial guide learn explained explain example examples intro introduction beginners basics course error fix not working issue failed
recipe recipes easy quick near me in for with without and or the a of from things day trip itinerary visa hotel hotels flights flight
stay jobs job salary interview remote apartment apartments rent`.split(/\s+/));
const YEAR = /^(19|20)\d\d$/;

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const words = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}$' ]+/gu, ' ').split(/\s+/).filter(Boolean);

// A trail's kind: the kind its searches (counted double) and page titles match most, if any match clearly.
function kindOf(t) {
  let best = null;
  let bestScore = 0;
  for (const k of KINDS) {
    let score = 0;
    for (const q of t.searches) if (k.re.test(q)) score += 2;
    for (const p of t.pages.slice(0, 20)) if (k.re.test(p.title || '')) score += 1;
    if (score > bestScore) {
      best = k;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : null;
}

// A search as a pattern: "best noise cancelling headphones under 200" → "best … under 200".
function pattern(query) {
  const out = [];
  for (const w of words(query)) {
    const tok = YEAR.test(w) ? '<year>' : FRAME.has(w) || /^\$?\d+$/.test(w) ? w : '…';
    if (tok === '…' && out[out.length - 1] === '…') continue;
    out.push(tok);
  }
  // A pattern that's only the topic, or only filler, says nothing about how they search.
  const frame = out.filter((w) => w !== '…' && !['in', 'for', 'with', 'and', 'or', 'the', 'a', 'of', 'from', 'without'].includes(w));
  return frame.length && out.includes('…') ? out.join(' ').replace(/<year>/g, String(new Date().getFullYear())) : null;
}

// What a group of trails has in common: the sites in most of them (in the order they're usually used), the ways of
// searching that recur, and how long it usually takes.
function habitsOf(group, { everyday = () => false } = {}) {
  const need = Math.max(2, Math.ceil(group.length * SHARED));
  const sites = new Map(); // host → { trails, positions }
  for (const t of group) {
    const pages = [...t.pages].sort((a, b) => a.firstAt - b.firstAt);
    const seen = new Set();
    pages.forEach((p, i) => {
      if (!p.host || seen.has(p.host) || everyday(p.host)) return;
      seen.add(p.host);
      const s = sites.get(p.host) || { host: p.host, trails: 0, positions: [] };
      s.trails++;
      s.positions.push(pages.length > 1 ? i / (pages.length - 1) : 0);
      sites.set(p.host, s);
    });
  }
  const shared = [...sites.values()].filter((s) => s.trails >= need)
    .map((s) => ({ host: s.host, trails: s.trails, at: median(s.positions) }))
    .sort((a, b) => a.at - b.at || b.trails - a.trails)
    .slice(0, 6);
  const patterns = new Map(); // pattern → { trails it's in, where in them it usually comes (0 first … 1 last) }
  for (const t of group) {
    const typed = [...t.searches].reverse(); // trails keep the newest search first
    const seen = new Set();
    typed.forEach((q, i) => {
      const p = pattern(q);
      if (!p || seen.has(p)) return;
      seen.add(p);
      const x = patterns.get(p) || { pattern: p, trails: 0, positions: [] };
      x.trails++;
      x.positions.push(typed.length > 1 ? i / (typed.length - 1) : 0);
      patterns.set(p, x);
    });
  }
  const searches = [...patterns.values()].filter((x) => x.trails >= need)
    .sort((a, b) => b.trails - a.trails || median(a.positions) - median(b.positions)).slice(0, 4)
    .sort((a, b) => median(a.positions) - median(b.positions))
    .map((x) => ({ pattern: x.pattern, trails: x.trails }));
  const days = new Set();
  for (const t of group) for (const d of t.days) days.add(d);
  return {
    sites: shared,
    searches,
    pages: median(group.map((t) => t.pages.length)),
    sessions: median(group.map((t) => t.sessions || 1)),
    days: days.size,
  };
}

// Who did the research: "you", "Claude Desktop", or "you and Claude Desktop".
function whoDid(group) {
  const you = group.filter((t) => !t.by).length;
  const bys = [...new Set(group.filter((t) => t.by).map((t) => t.by))];
  const names = [...(you ? ['you'] : []), ...bys];
  return { you, ai: group.length - you, bys, text: names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] };
}

const examples = (group, n = 4) => [...group].sort((a, b) => b.lastAt - a.lastAt).slice(0, n).map((t) => `"${t.title}"`);

function howSkill(kind, group, h) {
  const who = whoDid(group);
  const lines = [
    `The user has done this ${group.length} times (${examples(group).join(', ')}). This is how it's done when they do it themselves.`,
    'Follow the same approach, so the result is what they would have found, in the way they like it.',
    '',
  ];
  let step = 1;
  if (h.searches.length) {
    lines.push(`${step++}. Search the way they do (… is the thing at hand):`, ...h.searches.map((s) => `   - "${s.pattern}" (in ${s.trails} of ${group.length})`));
  }
  if (h.sites.length) {
    lines.push(`${step++}. Read the sources they rely on, in the order they usually use them:`,
      ...h.sites.map((s) => `   - ${s.host} (in ${s.trails} of ${group.length}${s.at >= 0.7 ? ', usually near the end' : s.at <= 0.2 ? ', usually first' : ''})`));
  }
  lines.push(`${step++}. They usually look at about ${plural(Math.max(2, h.pages), 'page')}${h.sessions > 1 ? ` over ${plural(h.sessions, 'sitting')}` : ''} before deciding. Be as thorough, not more.`);
  lines.push(`${step++}. ${kind.finish}`);
  lines.push(`${step++}. If Skillerr is connected, call my_trails with a query about the thing at hand first: they may have started on it already.`);
  lines.push('', `Written by Kilr, Skillerr's on-device model, from ${plural(group.length, 'trail')} (${who.you ? `${who.you} by the user` : ''}${who.you && who.ai ? ', ' : ''}${who.ai ? `${who.ai} by ${who.bys.join(', ')}` : ''}). Nothing here left the user's computer.`);
  return {
    kind: 'how',
    id: `how:${kind.key}`,
    slug: kind.slug,
    title: kind.title,
    description: `Use when the user wants to ${kind.task}: follow the way they do it themselves (their searches, the sites they trust, how they decide).`,
    why: `${capital(who.text)} did this ${group.length} times on ${plural(h.days, 'day')}${h.sites.length ? `, each time with ${h.sites.slice(0, 3).map((s) => s.host).join(', ')}` : ''}.`,
    instructions: lines.join('\n'),
    topics: [kind.task],
  };
}

const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// trails: [{ id, title, by, searches, pages: [{ host, title, firstAt }], days, sessions, lastAt }] (Trails.forSkills).
// everyday(host): routine sites (mail, news) to leave out of the sources.
function suggestSkills(trails, { everyday = () => false } = {}) {
  const out = [];
  const byKind = new Map();
  for (const t of trails) {
    const k = kindOf(t);
    if (k) byKind.set(k, [...(byKind.get(k) || []), t]);
  }
  for (const [kind, group] of byKind) {
    if (group.length < MIN_TRAILS) continue;
    const h = habitsOf(group, { everyday });
    if (h.days < MIN_DAYS || (!h.sites.length && !h.searches.length)) continue; // nothing they do the same way
    out.push({ ...howSkill(kind, group, h), count: group.length, trails: group.map((t) => ({ id: t.id, title: t.title, by: t.by || null })) });
  }
  return out.sort((a, b) => b.count - a.count);
}

// The SKILL.md a suggestion becomes, for showing before it's saved (skills.learn writes the same thing).
function skillMarkdown(s) {
  return `---\nname: ${s.slug}\ndescription: ${JSON.stringify(s.description)}\n---\n\n${s.instructions}\n`;
}

module.exports = { suggestSkills, skillMarkdown, kindOf, pattern, habitsOf, KINDS };
