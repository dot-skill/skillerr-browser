// History: one graph of everything the user and their AI apps looked into, for the History page (Kilr at its centre).
// It joins research memory (sessions, pages, topics, entities, notes, skills: what AIs researched, plus imported Chrome
// history and bookmarks) with Trails (the user's threads of work and their AI apps' research trails). Every node says
// whose it is: 'you', 'ai', or 'both' (a page both looked at).

// About how many different pages a typical person visits in three months of browsing (Chrome keeps 90 days of
// history; a typical profile has on the order of ten thousand distinct pages in it). The History page's glow reaches
// full brightness here, and keeps a little headroom above it (up to GLOW_MAX).
const GLOW_FULL = 10000;
const GLOW_MAX = 20000;

// 0 … 1 on a log scale, so the first hundred pages already light Kilr up and ten thousand make it blaze.
const glowOf = (n) => Math.min(1, Math.log1p(n) / Math.log1p(GLOW_FULL));

// memoryGraph: Memory.graph({ pages: true, max }) output. trails: [{ summary, pages }] from Trails.detail().
// pageId: url → the id research memory uses for a page (so a page in both joins up).
function buildHistoryGraph({ memoryGraph, trails, pageId, maxNodes = 3000 }) {
  const nodes = new Map();
  const edges = [];
  const add = (n) => {
    const prev = nodes.get(n.id);
    if (prev) {
      if (prev.origin !== n.origin) prev.origin = 'both';
      prev.weight = Math.max(prev.weight || 1, n.weight || 1);
      return prev;
    }
    nodes.set(n.id, n);
    return n;
  };
  for (const n of memoryGraph?.nodes || []) {
    const origin = n.type === 'page' ? (n.importedFrom ? 'you' : 'ai') : 'ai';
    add({ id: n.id, type: n.type, label: n.label, origin, by: n.controller || null, url: n.url || null, at: n.when || null, weight: 1 + (n.heat || 0) * 4, heat: n.heat || 0 });
  }
  for (const e of memoryGraph?.edges || []) edges.push({ from: e.from, to: e.to, type: e.type, weight: e.weight || 1 });
  for (const t of trails || []) {
    const s = t.summary;
    const origin = s.by ? 'ai' : 'you';
    const tid = `trail:${s.id}`;
    add({ id: tid, type: 'trail', label: s.title, origin, by: s.by || null, at: s.lastAt ? new Date(s.lastAt).toISOString().slice(0, 10) : null,
      weight: 2 + Math.min(6, (t.pages || []).length / 4), trailId: s.id });
    for (const p of t.pages || []) {
      const id = pageId(p.url);
      add({ id, type: 'page', label: p.title || p.url, origin, by: s.by || null, url: p.url, at: p.lastAt ? new Date(p.lastAt).toISOString().slice(0, 10) : null,
        weight: 1 + Math.min(4, (p.visits || 1) / 3) });
      edges.push({ from: tid, to: id, type: 'in_trail', weight: 1 });
    }
  }
  const all = [...nodes.values()];
  const totals = { you: 0, ai: 0, both: 0, all: all.length };
  for (const n of all) totals[n.origin]++;
  // Too many to draw: keep the most connected and heaviest, and say how many there are in all.
  let shown = all;
  if (all.length > maxNodes) {
    const degree = new Map();
    for (const e of edges) {
      degree.set(e.from, (degree.get(e.from) || 0) + 1);
      degree.set(e.to, (degree.get(e.to) || 0) + 1);
    }
    shown = all.sort((a, b) => (degree.get(b.id) || 0) + b.weight - ((degree.get(a.id) || 0) + a.weight)).slice(0, maxNodes);
  }
  const ids = new Set(shown.map((n) => n.id));
  return {
    nodes: shown,
    edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
    totals,
    glow: glowOf(totals.all),
    glowFull: GLOW_FULL,
    glowMax: GLOW_MAX,
  };
}

module.exports = { buildHistoryGraph, glowOf, GLOW_FULL, GLOW_MAX };
