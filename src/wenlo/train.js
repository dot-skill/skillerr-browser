// Personal retraining: Wenlo learns the user's own topics from their trails, on their computer.
//
// Pages and searches the user keeps in the same trail (clicked through, opened from each other, merged by hand) belong
// together, so Wenlo should place them together. For the word pieces in the user's own pages we find a small change Δ
// to their vectors so that each page lands near the centre of the rest of its trail:
//
//   minimise Σᵢ ‖ mean(E + Δ)[pieces of item i] − yᵢ ‖² + λ‖Δ‖²,   yᵢ = centre of item i's trail without it
//
// Linear least squares again, like Wenlo's distillation (scripts/wenlo): solved with conjugate gradients, all 256
// dimensions at once, in plain JavaScript. Seconds, no GPU, and no teacher model. The base model is never changed;
// training always starts from it, so a bad week can't compound.
//
// It proves itself before it's kept: part of each trail is held back, and the new vectors are accepted only if they put
// more of the held-back items in the right trail than the current ones.

const DEFAULTS = { lambda: 0.3, iterations: 40, maxItems: 8000, holdout: 0.25, minTrails: 3, minItemsPerTrail: 4, topicShare: 0.2 };

// A stable pseudo-random choice (same answer for the same text), so a held-back item stays held back.
function hashUnit(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

const norm = (v) => Math.sqrt(v.reduce((a, x) => a + x * x, 0));

// Mean of an item's piece vectors, from a row getter.
function meanOf(ids, row, D) {
  const m = new Float64Array(D);
  for (const id of ids) {
    const r = row(id);
    for (let k = 0; k < D; k++) m[k] += r[k];
  }
  for (let k = 0; k < D; k++) m[k] /= ids.length;
  return m;
}

// Of the held-back items, how many land nearest their own trail's centre (centres from the training items), and by what
// margin: closeness to their own trail minus closeness to the nearest other one. The margin is what lets Trails join a
// page to its trail with confidence, so it counts even when every item already lands right.
function heldOut(train, test, row, D) {
  const byTrail = new Map();
  for (const it of train) {
    const u = meanOf(it.ids, row, D);
    const n = norm(u) || 1;
    const c = byTrail.get(it.trail) || byTrail.set(it.trail, new Float64Array(D)).get(it.trail);
    for (let k = 0; k < D; k++) c[k] += u[k] / n;
  }
  const centres = [...byTrail.entries()].map(([t, c]) => [t, c.map((x) => x / (norm(c) || 1))]);
  let hit = 0;
  let margin = 0;
  for (const it of test) {
    const u = meanOf(it.ids, row, D);
    const n = norm(u) || 1;
    let best = null;
    let bestS = -Infinity;
    let own = 0;
    let other = -Infinity;
    for (const [t, c] of centres) {
      let s = 0;
      for (let k = 0; k < D; k++) s += u[k] * c[k];
      s /= n;
      if (s > bestS) [best, bestS] = [t, s];
      if (t === it.trail) own = s;
      else other = Math.max(other, s);
    }
    if (best === it.trail) hit++;
    margin += own - (other === -Infinity ? 0 : other);
  }
  return { accuracy: test.length ? hit / test.length : 0, margin: test.length ? margin / test.length : 0 };
}
const heldOutAccuracy = (train, test, row, D) => heldOut(train, test, row, D).accuracy;
const MIN_MARGIN_GAIN = 0.02;

// Fit Δ for the pieces used in `items`. row(id) gives the base vector. Returns Map id → Float64Array (new vector).
function fit(items, row, D, { lambda, iterations, topicShare }, onProgress) {
  // Only words specific to a topic are adapted: pieces used in at most a few of the user's trails. Common words ("best",
  // "how", "guide") appear everywhere; moving them toward one topic would pull unrelated pages into it.
  const trailsOf = new Map();
  for (const it of items) for (const id of it.ids) (trailsOf.get(id) || trailsOf.set(id, new Set()).get(id)).add(it.trail);
  const nTrails = new Set(items.map((it) => it.trail)).size;
  const maxTrails = Math.max(2, Math.floor(topicShare * nTrails));
  const cols = new Map();
  for (const it of items) for (const id of it.ids) if (!cols.has(id) && trailsOf.get(id).size <= maxTrails) cols.set(id, cols.size);
  const T = cols.size;
  const N = items.length;
  // A: each item averages its pieces. Stored as rows of (col, weight).
  // Fixed (common) pieces still count in each item's average; only the adapted ones get a column.
  const rowsA = items.map((it) => {
    const w = new Map();
    for (const id of it.ids) if (cols.has(id)) w.set(cols.get(id), (w.get(cols.get(id)) || 0) + 1 / it.ids.length);
    return [...w.entries()];
  });
  // Targets: each item's current mean, turned toward the centre of the rest of its trail (length kept).
  const means = items.map((it) => meanOf(it.ids, row, D));
  const units = means.map((m) => m.map((x) => x / (norm(m) || 1)));
  const sums = new Map();
  items.forEach((it, i) => {
    const s = sums.get(it.trail) || sums.set(it.trail, new Float64Array(D)).get(it.trail);
    for (let k = 0; k < D; k++) s[k] += units[i][k];
  });
  const R = new Float64Array(N * D); // residual target: y - mean
  items.forEach((it, i) => {
    const s = sums.get(it.trail);
    const c = new Float64Array(D);
    for (let k = 0; k < D; k++) c[k] = s[k] - units[i][k];
    const cn = norm(c);
    if (!cn) return; // alone in its trail: nothing to learn from it
    const mn = norm(means[i]);
    for (let k = 0; k < D; k++) R[i * D + k] = (c[k] / cn) * mn - means[i][k];
  });
  // Normal equations (AᵀA + λI) Δ = AᵀR, matrix-free, conjugate gradients on all D columns at once.
  const At = (Y) => { // Aᵀ Y: T×D from N×D
    const out = new Float64Array(T * D);
    rowsA.forEach((r, i) => {
      for (const [c, w] of r) for (let k = 0; k < D; k++) out[c * D + k] += w * Y[i * D + k];
    });
    return out;
  };
  const Ax = (X) => { // A X: N×D from T×D
    const out = new Float64Array(N * D);
    rowsA.forEach((r, i) => {
      for (const [c, w] of r) for (let k = 0; k < D; k++) out[i * D + k] += w * X[c * D + k];
    });
    return out;
  };
  const M = (X) => {
    const out = At(Ax(X));
    for (let j = 0; j < out.length; j++) out[j] += lambda * X[j];
    return out;
  };
  const diag = new Float64Array(T).fill(lambda);
  for (const r of rowsA) for (const [c, w] of r) diag[c] += w * w;
  const X = new Float64Array(T * D);
  const Rv = At(R); // residual of the system, starting from Δ = 0
  const Z = new Float64Array(T * D);
  for (let j = 0; j < Z.length; j++) Z[j] = Rv[j] / diag[Math.floor(j / D)];
  const P = Float64Array.from(Z);
  const dot = (a, b) => { // per column
    const out = new Float64Array(D);
    for (let j = 0; j < a.length; j++) out[j % D] += a[j] * b[j];
    return out;
  };
  let rz = dot(Rv, Z);
  for (let it = 0; it < iterations; it++) {
    const Q = M(P);
    const pq = dot(P, Q);
    const alpha = rz.map((x, k) => (pq[k] ? x / pq[k] : 0));
    for (let j = 0; j < X.length; j++) {
      const k = j % D;
      X[j] += alpha[k] * P[j];
      Rv[j] -= alpha[k] * Q[j];
    }
    for (let j = 0; j < Z.length; j++) Z[j] = Rv[j] / diag[Math.floor(j / D)];
    const rzNew = dot(Rv, Z);
    const beta = rzNew.map((x, k) => (rz[k] ? x / rz[k] : 0));
    for (let j = 0; j < P.length; j++) P[j] = Z[j] + beta[j % D] * P[j];
    rz = rzNew;
    onProgress?.((it + 1) / iterations);
  }
  const out = new Map();
  for (const [id, c] of cols) {
    const base = row(id);
    const v = new Float64Array(D);
    for (let k = 0; k < D; k++) v[k] = base[k] + X[c * D + k];
    out.set(id, v);
  }
  return out;
}

// trails: [{ id, texts: [search or page title, …] }]. embed: a WenloEmbed (base model).
// Returns { accepted, rows (Map id → Float64Array) | null, report }.
function trainPersonal(trails, embed, opts = {}, onProgress) {
  const o = { ...DEFAULTS, ...opts };
  const t0 = Date.now();
  const D = embed.D;
  const row = (id) => {
    const s = embed.scale[id];
    const r = new Float64Array(D);
    for (let k = 0; k < D; k++) r[k] = embed.vec[id * D + k] * s;
    return r;
  };
  // The temporary buffer: the user's trail texts as word-piece ids, newest first, capped.
  let items = [];
  for (const t of trails) {
    for (const text of t.texts) {
      const ids = embed.tok.encode(text, 64);
      if (ids.length) items.push({ trail: t.id, ids, key: `${t.id}\u0000${text}` });
    }
  }
  items = items.slice(0, o.maxItems);
  const counts = new Map();
  for (const it of items) counts.set(it.trail, (counts.get(it.trail) || 0) + 1);
  items = items.filter((it) => counts.get(it.trail) >= o.minItemsPerTrail);
  const nTrails = new Set(items.map((it) => it.trail)).size;
  const report = { items: items.length, trails: nTrails, pieces: 0, before: null, after: null, ms: 0 };
  if (nTrails < o.minTrails) return { accepted: false, rows: null, report: { ...report, reason: 'not-enough', ms: Date.now() - t0 } };

  // Prove it on held-back items first.
  const test = items.filter((it) => hashUnit(it.key) < o.holdout);
  const train = items.filter((it) => hashUnit(it.key) >= o.holdout);
  const trial = fit(train, row, D, o, (p) => onProgress?.(p * 0.5));
  const trialRow = (id) => trial.get(id) || row(id);
  const b = heldOut(train, test, row, D);
  const a = heldOut(train, test, trialRow, D);
  Object.assign(report, { before: b.accuracy, after: a.accuracy, marginBefore: b.margin, marginAfter: a.margin });
  // Kept only if it never files fewer items right, and files more right or tells trails apart more clearly.
  const better = a.accuracy >= b.accuracy && (a.accuracy > b.accuracy || a.margin - b.margin >= MIN_MARGIN_GAIN);
  if (!better) return { accepted: false, rows: null, report: { ...report, reason: 'no-gain', ms: Date.now() - t0 } };

  // It helps: learn from everything.
  const rows = fit(items, row, D, o, (p) => onProgress?.(0.5 + p * 0.5));
  report.pieces = rows.size;
  report.ms = Date.now() - t0;
  return { accepted: true, rows, report };
}

module.exports = { trainPersonal, heldOutAccuracy, hashUnit };
