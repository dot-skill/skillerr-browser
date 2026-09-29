// Kilr's embeddings: one small vector per word piece, distilled from all-MiniLM-L6-v2 (see scripts/kilr/).
// A text's embedding is the average of its pieces' vectors: no neural network runs, so it takes microseconds, in plain
// JavaScript, with no native code and nothing to download. The table is int8 with a scale per row (about 8 MB).
//
// File format (kilr-embed.bin, little-endian):
//   "KLR1" | uint32 vocab size V | uint32 dims D | float32 scale[V] | int8 vector[V * D]
// Vocabulary: vocab.txt, one word piece per line, line number = id.
const fs = require('fs');
const path = require('path');
const { WordPiece } = require('./tokenizer');

const DIR = path.join(__dirname, '..', '..', 'assets', 'kilr');

class KilrEmbed {
  constructor(buf, vocab) {
    if (buf.toString('latin1', 0, 4) !== 'KLR1') throw new Error('Not a Kilr embedding file');
    this.V = buf.readUInt32LE(4);
    this.D = buf.readUInt32LE(8);
    const scalesAt = 12;
    const vecsAt = scalesAt + this.V * 4;
    // Copy into aligned typed arrays (the file buffer may not be 4-byte aligned).
    this.scale = new Float32Array(this.V);
    for (let i = 0; i < this.V; i++) this.scale[i] = buf.readFloatLE(scalesAt + i * 4);
    this.vec = new Int8Array(buf.buffer.slice(buf.byteOffset + vecsAt, buf.byteOffset + vecsAt + this.V * this.D));
    this.tok = new WordPiece(vocab);
    this.id = 'kilr-embed-1';
    if (vocab.length !== this.V) throw new Error('Kilr vocabulary and vectors disagree');
  }

  static load(dir = DIR) {
    return new KilrEmbed(fs.readFileSync(path.join(dir, 'kilr-embed.bin')), fs.readFileSync(path.join(dir, 'vocab.txt'), 'utf8').split(/\r?\n/)); // CRLF-safe
  }

  // A copy with some rows replaced: the user's personal vectors (src/kilr/train.js). rows: Map id → numbers.
  withRows(rows, id = 'personal') {
    const e = Object.create(KilrEmbed.prototype);
    Object.assign(e, this, { vec: new Int8Array(this.vec), scale: new Float32Array(this.scale), id: `${this.id}+${id}` });
    for (const [row, v] of rows) {
      if (row < 0 || row >= this.V || v.length !== this.D) continue;
      let m = 0;
      for (let k = 0; k < this.D; k++) m = Math.max(m, Math.abs(v[k]));
      const s = m / 127 || 1;
      e.scale[row] = s;
      for (let k = 0; k < this.D; k++) e.vec[row * this.D + k] = Math.max(-127, Math.min(127, Math.round(v[k] / s)));
    }
    return e;
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

// The user's personal vectors on disk: "KLP1" | uint32 rows | uint32 dims | per row: uint32 id, float32 scale, int8[dims].
function encodePersonal(rows, D) {
  const buf = Buffer.alloc(12 + rows.size * (8 + D));
  buf.write('KLP1', 0, 'latin1');
  buf.writeUInt32LE(rows.size, 4);
  buf.writeUInt32LE(D, 8);
  let o = 12;
  for (const [id, v] of rows) {
    let m = 0;
    for (let k = 0; k < D; k++) m = Math.max(m, Math.abs(v[k]));
    const s = m / 127 || 1;
    buf.writeUInt32LE(id, o);
    buf.writeFloatLE(s, o + 4);
    for (let k = 0; k < D; k++) buf.writeInt8(Math.max(-127, Math.min(127, Math.round(v[k] / s))), o + 8 + k);
    o += 8 + D;
  }
  return buf;
}

function decodePersonal(buf) {
  if (buf.toString('latin1', 0, 4) !== 'KLP1') throw new Error('Not a Kilr personal file');
  const n = buf.readUInt32LE(4);
  const D = buf.readUInt32LE(8);
  const rows = new Map();
  let o = 12;
  for (let i = 0; i < n; i++) {
    const s = buf.readFloatLE(o + 4);
    const v = new Float32Array(D);
    for (let k = 0; k < D; k++) v[k] = buf.readInt8(o + 8 + k) * s;
    rows.set(buf.readUInt32LE(o), v);
    o += 8 + D;
  }
  return { rows, D };
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

module.exports = { KilrEmbed, cosine, centroid, encodePersonal, decodePersonal, DIR };
