// WordPiece tokenizer (BERT uncased), in plain JavaScript: Scout's embeddings use the same vocabulary as the
// all-MiniLM-L6-v2 model they were distilled from. Matches Hugging Face's BertNormalizer + BertPreTokenizer + WordPiece
// (lowercase, accents stripped, Chinese characters split, punctuation split, greedy longest match with ## pieces).

const isControl = (c) => {
  if (c === '\t' || c === '\n' || c === '\r') return false;
  return /\p{Cc}|\p{Cf}/u.test(c);
};
const isWhitespace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || /\p{Zs}/u.test(c);
const isPunct = (c) => {
  const cp = c.codePointAt(0);
  if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) return true;
  return /\p{P}/u.test(c);
};
const isCjk = (cp) => (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x20000 && cp <= 0x2a6df) ||
  (cp >= 0x2a700 && cp <= 0x2b73f) || (cp >= 0x2b740 && cp <= 0x2b81f) || (cp >= 0x2b820 && cp <= 0x2ceaf) ||
  (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x2f800 && cp <= 0x2fa1f);

function normalize(text) {
  let out = '';
  for (const c of String(text || '')) {
    const cp = c.codePointAt(0);
    if (cp === 0 || cp === 0xfffd || isControl(c)) continue;
    if (isWhitespace(c)) out += ' ';
    else if (isCjk(cp)) out += ` ${c} `;
    else out += c;
  }
  return out.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');
}

function preTokenize(text) {
  const words = [];
  let cur = '';
  for (const c of text) {
    if (c === ' ') {
      if (cur) words.push(cur);
      cur = '';
    } else if (isPunct(c)) {
      if (cur) words.push(cur);
      words.push(c);
      cur = '';
    } else cur += c;
  }
  if (cur) words.push(cur);
  return words;
}

class WordPiece {
  // vocab: array of tokens, index = id
  constructor(vocab) {
    this.vocab = vocab;
    this.ids = new Map(vocab.map((t, i) => [t, i]));
    this.unk = this.ids.get('[UNK]');
    this.cache = new Map();
  }

  word(w) {
    const hit = this.cache.get(w);
    if (hit) return hit;
    const chars = [...w];
    let out = [];
    if (chars.length > 100) out = [this.unk];
    else {
      let start = 0;
      while (start < chars.length) {
        let end = chars.length;
        let id = null;
        while (start < end) {
          const piece = (start > 0 ? '##' : '') + chars.slice(start, end).join('');
          if (this.ids.has(piece)) {
            id = this.ids.get(piece);
            break;
          }
          end--;
        }
        if (id == null) {
          out = [this.unk];
          break;
        }
        out.push(id);
        start = end;
      }
    }
    if (this.cache.size > 50000) this.cache.clear();
    this.cache.set(w, out);
    return out;
  }

  // Token ids for a text, without [CLS]/[SEP].
  encode(text, max = 256) {
    const ids = [];
    for (const w of preTokenize(normalize(text))) {
      for (const id of this.word(w)) ids.push(id);
      if (ids.length >= max) break;
    }
    return ids.slice(0, max);
  }
}

module.exports = { WordPiece, normalize, preTokenize };
