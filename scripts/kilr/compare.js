// The Orb against the model it learned from (all-MiniLM-L6-v2, ONNX Runtime with native code) and plain word overlap,
// on this machine: sentence similarity on STS-B test and SICK test (Spearman x 100, the standard score; neither set is
// used to build the Orb), then speed, memory and load time on page-title-like texts, one text at a time as a browser
// meets them. Each model is timed in its own process.
//
// Setup, in a work folder (nothing here ships; onnxruntime-node is only needed for this comparison):
//   mkdir -p work/model && cd work
//   curl -sL -o stsb-test.csv https://raw.githubusercontent.com/PhilipMay/stsb-multi-mt/main/data/stsb-en-test.csv
//   curl -sL -o sick-test.txt https://raw.githubusercontent.com/brmson/dataset-sts/master/data/sts/sick2014/SICK_test_annotated.txt
//   curl -sL -o model/model.onnx https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx
//   npm i onnxruntime-node@1
// Usage: node scripts/kilr/compare.js [work folder]      (default: scripts/kilr/work)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const WORK = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(__dirname, 'work'));
const ort = () => require(require.resolve('onnxruntime-node', { paths: [WORK] }));
const { KilrEmbed, cosine } = require('../../src/kilr/embed');
const { WordPiece } = require('../../src/kilr/tokenizer');
const vocab = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'kilr', 'vocab.txt'), 'utf8').split('\n');
const wp = new WordPiece(vocab);
const CLS = vocab.indexOf('[CLS]');
const SEP = vocab.indexOf('[SEP]');

// all-MiniLM-L6-v2 as sentence-transformers uses it: mean of the last hidden states, normalised.
async function teacher(threads = 1) {
  const o = ort();
  const sess = await o.InferenceSession.create(path.join(WORK, 'model', 'model.onnx'), { intraOpNumThreads: threads });
  return async (text) => {
    const ids = [CLS, ...wp.encode(text, 126), SEP];
    const n = ids.length;
    const t = (a) => new o.Tensor('int64', a, [1, n]);
    const out = (await sess.run({ input_ids: t(BigInt64Array.from(ids.map(BigInt))), attention_mask: t(new BigInt64Array(n).fill(1n)), token_type_ids: t(new BigInt64Array(n)) })).last_hidden_state.data;
    const v = new Float32Array(384);
    for (let i = 0; i < n; i++) for (let k = 0; k < 384; k++) v[k] += out[i * 384 + k] / n;
    const norm = Math.hypot(...v);
    return v.map((x) => x / norm);
  };
}

const csvRow = (l) => {
  const out = [];
  let cur = '';
  let q = false;
  for (const ch of l) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
};
const sets = () => ({
  'STS-B test': fs.readFileSync(path.join(WORK, 'stsb-test.csv'), 'utf8').trim().split('\n').map(csvRow).map((r) => ({ a: r[0], b: r[1], y: +r[2] })),
  'SICK test': fs.readFileSync(path.join(WORK, 'sick-test.txt'), 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t')).map((r) => ({ a: r[1], b: r[2], y: +r[3] })),
});
const rank = (xs) => {
  const idx = xs.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
  const r = Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
};
const spearman = (x, y) => {
  const a = rank(x);
  const b = rank(y);
  const m = (v) => v.reduce((s, z) => s + z, 0) / v.length;
  const ma = m(a);
  const mb = m(b);
  let c = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    c += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return (100 * c) / Math.sqrt(va * vb);
};
const words = (s) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) || []);
const overlap = (a, b) => {
  const A = words(a);
  const B = words(b);
  const i = [...A].filter((w) => B.has(w)).length;
  return i / (A.size + B.size - i || 1);
};

async function quality() {
  const orb = KilrEmbed.load();
  const mini = await teacher(1);
  for (const [name, set] of Object.entries(sets())) {
    const y = set.map((p) => p.y);
    const t = [];
    for (const p of set) {
      const [a, b] = [await mini(p.a), await mini(p.b)];
      t.push(a.reduce((s, v, k) => s + v * b[k], 0));
    }
    const row = {
      pairs: set.length,
      'all-MiniLM-L6-v2': +spearman(t, y).toFixed(1),
      Orb: +spearman(set.map((p) => cosine(orb.embed(p.a), orb.embed(p.b))), y).toFixed(1),
      'word overlap': +spearman(set.map((p) => overlap(p.a, p.b)), y).toFixed(1),
    };
    console.log(name.padEnd(11), JSON.stringify(row));
  }
}

// One model, timed in this process: --time orb | --time minilm <threads>
async function time(which, threads) {
  const csv = fs.readFileSync(path.join(WORK, 'stsb-test.csv'), 'utf8').trim().split('\n').map((l) => csvRow(l)[0]);
  const titles = csv.slice(0, 1000).map((s, i) => (i % 2 ? s : `${s.split(' ').slice(0, 6).join(' ')} - Reviews, prices and guide`));
  const rss0 = process.memoryUsage().rss;
  let t = performance.now();
  let embed;
  if (which === 'orb') {
    const e = KilrEmbed.load();
    embed = async (x) => e.embed(x);
  } else embed = await teacher(threads);
  const loadMs = performance.now() - t;
  for (let i = 0; i < 50; i++) await embed(titles[i]);
  const reps = which === 'orb' ? 20 : 1;
  t = performance.now();
  for (let r = 0; r < reps; r++) for (const x of titles) await embed(x);
  const us = ((performance.now() - t) * 1000) / (titles.length * reps);
  console.log(JSON.stringify({ model: which === 'orb' ? 'Orb' : `all-MiniLM-L6-v2, ${threads} thread${threads > 1 ? 's' : ''}`, loadMs: Math.round(loadMs), memoryMB: Math.round((process.memoryUsage().rss - rss0) / 1e6), perTextMicroseconds: +us.toFixed(1), textsPerSecond: Math.round(1e6 / us) }));
}

(async () => {
  const i = process.argv.indexOf('--time');
  if (i > 0) return time(process.argv[i + 1], Number(process.argv[i + 2] || 1));
  console.log(`Sentence similarity (Spearman x 100), ${require('os').cpus()[0].model}`);
  await quality();
  console.log('\nSpeed, memory and load time: page-title-like texts, one at a time');
  for (const args of [['orb'], ['minilm', '1'], ['minilm', '4']]) execFileSync(process.execPath, [__filename, WORK, '--time', ...args], { stdio: 'inherit' });
})();
