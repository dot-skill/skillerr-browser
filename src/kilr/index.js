// Kilr (the Orb): the user's own AI model, running on their computer. It knows the user's work (trails) by meaning.
//
// Kilr doesn't generate text. It embeds (src/kilr/embed.js: distilled static embeddings, microseconds per text) and
// then chooses: the trail a page belongs to, the trails a search means, the trail a question is about. What it says is
// built from the facts of the user's own trails, so it can't make things up.
const { KilrEmbed, cosine, centroid, decodePersonal } = require('./embed');
const { readableTitle } = require('./journeys');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const { LOW, HIGH, TOPIC_LOW, TOPIC_HIGH } = require('./calibration');

class Kilr {
  // personalFile: where the user's personal vectors live (src/kilr/train.js); applied on top of the base model.
  constructor({ embedder = null, dir, personalFile = null } = {}) {
    this._base = embedder;
    this._embedder = null;
    this.dir = dir;
    this.personalFile = personalFile;
    this.cache = new Map(); // text → vector
    this.trailCache = new Map(); // trail id → { key, vec }
    this.stats = { texts: 0, micros: 0, loadMs: 0 }; // for the Kilr screen: texts understood, time spent on them
  }

  // The model as shipped. Personal retraining always starts from this.
  get base() {
    if (!this._base) {
      const t = performance.now();
      this._base = KilrEmbed.load(this.dir);
      this.stats.loadMs = Math.round(performance.now() - t);
    }
    return this._base;
  }

  // The model in use: the base, with the user's personal vectors if they have any.
  get embedder() {
    if (!this._embedder) {
      this._embedder = this.base;
      if (this.personalFile) {
        try {
          const { rows, D } = decodePersonal(require('fs').readFileSync(this.personalFile));
          if (D === this.base.D) this._embedder = this.base.withRows(rows, `personal-${require('fs').statSync(this.personalFile).mtimeMs | 0}`);
        } catch {} // none yet, or unreadable: the base model
      }
    }
    return this._embedder;
  }

  // After retraining or forgetting: use what's on disk now, and drop everything computed with the old vectors.
  reload() {
    this._embedder = null;
    this.cache.clear();
    this.trailCache.clear();
  }

  get personal() {
    return this.embedder !== this.base;
  }

  get ready() {
    try {
      return !!this.embedder;
    } catch {
      return false;
    }
  }

  vec(text) {
    const t = String(text || '').trim().slice(0, 300);
    if (!t) return null;
    let v = this.cache.get(t);
    if (v === undefined) {
      const t0 = performance.now();
      v = this.embedder.embed(t);
      this.stats.texts++;
      this.stats.micros += (performance.now() - t0) * 1000;
      if (this.cache.size > 5000) this.cache.clear();
      this.cache.set(t, v);
    }
    return v;
  }

  similarity(a, b) {
    return cosine(this.vec(a), this.vec(b));
  }

  // 0 (unrelated) … 1 (same topic), from a raw cosine of a text against a trail's centre.
  closeness(cos) {
    return Math.max(0, Math.min(1, (cos - TOPIC_LOW) / (TOPIC_HIGH - TOPIC_LOW)));
  }

  // What a trail is about, as one vector: its searches (weighted double) and page titles.
  trailVec(t) {
    const key = `${t.lastAt}:${t.pages.length}:${t.searches.length}:${t.title}`;
    const hit = this.trailCache.get(t.id);
    if (hit && hit.key === key) return hit.vec;
    const recent = [...t.pages].sort((a, b) => b.lastAt - a.lastAt).slice(0, 24);
    const texts = [...t.searches.slice(0, 8), ...t.searches.slice(0, 8), ...recent.map((p) => readableTitle(p)), ...(t.titleByUser ? [t.title, t.title] : [])];
    const vec = centroid(texts.map((x) => this.vec(x)));
    this.trailCache.set(t.id, { key, vec });
    return vec;
  }

  // How much a page (title, heading, description, or a search) is about a trail: 0…1.
  pageAffinity(page, t) {
    // A title that says nothing ("Log In", "Render Dashboard") is read as its site.
    const pv = this.vec(page.query || [page.url ? readableTitle(page) : page.title, page.h1].filter(Boolean).join('. '));
    return this.closeness(cosine(pv, this.trailVec(t)));
  }

  // Trails ranked by how well they answer a question ("what was I doing about the visa?"), recent ones slightly ahead.
  rankTrails(query, trails, { now = Date.now(), limit = 5 } = {}) {
    const q = this.vec(query);
    if (!q) return [];
    return trails
      .map((t) => {
        const sim = cosine(q, this.trailVec(t));
        const recency = Math.pow(0.5, (now - t.lastAt) / (7 * DAY));
        return { trail: t, sim, score: this.closeness(sim) + 0.1 * recency };
      })
      .filter((x) => x.sim >= TOPIC_LOW)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // "What was I doing?", answered from facts only: which trail, when, where the user stopped, what's unfinished.
  // summaries: output of Trails.summary(). Returns { text, trailId } or null.
  answer(query, summaries, trails, opts = {}) {
    // "Where was I with the chair?" is about "the chair"; "where was I?" alone means the most recent trail.
    const q = String(query || '').trim();
    const frame = q.match(/^(what was i (doing|working on|looking at|reading)|where was i|where did i (leave|stop)|what did i leave( unfinished)?)\b\s*/i);
    const rest = (frame ? q.slice(frame[0].length) : q).replace(/^(with|on|about|for|in|at|regarding)\b\s*/i, '').replace(/[?.!]+$/, '').trim();
    const ranked = !rest ? summaries.slice(0, 1).map((s) => ({ trail: trails.find((t) => t.id === s.id) })) : this.rankTrails(rest, trails, opts);
    const hit = ranked[0] && summaries.find((s) => s.id === ranked[0].trail.id);
    if (!hit) return null;
    return { trailId: hit.id, text: describe(hit, opts.now) };
  }
}



const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function ago(t, now = Date.now()) {
  const h = (now - t) / HOUR;
  if (h < 1) return 'just now';
  if (h < 20) return 'earlier today';
  const d = Math.round(h / 24);
  return d <= 1 ? 'yesterday' : d < 7 ? `${d} days ago` : d < 14 ? 'last week' : `${Math.round(d / 7)} weeks ago`;
}

const UNFINISHED = {
  form: (u) => `you started filling in a form on “${u.title}” and didn't send it`,
  read: (u) => `you read ${u.pct || 'part'}% of “${u.title}”`,
  cart: (u) => `you left something in the cart on “${u.title}”`,
  watch: (u) => `you watched ${u.pct || 'part'}% of “${u.title}”`,
};

// One or two plain sentences about a trail, from its summary.
function describe(s, now = Date.now()) {
  // Research an AI did is described as its, not the user's: who did it and what it concluded.
  if (s.by) return [`${s.title}: ${s.by}'s research, ${ago(s.lastAt, now)}.`, s.researchSummary ? s.researchSummary : ''].filter(Boolean).join(' ');
  const parts = [`${s.title}, ${ago(s.lastAt, now)}.`];
  if (s.stoppedAt) parts.push(`You stopped at “${s.stoppedAt.title}”.`);
  const u = s.unfinished?.[0];
  if (u && UNFINISHED[u.kind]) parts.push(capitalize(UNFINISHED[u.kind](u)) + '.');
  if (s.tucked) parts.push(s.tucked === 1 ? 'One of its tabs is waiting.' : `${s.tucked} of its tabs are waiting.`);
  return parts.join(' ');
}

module.exports = { Kilr, describe, LOW, HIGH };
