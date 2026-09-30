// Messages the user types in the Pilot panel for the AI app driving Skillerr. MCP can't push into an idle client, so a
// message waits here until that app hears it: appended to its next tool result, from the `inbox` tool, or through
// `node mcp/bridge.js --watch-inbox` (which a background monitor can run). Only the Pilot panel creates messages.

const OPEN = '<<<USER MESSAGE from Skillerr Pilot panel';
const CLOSE = '<<<END USER MESSAGE>>>';
const MAX_WAIT_S = 600;
const MAX_TEXT = 2000;

// Nothing but a real message may carry the markers: take them out of page text, tool results and messages alike.
const scrub = (text) => String(text ?? '').replace(/<<<\s*(END\s+)?USER\s+MESSAGE[^>\n]*>*/gi, '[removed marker]');

class Inbox {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.messages = []; // { id, to, text, at, read }
    this.waiters = new Set(); // { client, wake }
    this.seq = 0;
  }

  // From the Pilot panel: a message for one AI app (the one shown in its header).
  post(to, text) {
    const body = scrub(text).trim().slice(0, MAX_TEXT);
    if (!to || !body) return null;
    const m = { id: ++this.seq, to: String(to), text: body, at: this.now(), read: false };
    this.messages.push(m);
    if (this.messages.length > 200) this.messages.shift();
    for (const w of [...this.waiters]) if (w.client === '*' || w.client === m.to) w.wake();
    return m;
  }

  // Unread messages for `client` ('*': any app), marked read as they're handed over.
  take(client) {
    const out = this.messages.filter((m) => !m.read && (client === '*' || m.to === client));
    for (const m of out) m.read = true;
    return out;
  }

  // take(), waiting up to `ms` for a first message if there's none yet.
  async wait(client, ms) {
    const now = this.take(client);
    if (now.length || !(ms > 0)) return now;
    await new Promise((resolve) => {
      const w = { client, wake: () => (clearTimeout(timer), this.waiters.delete(w), resolve()) };
      const timer = setTimeout(w.wake, Math.min(ms, MAX_WAIT_S * 1000));
      this.waiters.add(w);
    });
    return this.take(client);
  }
}

// How a message reads to the AI, inside the markers.
function format(messages) {
  return messages.map((m) => `${OPEN} · ${new Date(m.at).toISOString().slice(11, 16)} UTC>>>\n${m.text}\n${CLOSE}`).join('\n');
}

// A tool result on its way to `client`, with that app's unread messages after it. Markers are scrubbed from the result
// itself (page text included), so only real messages ever sit between them. `result.inbox`: messages the `inbox` tool took.
function deliver(inbox, client, name, result) {
  const unread = [...(result.inbox || []), ...inbox.take(client)];
  const text = name === 'inbox' && !unread.length ? 'No messages from the user.' : scrub(result.text);
  return { text: unread.length ? `${text}${text ? '\n\n' : ''}${format(unread)}` : text, ids: unread.map((m) => m.id) };
}

// One line per message, for --watch-inbox.
const line = (m) => `[Skillerr Pilot → ${m.to}] ${m.text.replace(/\s*\n\s*/g, ' ')}`;

module.exports = { Inbox, scrub, format, deliver, line, OPEN, CLOSE, MAX_WAIT_S };
