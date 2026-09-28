// Teacher: all-MiniLM-L6-v2 (ONNX). Writes vocab-token and corpus embeddings for distillation, plus eval embeddings.
const ort = require('onnxruntime-node');
const fs = require('fs');
const { WordPiece } = require('../../src/wenlo/tokenizer.js');
const vocab = fs.readFileSync('vocab.txt', 'utf8').split('\n');
const wp = new WordPiece(vocab);
const CLS = 101, SEP = 102, D = 384, MAXLEN = 64;
async function main() {
  const sess = await ort.InferenceSession.create('pk/mini/package/onnx/model.onnx', { intraOpNumThreads: 4 });
  async function run(batch) { // batch: arrays of ids incl. CLS/SEP
    const L = Math.max(...batch.map((b) => b.length));
    const n = batch.length;
    const ids = new BigInt64Array(n * L), mask = new BigInt64Array(n * L), type = new BigInt64Array(n * L);
    batch.forEach((b, i) => b.forEach((id, j) => { ids[i * L + j] = BigInt(id); mask[i * L + j] = 1n; }));
    const out = await sess.run({ input_ids: new ort.Tensor('int64', ids, [n, L]), attention_mask: new ort.Tensor('int64', mask, [n, L]), token_type_ids: new ort.Tensor('int64', type, [n, L]) });
    const h = out.last_hidden_state.data;
    const res = new Float32Array(n * D);
    batch.forEach((b, i) => {
      for (let j = 0; j < b.length; j++) for (let k = 0; k < D; k++) res[i * D + k] += h[(i * L + j) * D + k] / b.length;
      let norm = 0; for (let k = 0; k < D; k++) norm += res[i * D + k] ** 2; norm = Math.sqrt(norm) || 1;
      for (let k = 0; k < D; k++) res[i * D + k] /= norm;
    });
    return res;
  }
  async function embedAll(seqs, file, bs = 128) {
    const order = seqs.map((s, i) => i).sort((a, b) => seqs[a].length - seqs[b].length); // similar lengths batch together
    const out = new Float32Array(seqs.length * D);
    const t0 = Date.now();
    for (let s = 0; s < order.length; s += bs) {
      const idx = order.slice(s, s + bs);
      const r = await run(idx.map((i) => seqs[i]));
      idx.forEach((i, k) => out.set(r.subarray(k * D, (k + 1) * D), i * D));
      if ((s / bs) % 100 === 0) process.stdout.write(`${file} ${s}/${seqs.length} ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
    }
    fs.writeFileSync(file, Buffer.from(out.buffer));
    console.log(file, seqs.length, `${((Date.now() - t0) / 1000).toFixed(1)}s`, `${(seqs.length / ((Date.now() - t0) / 1000)).toFixed(0)}/s`);
  }
  const which = process.argv[2];
  if (which === 'vocab') await embedAll(vocab.map((_, id) => [CLS, id, SEP]), 'teach-vocab.f32', 512);
  if (which === 'corpus' || which === 'clean') {
    const sfx = which === 'clean' ? '-clean' : '';
    const texts = fs.readFileSync(`corpus${sfx}.txt`, 'utf8').split('\n');
    const toks = texts.map((t) => wp.encode(t, MAXLEN - 2));
    fs.writeFileSync(`corpus${sfx}-ids.json`, JSON.stringify(toks));
    await embedAll(toks.map((t) => [CLS, ...t, SEP]), `teach-corpus${sfx}.f32`);
  }
  if (which === 'eval') {
    const texts = JSON.parse(fs.readFileSync('eval-texts.json'));
    await embedAll(texts.map((t) => [CLS, ...wp.encode(t, 126), SEP]), 'teach-eval.f32');
  }
}
main();
