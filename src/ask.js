// The `ask` tool: a question with a few buttons in the Pilot panel, and the tool call waits for the user's click.
// Ask buttons steer the workflow only ("Done, next", "Skip this one"). They are never approvals: nothing here touches
// the approval gate (requestApproval in src/main.js), ask ids and approval ids live in separate maps, and a click can
// only hand back one of the labels the AI offered. Payments, passwords, uploads and the rest still wait for Allow.

const DEFAULT_WAIT_S = 300;
const MAX_WAIT_S = 600;
const MIN_WAIT_S = 5;
const MAX_LABEL = 40;

// The AI's question, made safe to show: 2–5 short, distinct labels. Labels are plain display text (the panel escapes them).
function checkAsk(args = {}) {
  const text = String(args.text ?? '').trim().slice(0, 4000);
  if (!text) throw new Error('Give the question in `text`.');
  const raw = Array.isArray(args.options) ? args.options : [];
  const options = raw.map((o) => String(o ?? '').replace(/\s+/g, ' ').trim());
  if (options.length < 2 || options.length > 5) throw new Error('Give 2 to 5 options, e.g. ["Done, next", "Skip this one"].');
  for (const o of options) {
    if (!o) throw new Error('Options can\'t be empty.');
    if (o.length > MAX_LABEL) throw new Error(`Keep each option under ${MAX_LABEL} characters: “${o.slice(0, 20)}…” is too long. Put the detail in \`text\`.`);
  }
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw new Error('Each option must be different.');
  const s = Number(args.timeout_s);
  const wait = Number.isFinite(s) ? Math.min(MAX_WAIT_S, Math.max(MIN_WAIT_S, s)) : DEFAULT_WAIT_S;
  return { text, options, ms: Math.round(wait * 1000) };
}

// Questions waiting for a click. One per AI app: a newer ask from the same app replaces the one before it.
class Asks {
  constructor() {
    this.pending = new Map(); // id → { client, options, finish }
  }

  // Resolves with { choice } on a click, or { choice: null, status } when nobody answers ('no answer yet'),
  // a newer ask replaces it ('superseded') or the user pauses the AI or closes Skillerr.
  open(id, client, options, ms) {
    for (const [other, p] of this.pending) if (p.client === client) this.finish(other, { choice: null, status: 'superseded' });
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.finish(id, { choice: null, status: 'no answer yet' }), ms);
      this.pending.set(id, { client, options, finish: (r) => { clearTimeout(timer); resolve(r); } });
    });
  }

  // A click in the panel. Only an open ask, and only one of its own labels, counts.
  answer(id, choice) {
    const p = this.pending.get(id);
    if (!p || !p.options.includes(choice)) return false;
    return this.finish(id, { choice });
  }

  finish(id, result) {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    p.finish(result);
    return true;
  }

  finishAll(status) {
    for (const id of [...this.pending.keys()]) this.finish(id, { choice: null, status });
  }

  get size() {
    return this.pending.size;
  }
}

module.exports = { checkAsk, Asks, DEFAULT_WAIT_S, MAX_WAIT_S };
