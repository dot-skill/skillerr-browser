const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Memory } = require('../src/memory');
const { Embedder, cosine } = require('../src/embed');

// A fake embeddings server: words map onto a few "meaning" axes, so synonyms land close together.
const AXES = [['hotel', 'accommodation', 'ryokan', 'stay', 'lodging'], ['flight', 'airline', 'plane'], ['headphone', 'audio', 'anc']];
const vec = (t) => AXES.map((ws) => ws.filter((w) => t.toLowerCase().includes(w)).length + 0.01);
function fakeFetch(calls) {
  return async (url, init) => {
    calls.push(url);
    const { input } = JSON.parse(init.body);
    return { ok: true, json: async () => ({ data: input.map((t, index) => ({ index, embedding: vec(t) })) }) };
  };
}
const setup = (fetchImpl) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillerr-embed-'));
  const memory = new Memory(dir);
  return { dir, memory, embedder: new Embedder({ memory, dir, fetchImpl }) };
};

test('cosine similarity', () => {
  assert.strictEqual(cosine([1, 0], [1, 0]), 1);
  assert.strictEqual(cosine([1, 0], [0, 1]), 0);
  assert.strictEqual(cosine([0, 0], [1, 1]), 0);
});

test('indexes memory, persists vectors and finds meaning matches', async () => {
  const calls = [];
  const { dir, memory, embedder } = setup(fakeFetch(calls));
  const { id: sid } = memory.session({ name: 'AI', via: 'mcp' }, { goal: 'Where to stay in Kyoto' });
  memory.fileSession(sid, { summary: 'Ryokan near Gion', topics: ['Travel > Kyoto'] });
  assert.ok((await embedder.index()) > 0);
  assert.strictEqual(await embedder.index(), 0); // nothing changed, nothing re-embedded
  assert.ok(calls[0].endsWith('/v1/embeddings'));
  const sims = await embedder.similar('lodging options');
  assert.ok(sims.get(sid) > 0.9);
  const reloaded = new Embedder({ memory, dir, fetchImpl: fakeFetch([]) });
  assert.strictEqual(reloaded.vectors.size, embedder.vectors.size);
  const got = memory.recall('lodging options', { semantic: sims });
  assert.ok(got.some((r) => r.id === sid));
});

test('no local model: recall stays keyword-only and backs off', async () => {
  let n = 0;
  const { memory, embedder } = setup(async () => {
    n++;
    throw new Error('ECONNREFUSED');
  });
  memory.session({ name: 'AI', via: 'mcp' }, { goal: 'x' });
  assert.strictEqual(await embedder.index(), 0);
  assert.strictEqual(await embedder.similar('anything'), null);
  assert.strictEqual(n, 1); // no retries until the back-off passes
});

test('can be switched off', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillerr-embed-'));
  const memory = new Memory(dir);
  const e = new Embedder({ memory, dir, getConfig: () => ({ on: false }), fetchImpl: () => assert.fail('should not call') });
  assert.strictEqual(await e.similar('hotel'), null);
});
