// Research memory: a small local knowledge graph of what AIs researched in Skillerr.
// Nodes: session, page, note, skill, topic, entity. Edges are typed, carry provenance
// ('explicit' from what happened, 'inferred' from overlap) and a confidence.
// Stored as two append-only JSONL logs, replayed into memory on start. No server, no dependency.
//
// Privacy: pages keep a URL, title and at most MAX_KEYWORDS keywords, never page text, and
// nothing but the visit for pages with password or payment fields.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_KEYWORDS = 40;
const SESSION_GAP_MS = 15 * 60 * 1000; // an AI idle this long starts a new research session
const STOP = new Set(`a about above after again against all am an and any are as at be because been before being below between both but by can
could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its
itself just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their
them then there these they this those through to too under until up very was we were what when where which while who whom why will with
you your yours also get got use used using one two new like may might must near via per etc www com http https html page skip main content
menu search sign log login cookie cookies privacy terms help home view more less show hide results result
plan find want need make next month week please tell give look check good well`.split(/\s+/));

const now = () => new Date().toISOString();
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);

function tokens(text) {
  return (String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])
    .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)) // cheap plural folding
    .filter((w) => !STOP.has(w) && !/^\d+$/.test(w));
}

function keywords(text, max = MAX_KEYWORDS) {
  const counts = new Map();
  for (const w of tokens(text)) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w);
}

function pageKey(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|ved$|ei$|gclid$|fbclid$|ref$)/.test(p)) u.searchParams.delete(p);
    return u.toString();
  } catch {
    return String(url);
  }
}

// "Travel > Japan > Tokyo" → ['travel', 'travel>japan', 'travel>japan>tokyo'] with display names
function topicChain(pathText) {
  const parts = String(pathText || '').split(/>|\//).map((p) => p.trim()).filter(Boolean).slice(0, 5);
  return parts.map((_, i) => ({ id: 'topic:' + parts.slice(0, i + 1).map(norm).join('>'), name: parts.slice(0, i + 1).join(' > ') }));
}

// "place:Tokyo" | { kind, name } → entity node fields
function entityOf(e) {
  const [kind, name] = typeof e === 'string' ? (e.includes(':') ? [e.slice(0, e.indexOf(':')), e.slice(e.indexOf(':') + 1)] : ['thing', e]) : [e.kind, e.name];
  const k = norm(kind) || 'thing';
  const n = String(name || '').trim();
  return n ? { id: `entity:${k}:${norm(n)}`, kind: k, name: n } : null;
}

class Memory {
  constructor(dir) {
    this.dir = dir;
    this.nodes = new Map();
    this.edges = new Map();
    this.active = new Map(); // controller name → { id, last }
    this.sessionPages = new Map(); // session id → recent page ids (for co-visit links)
    this.ops = 0;
    this.load();
  }

  // ---------- storage ----------
  pathOf(name) {
    return path.join(this.dir, name);
  }

  load() {
    for (const [name, map] of [['nodes.jsonl', this.nodes], ['edges.jsonl', this.edges]]) {
      let text = '';
      try {
        text = fs.readFileSync(this.pathOf(name), 'utf8');
      } catch {}
      for (const line of text.split('\n')) {
        if (!line) continue;
        try {
          const rec = JSON.parse(line);
          if (rec.op === 'del') map.delete(rec.id);
          else map.set(rec.id, rec);
          this.ops++;
        } catch {} // a torn last line after a crash is fine to skip
      }
    }
    if (this.ops > 2 * (this.nodes.size + this.edges.size) + 200) this.compact();
  }

  append(name, rec) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(this.pathOf(name), JSON.stringify(rec) + '\n', { mode: 0o600 });
    this.ops++;
  }

  compact() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    for (const [name, map] of [['nodes.jsonl', this.nodes], ['edges.jsonl', this.edges]]) {
      const tmp = this.pathOf(name + '.tmp');
      fs.writeFileSync(tmp, [...map.values()].map((r) => JSON.stringify(r)).join('\n') + (map.size ? '\n' : ''), { mode: 0o600 });
      fs.renameSync(tmp, this.pathOf(name));
    }
    this.ops = this.nodes.size + this.edges.size;
  }

  upsert(node) {
    const prev = this.nodes.get(node.id);
    const rec = { ...prev, ...node, created: prev?.created || now(), updated: now() };
    this.nodes.set(rec.id, rec);
    this.append('nodes.jsonl', rec);
    return rec;
  }

  link(from, to, type, { source = 'explicit', confidence = 1 } = {}) {
    if (from === to) return null;
    const id = `${type}:${from}->${to}`;
    const prev = this.edges.get(id);
    if (prev && prev.confidence >= confidence) return prev;
    const rec = { id, from, to, type, source, confidence, created: prev?.created || now() };
    this.edges.set(id, rec);
    this.append('edges.jsonl', rec);
    return rec;
  }

  // Strengthen a relationship each time it's observed again (co-visits, tabs opened together, backlinks).
  bump(from, to, type, inc = 1) {
    if (!from || !to || from === to) return null;
    const id = `${type}:${from}->${to}`;
    const prev = this.edges.get(id);
    const weight = (prev?.weight || 0) + inc;
    const rec = { id, from, to, type, source: 'explicit', confidence: Math.min(1, 0.35 + 0.15 * Math.log2(1 + weight)), weight, created: prev?.created || now(), last: now() };
    this.edges.set(id, rec);
    this.append('edges.jsonl', rec);
    return rec;
  }

  // Pages visited or read close together in one session relate; the more often, the stronger.
  coVisit(sessionId, pageId, inc = 1) {
    const recent = this.sessionPages.get(sessionId) || [];
    for (const other of recent) if (other !== pageId) this.bump(...[pageId, other].sort(), 'co_visited', inc);
    this.sessionPages.set(sessionId, [pageId, ...recent.filter((p) => p !== pageId)].slice(0, 12));
  }

  // Tabs opened together (fleet view, deep research batches) are one cluster of attention.
  openedTogether(pageIds) {
    const ids = [...new Set(pageIds.filter(Boolean))];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) this.bump(...[ids[i], ids[j]].sort(), 'co_visited', 2);
  }

  // Backlinks: a page linking to pages already in memory (only known pages, so this stays small).
  linksTo(fromUrl, hrefs) {
    const from = 'page:' + hash(pageKey(fromUrl));
    if (!this.nodes.has(from)) return 0;
    let n = 0;
    for (const h of new Set(hrefs)) {
      const to = 'page:' + hash(pageKey(h));
      if (to !== from && this.nodes.has(to)) {
        this.bump(from, to, 'links_to', 1);
        n++;
      }
    }
    return n;
  }

  pageId(url) {
    return 'page:' + hash(pageKey(url));
  }

  removeNode(id) {
    if (!this.nodes.delete(id)) return;
    this.append('nodes.jsonl', { op: 'del', id });
    for (const e of [...this.edges.values()]) if (e.from === id || e.to === id) this.removeEdge(e.id);
  }

  removeEdge(id) {
    if (this.edges.delete(id)) this.append('edges.jsonl', { op: 'del', id });
  }

  neighbors(id) {
    const out = [];
    for (const e of this.edges.values()) {
      if (e.from === id) out.push({ edge: e, node: this.nodes.get(e.to) });
      else if (e.to === id) out.push({ edge: e, node: this.nodes.get(e.from) });
    }
    return out.filter((x) => x.node);
  }

  // ---------- capture ----------
  // The research session a controller is in; a new one after a long pause (or when asked).
  session(controller, { goal, fresh = false } = {}) {
    const a = this.active.get(controller.name);
    if (!fresh && a && Date.now() - a.last < SESSION_GAP_MS && this.nodes.has(a.id)) {
      a.last = Date.now();
      if (goal && !this.nodes.get(a.id).goal) this.upsert({ id: a.id, goal: String(goal).slice(0, 300) });
      return { id: a.id, isNew: false };
    }
    const id = `session:${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    this.upsert({ id, type: 'session', controller: controller.name, via: controller.via, goal: goal ? String(goal).slice(0, 300) : '', started: now() });
    this.active.set(controller.name, { id, last: Date.now() });
    return { id, isNew: true };
  }

  // A page seen in a session. Keywords only for pages without sensitive fields.
  visit(sessionId, { url, title, text, sensitive }) {
    if (!url || /^(about|chrome|devtools|data):/.test(url)) return;
    const key = pageKey(url);
    const id = 'page:' + hash(key);
    const prev = this.nodes.get(id);
    let host = '';
    try {
      host = new URL(key).hostname.replace(/^www\./, '');
    } catch {}
    const fields = { id, type: 'page', url: key, host, title: String(title || prev?.title || '').slice(0, 200), lastVisited: now(), firstVisited: prev?.firstVisited || now(),
      visits: (prev?.visits || 0) + 1 };
    if (sensitive) fields.keywords = [];
    else if (text) fields.keywords = keywords(`${title} ${text}`);
    this.upsert(fields);
    if (sessionId) {
      this.link(id, sessionId, 'visited_in');
      this.coVisit(sessionId, id);
    }
    return id;
  }

  // Pages brought in from elsewhere (Chrome bookmarks/history): no session, keywords from title and folder only.
  importPages(pages, source) {
    let n = 0;
    for (const p of pages) {
      if (!/^https?:/.test(p.url || '')) continue;
      const key = pageKey(p.url);
      const id = 'page:' + hash(key);
      const prev = this.nodes.get(id);
      let host = '';
      try {
        host = new URL(key).hostname.replace(/^www\./, '');
      } catch {}
      this.upsert({
        id, type: 'page', url: key, host, title: String(p.title || prev?.title || '').slice(0, 200),
        lastVisited: p.lastVisited || prev?.lastVisited || now(), firstVisited: prev?.firstVisited || p.lastVisited || now(),
        keywords: prev?.keywords?.length ? prev.keywords : keywords(`${p.title} ${host.replace(/\./g, ' ')} ${p.folder || ''}`, 20),
        ...(p.visits ? { visits: p.visits } : {}), ...(source === 'bookmark' ? { bookmarked: true } : {}), importedFrom: source,
      });
      n++;
    }
    return n;
  }

  tag(id, { topics = [], entities = [] }) {
    for (const t of [].concat(topics)) {
      const chain = topicChain(t);
      chain.forEach((c, i) => {
        this.upsert({ id: c.id, type: 'topic', name: c.name });
        if (i > 0) this.link(c.id, chain[i - 1].id, 'broader');
      });
      if (chain.length) this.link(id, chain[chain.length - 1].id, 'about');
    }
    for (const e of [].concat(entities)) {
      const ent = entityOf(e);
      if (!ent) continue;
      this.upsert({ ...ent, type: 'entity' });
      this.link(id, ent.id, 'about');
    }
  }

  addNote(sessionId, { title, file, content, topics, entities }) {
    const id = 'note:' + hash(file);
    this.upsert({ id, type: 'note', title, file, keywords: keywords(`${title} ${content}`) });
    if (sessionId) this.link(sessionId, id, 'produced');
    this.tag(id, { topics, entities });
    if (sessionId) this.tag(sessionId, { topics, entities });
    return id;
  }

  addSkill(sessionId, { name, description, file, topics, entities }) {
    const id = 'skill:' + name;
    this.upsert({ id, type: 'skill', name, description, file, keywords: keywords(`${name.replace(/-/g, ' ')} ${description}`) });
    if (sessionId) this.link(sessionId, id, 'produced');
    this.tag(id, { topics, entities });
    return id;
  }

  // Close out a session: summary + taxonomy, then propose links to older sessions that look related.
  fileSession(sessionId, { summary, topics, entities }) {
    const s = this.nodes.get(sessionId);
    if (!s) throw new Error('No research session to file.');
    this.tag(sessionId, { topics, entities });
    // Topics and entities count double: they're the AI's own judgement of what this was about.
    const tags = this.neighbors(sessionId).filter((n) => n.edge.type === 'about').map((n) => n.node.name).join(' ');
    const words = keywords(`${tags} ${tags} ${s.goal} ${summary} ${this.pagesOf(sessionId).map((p) => `${p.title} ${(p.keywords || []).join(' ')}`).join(' ')}`, 60);
    this.upsert({ id: sessionId, summary: String(summary || '').slice(0, 500), keywords: words });
    // The session's pages are about its topics too (inferred, weaker than an explicit tag).
    const topicIds = this.neighbors(sessionId).filter((n) => n.edge.type === 'about' && n.node.type === 'topic').map((n) => n.node.id);
    for (const p of this.pagesOf(sessionId)) for (const t of topicIds) this.link(p.id, t, 'about', { source: 'inferred', confidence: 0.6 });
    for (const [name, a] of this.active) if (a.id === sessionId) this.active.delete(name); // filed = finished; the next task starts fresh
    const mine = new Set(words);
    const proposed = [];
    for (const other of this.nodes.values()) {
      if (other.type !== 'session' || other.id === sessionId || !other.keywords?.length) continue;
      const overlap = other.keywords.filter((w) => mine.has(w)).length;
      const jaccard = overlap / (mine.size + other.keywords.length - overlap || 1);
      const sharedTags = this.neighbors(sessionId).filter((n) => n.edge.type === 'about')
        .some((t) => this.neighbors(other.id).some((o) => o.edge.type === 'about' && o.node.id === t.node.id));
      if ((overlap >= 3 && jaccard >= 0.06) || (sharedTags && overlap >= 2)) {
        this.link(sessionId, other.id, 'relates_to', { source: 'inferred', confidence: Math.min(0.9, +(jaccard * 3).toFixed(2)) });
        proposed.push(other);
      }
    }
    return proposed;
  }

  pagesOf(sessionId) {
    return this.neighbors(sessionId).filter((n) => n.edge.type === 'visited_in').map((n) => n.node);
  }

  // ---------- retrieval ----------
  label(n) {
    if (!n) return '';
    if (n.type === 'session') return n.goal || n.summary || 'Untitled session';
    if (n.type === 'page') return n.title || n.url;
    if (n.type === 'skill') return n.name;
    return n.title || n.name || n.id;
  }

  text(n) {
    return [this.label(n), n.summary, n.description, n.host, n.kind, (n.keywords || []).join(' ')].filter(Boolean).join(' ');
  }

  // Past sessions, notes, skills and pages relevant to a new task, each with the path that connects it.
  recall(query, { limit = 8, excludeSession } = {}) {
    const q = [...new Set(tokens(query))];
    if (!q.length) return [];
    const all = [...this.nodes.values()].filter((n) => n.id !== excludeSession);
    const df = new Map();
    const docs = new Map();
    for (const n of all) {
      const set = new Set(tokens(this.text(n)));
      docs.set(n.id, set);
      for (const w of set) df.set(w, (df.get(w) || 0) + 1);
    }
    const N = all.length || 1;
    const direct = new Map();
    for (const n of all) {
      const set = docs.get(n.id);
      let s = 0;
      const hits = [];
      for (const w of q) {
        if (set.has(w)) {
          s += Math.log(1 + N / (df.get(w) || 1));
          hits.push(w);
        }
      }
      if (s > 0) direct.set(n.id, { score: s / Math.sqrt(q.length), hits });
    }
    // Spread from what matched along the graph, so a topic or entity pulls in what it's about.
    const best = new Map();
    const offer = (node, score, why) => {
      if (!node || node.id === excludeSession || !['session', 'note', 'skill', 'page'].includes(node.type)) return;
      const cur = best.get(node.id);
      if (!cur || score > cur.score) best.set(node.id, { node, score, why });
    };
    for (const [id, d] of direct) {
      const n = this.nodes.get(id);
      offer(n, d.score, `matches ${d.hits.slice(0, 3).map((w) => `“${w}”`).join(', ')}`);
      for (const { edge, node } of this.neighbors(id)) {
        const via = n.type === 'topic' ? `topic ${n.name}` : n.type === 'entity' ? `${n.kind} ${n.name}` : `${n.type} “${this.label(n).slice(0, 50)}”`;
        const w = edge.type === 'co_visited' ? 0.5 : edge.type === 'links_to' ? 0.55 : 0.6; // co-visits/backlinks: related, but less than a direct tag
        offer(node, d.score * w * edge.confidence, edge.type === 'co_visited' ? `read alongside ${via.replace(/^[a-z]+ /, '')}` : edge.type === 'links_to' ? `linked from ${via.replace(/^[a-z]+ /, '')}` : `via ${via}`);
        if (n.type === 'topic' || n.type === 'entity') {
          // one more hop: things tagged with a narrower topic, and sessions behind a matched note
          for (const second of this.neighbors(node.id)) {
            if (second.edge.type === 'produced' || second.edge.type === 'broader') offer(second.node, d.score * 0.35 * second.edge.confidence, `via ${via}`);
          }
        }
      }
    }
    const typeWeight = { note: 1.15, skill: 1.1, session: 1, page: 0.8 };
    return [...best.values()]
      .map((r) => ({ ...r, score: r.score * (typeWeight[r.node.type] || 1) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ node, score, why }) => ({
        id: node.id, type: node.type, label: this.label(node), why, score: +score.toFixed(2),
        when: (node.updated || node.created || '').slice(0, 10), file: node.file, url: node.url,
      }));
  }

  // For the memory view: everything except pages (optional, capped), with labels.
  graph({ pages = false, max = 500 } = {}) {
    const keep = [...this.nodes.values()].filter((n) => pages || n.type !== 'page')
      .sort((a, b) => (b.updated || '').localeCompare(a.updated || '')).slice(0, max);
    const ids = new Set(keep.map((n) => n.id));
    return {
      nodes: keep.map((n) => ({ id: n.id, type: n.type, label: this.label(n), kind: n.kind, when: (n.updated || '').slice(0, 10),
        summary: n.summary || n.description || '', url: n.url, file: n.file, controller: n.controller, heat: this.heat(n) })),
      edges: [...this.edges.values()].filter((e) => ids.has(e.from) && ids.has(e.to))
        .map((e) => ({ from: e.from, to: e.to, type: e.type, source: e.source, confidence: e.confidence, weight: e.weight || 1 })),
      stats: this.stats(),
    };
  }

  // 0..1: how much attention something gets — visits, recency, and how strongly it's tied into clusters.
  heat(n) {
    const days = (Date.now() - Date.parse(n.lastVisited || n.updated || n.created || 0)) / 864e5;
    const recency = Math.exp(-Math.max(0, days) / 21); // three-week half-life-ish
    let ties = 0;
    for (const e of this.edges.values()) if ((e.from === n.id || e.to === n.id) && (e.type === 'co_visited' || e.type === 'links_to')) ties += e.weight || 1;
    const raw = Math.log2(1 + (n.visits || 1)) * 0.5 + Math.log2(1 + ties) * 0.35 + recency * 0.6;
    return +Math.min(1, raw / 3).toFixed(2);
  }

  // ---------- research folders: the taxonomy as a tree ----------
  // Topics form folders (Travel > Japan > Tokyo). Each holds the sessions, notes, skills and pages about it,
  // and links to other folders that share research with it.
  taxonomy() {
    const topics = [...this.nodes.values()].filter((n) => n.type === 'topic');
    const byId = new Map(topics.map((t) => [t.id, { id: t.id, name: t.name.split(' > ').pop(), path: t.name, children: [], items: [], linked: new Map() }]));
    const roots = [];
    for (const f of byId.values()) {
      const parent = f.id.includes('>') ? byId.get(f.id.slice(0, f.id.lastIndexOf('>'))) : null;
      (parent ? parent.children : roots).push(f);
    }
    for (const e of this.edges.values()) {
      if (e.type !== 'about' || !byId.has(e.to)) continue;
      const n = this.nodes.get(e.from);
      if (!n || !['session', 'note', 'skill', 'page'].includes(n.type)) continue;
      byId.get(e.to).items.push({ id: n.id, type: n.type, label: this.label(n), when: (n.updated || '').slice(0, 10), file: n.file, url: n.url, summary: n.summary || '', inferred: e.source === 'inferred' });
    }
    // Linked folders: topics that share a session, note or page. An explicit tag counts fully; a topic a page only
    // inherited from its session counts half, so one stray shared page doesn't link unrelated folders.
    const itemTopics = new Map();
    for (const f of byId.values()) for (const it of f.items) (itemTopics.get(it.id) || itemTopics.set(it.id, new Map()).get(it.id)).set(f.id, it.inferred ? 0.5 : 1);
    for (const tags of itemTopics.values()) {
      if (tags.size < 2) continue;
      for (const [a, wa] of tags) for (const [b, wb] of tags) {
        if (a === b || b.startsWith(a + '>') || a.startsWith(b + '>')) continue;
        byId.get(a).linked.set(b, (byId.get(a).linked.get(b) || 0) + Math.min(wa, wb));
      }
    }
    for (const f of byId.values()) for (const [b, w] of f.linked) if (w < 1) f.linked.delete(b);
    const count = (f) => f.items.length + f.children.reduce((n, c) => n + count(c), 0);
    const finish = (f) => ({
      id: f.id, name: f.name, path: f.path, total: count(f),
      items: f.items.sort((a, b) => ({ session: 0, note: 1, skill: 2, page: 3 }[a.type] - { session: 0, note: 1, skill: 2, page: 3 }[b.type]) || b.when.localeCompare(a.when)),
      linked: [...f.linked.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, shared]) => ({ id, path: byId.get(id).path, shared: Math.round(shared) })),
      children: f.children.map(finish).sort((a, b) => b.total - a.total),
    });
    return roots.map(finish).sort((a, b) => b.total - a.total);
  }

  topics(limit = 40) {
    const counts = new Map();
    for (const e of this.edges.values()) if (e.type === 'about' && e.to.startsWith('topic:')) counts.set(e.to, (counts.get(e.to) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => this.nodes.get(id)?.name).filter(Boolean);
  }

  stats() {
    const c = { session: 0, page: 0, note: 0, skill: 0, topic: 0, entity: 0 };
    for (const n of this.nodes.values()) c[n.type] = (c[n.type] || 0) + 1;
    return { ...c, edges: this.edges.size };
  }

  // ---------- history management ----------
  history({ q = '', limit = 300 } = {}) {
    const words = tokens(q);
    return [...this.nodes.values()]
      .filter((n) => n.type === 'page' && (!words.length || words.every((w) => tokens(`${n.title} ${n.url}`).includes(w) || `${n.title} ${n.url}`.toLowerCase().includes(w))))
      .sort((a, b) => String(b.lastVisited || '').localeCompare(String(a.lastVisited || '')))
      .slice(0, limit)
      .map((n) => ({ id: n.id, title: n.title || n.url, url: n.url, host: n.host, lastVisited: n.lastVisited, visits: n.visits || 1, from: n.importedFrom || 'skillerr' }));
  }

  // Everything seen since a time: pages last visited after it, and sessions started after it.
  forgetSince(sinceMs) {
    let n = 0;
    for (const node of [...this.nodes.values()]) {
      const t = Date.parse(node.type === 'page' ? node.lastVisited : node.type === 'session' ? node.started || node.created : '');
      if (!(t >= sinceMs)) continue;
      if (node.type === 'session') this.forgetSession(node.id);
      else this.removeNode(node.id);
      n++;
    }
    return n;
  }

  // ---------- forgetting ----------
  forgetSession(id) {
    const s = this.nodes.get(id);
    if (!s || s.type !== 'session') return false;
    const pages = this.pagesOf(id);
    this.removeNode(id);
    for (const p of pages) if (!this.neighbors(p.id).some((n) => n.edge.type === 'visited_in')) this.removeNode(p.id);
    for (const [name, a] of this.active) if (a.id === id) this.active.delete(name);
    this.sessionPages.delete(id);
    return true;
  }

  forgetAll() {
    this.nodes.clear();
    this.edges.clear();
    this.active.clear();
    this.sessionPages.clear();
    for (const f of ['nodes.jsonl', 'edges.jsonl']) fs.rmSync(this.pathOf(f), { force: true });
    this.ops = 0;
  }
}

// Text for the recall tool result.
function recallText(items, topics) {
  if (!items.length) return 'No related past research yet.' + (topics.length ? `\nKnown topics (reuse these when filing): ${topics.join('; ')}` : '');
  const lines = items.map((r) => `- [${r.type}] ${r.label} (${r.when}) — ${r.why}${r.file ? ` · file: ${r.file}` : ''}${r.url ? ` · ${r.url}` : ''}`);
  return `Related past research (most relevant first):\n${lines.join('\n')}` +
    (topics.length ? `\n\nKnown topics (reuse these when filing): ${topics.join('; ')}` : '');
}

module.exports = { Memory, recallText, keywords, tokens };
