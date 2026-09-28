// Semantic recall: local embeddings so `recall` finds past research phrased differently ("lodging" ↔ "hotel").
// Uses an OpenAI-compatible /embeddings endpoint on this computer (Ollama by default: `ollama pull nomic-embed-text`).
// Only what memory already keeps is embedded (labels, summaries, keywords), never page text. If no local model is
// running, recall stays keyword-only; nothing leaves the machine.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_BASE = 'http://127.0.0.1:11434/v1';
const DEFAULT_MODEL = 'nomic-embed-text';
const RETRY_AFTER_MS = 10 * 60 * 1000; // after a failure (model not pulled, server off), try again later
const BATCH = 32;
const MIN_SIMILARITY = 0.55; // below this, a vector match is noise

const hashOf = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

class Embedder {
  // memory: the Memory instance; dir: where vectors.jsonl lives (next to the graph).
  constructor({ memory, dir, getConfig = () => ({}), fetchImpl = fetch }) {
    this.memory = memory;
    this.file = path.join(dir, 'vectors.jsonl');
    this.getConfig = getConfig;
    this.fetch = fetchImpl;
    this._vectors = null; // node id → { h: text hash, m: model, v: number[] }; read on first use
    this.failedAt = 0;
    this.indexing = null;
  }

  get vectors() {
    if (!this._vectors) this.load();
    return this._vectors;
  }

  config() {
    const c = this.getConfig() || {};
    return { on: c.on !== false, baseUrl: String(c.baseUrl || DEFAULT_BASE).replace(/\/+$/, ''), model: c.model || DEFAULT_MODEL };
  }

  load() {
    this._vectors = new Map();
    let text = '';
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {}
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        if (r.op === 'del') this.vectors.delete(r.id);
        else this.vectors.set(r.id, r);
      } catch {}
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = this.file + '.tmp';
    const lines = [...this.vectors.entries()].map(([id, r]) => JSON.stringify({ id, h: r.h, m: r.m, v: r.v }));
    fs.writeFileSync(tmp, lines.join('\n') + (lines.length ? '\n' : ''), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  available() {
    return this.config().on && Date.now() - this.failedAt > RETRY_AFTER_MS;
  }

  async embed(texts) {
    const { baseUrl, model } = this.config();
    const res = await this.fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: texts }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`embeddings answered ${res.status}`);
    const d = await res.json();
    const out = (d.data || []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((x) => x.embedding);
    if (out.length !== texts.length || !out.every(Array.isArray)) throw new Error('unexpected embeddings response');
    return out;
  }

  // What gets embedded for a node: what memory already keeps about it.
  textOf(n) {
    return this.memory.text(n).slice(0, 1000);
  }

  // Embed nodes that are new or changed since their vector was made. Safe to call often; one run at a time.
  index() {
    if (!this.available()) return Promise.resolve(0);
    if (this.indexing) return this.indexing;
    this.indexing = (async () => {
      const { model } = this.config();
      const todo = [];
      for (const n of this.memory.nodes.values()) {
        if (!['session', 'note', 'skill', 'page', 'topic', 'entity'].includes(n.type)) continue;
        const t = this.textOf(n);
        const h = hashOf(t);
        const cur = this.vectors.get(n.id);
        if (!cur || cur.h !== h || cur.m !== model) todo.push({ id: n.id, t, h });
      }
      for (const id of [...this.vectors.keys()]) if (!this.memory.nodes.has(id)) this.vectors.delete(id); // forgotten
      let done = 0;
      try {
        for (let i = 0; i < todo.length; i += BATCH) {
          const batch = todo.slice(i, i + BATCH);
          const vs = await this.embed(batch.map((x) => x.t));
          batch.forEach((x, j) => this.vectors.set(x.id, { h: x.h, m: model, v: vs[j] }));
          done += batch.length;
        }
      } catch {
        this.failedAt = Date.now();
      }
      if (done || todo.length === 0) this.save();
      return done;
    })().finally(() => (this.indexing = null));
    return this.indexing;
  }

  // Map of node id → similarity (0..1) for nodes close to the query, or null when semantic recall isn't available.
  async similar(query, { limit = 30 } = {}) {
    if (!this.available() || !String(query || '').trim()) return null;
    this.index(); // catch up in the background; this query uses the vectors there are
    if (!this.vectors.size) return null;
    const { model } = this.config();
    let q;
    try {
      [q] = await this.embed([String(query).slice(0, 1000)]);
    } catch {
      this.failedAt = Date.now();
      return null;
    }
    const scored = [];
    for (const [id, r] of this.vectors) {
      if (r.m !== model || r.v.length !== q.length) continue;
      const s = cosine(q, r.v);
      if (s >= MIN_SIMILARITY) scored.push([id, s]);
    }
    return new Map(scored.sort((a, b) => b[1] - a[1]).slice(0, limit));
  }

  forgetAll() {
    this.vectors.clear();
    fs.rmSync(this.file, { force: true });
  }
}

module.exports = { Embedder, cosine, MIN_SIMILARITY };
