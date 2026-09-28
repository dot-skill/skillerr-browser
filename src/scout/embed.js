// Scout's embeddings: one small vector per word piece, distilled from all-MiniLM-L6-v2 (see scripts/scout/).
// A text's embedding is the average of its pieces' vectors: no neural network runs, so it takes microseconds, in plain
// JavaScript, with no native code and nothing to download. The table is int8 with a scale per row (about 8 MB).
//
// File format (scout-embed.bin, little-endian):
//   "SCT1" | uint32 vocab size V | uint32 dims D | float32 scale[V] | int8 vector[V * D]
// Vocabulary: vocab.txt, one word piece per line, line number = id.
const fs = require('fs');
const path = require('path');
const { WordPiece } = require('./tokenizer');

const DIR = path.join(__dirname, '..', '..', 'assets', 'scout');

class ScoutEmbed {
  constructor(buf, vocab) {
    if (buf.toString('latin1', 0, 4) !== 'SCT1') throw new Error('Not a Scout embedding file');
    this.V = buf.readUInt32LE(4);
    this.D = buf.readUInt32LE(8);
    const scalesAt = 12;
    const vecsAt = scalesAt + this.V * 4;
    // Copy into aligned typed arrays (the file buffer may not be 4-byte aligned).
    this.scale = new Float32Array(this.V);
    for (let i = 0; i < this.V; i++) this.scale[i] = buf.readFloatLE(scalesAt + i * 4);
    this.vec = new Int8Array(buf.buffer.slice(buf.byteOffset + vecsAt, buf.byteOffset + vecsAt + this.V * this.D));
    this.tok = new WordPiece(vocab);
    if (vocab.length !== this.V) throw new Error('Scout vocabulary and vectors disagree');
  }

  static load(dir = DIR) {
    return new ScoutEmbed(fs.readFileSync(path.join(dir, 'scout-embed.bin')), fs.readFileSync(path.join(dir, 'vocab.txt'), 'utf8').split(/\r?\n/)); // CRLF-safe
  }

  // Unit-length Float32Array, or null for a text with no known pieces.
  embed(text) {
    const ids = this.tok.encode(text, 128);
    if (!ids.length) return null;
    const D = this.D;
    const out = new Float32Array(D);
    for (const id of ids) {
      const s = this.scale[id];
      const o = id * D;
      for (let k = 0; k < D; k++) out[k] += this.vec[o + k] * s;
    }
    let n = 0;
    for (let k = 0; k < D; k++) n += out[k] * out[k];
    n = Math.sqrt(n);
    if (!n) return null;
    for (let k = 0; k < D; k++) out[k] /= n;
    return out;
  }
}

const cosine = (a, b) => {
  if (!a || !b) return 0;
  let s = 0;
  for (let k = 0; k < a.length; k++) s += a[k] * b[k];
  return s;
};

// Average of unit vectors, re-normalised: the centre of a trail's pages.
function centroid(vs) {
  const list = vs.filter(Boolean);
  if (!list.length) return null;
  const out = new Float32Array(list[0].length);
  for (const v of list) for (let k = 0; k < v.length; k++) out[k] += v[k];
  let n = 0;
  for (let k = 0; k < out.length; k++) n += out[k] * out[k];
  n = Math.sqrt(n) || 1;
  for (let k = 0; k < out.length; k++) out[k] /= n;
  return out;
}

module.exports = { ScoutEmbed, cosine, centroid, DIR };
