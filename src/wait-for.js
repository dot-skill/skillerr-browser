// wait_for: the AI waits for something to happen in a tab, usually the user doing their part ("click Reply when you're
// happy with it"), instead of the user typing "done" in the chat. What counts as having happened lives here; main.js
// watches the tab (its URL, text, elements, and the user's own clicks) and only ever looks: it never clicks or types.

const DEFAULT_WAIT_S = 120;
const MAX_WAIT_S = 600;

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// "x.com/*/status/*" (a * matches anything), "/status\/\d+/" (a regular expression), or plain text the URL contains.
function urlMatcher(pattern) {
  const p = String(pattern ?? '').trim();
  if (!p) throw new Error('url_matches needs a pattern, e.g. "x.com/*/status/*".');
  const re = p.match(/^\/(.+)\/([a-z]*)$/);
  if (re) {
    try {
      const r = new RegExp(re[1], re[2].replace(/[gy]/g, ''));
      return (u) => r.test(u);
    } catch {
      throw new Error(`"${p}" is not a valid regular expression.`);
    }
  }
  if (p.includes('*')) {
    const r = new RegExp(p.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'i');
    return (u) => r.test(u);
  }
  return (u) => String(u).toLowerCase().includes(p.toLowerCase());
}

// The AI's `until`, checked and made ready to test: exactly one condition.
function checkUntil(until, timeoutS) {
  const keys = Object.keys(until || {}).filter((k) => until[k] !== undefined && until[k] !== null && until[k] !== false);
  if (keys.length !== 1) throw new Error('Give exactly one condition in `until`: url_matches, text_appears, element_gone, user_clicked or navigated.');
  const [kind] = keys;
  const v = until[kind];
  const ms = Math.round(Math.min(MAX_WAIT_S, Math.max(1, Number(timeoutS) || DEFAULT_WAIT_S)) * 1000);
  if (kind === 'url_matches') return { kind, test: urlMatcher(v), ms };
  if (kind === 'text_appears') {
    if (!norm(v)) throw new Error('text_appears needs the text to look for.');
    return { kind, text: norm(v), ms };
  }
  if (kind === 'element_gone') {
    const ids = [].concat(v).map(Number).filter(Number.isInteger);
    if (!ids.length) throw new Error('element_gone needs the [id] of an element from the snapshot.');
    return { kind, ids, ms };
  }
  if (kind === 'user_clicked') {
    if (!norm(v)) throw new Error('user_clicked needs the label of what the user will click, e.g. "Reply".');
    return { kind, label: norm(v), ms };
  }
  if (kind === 'navigated') return { kind, ms };
  throw new Error(`Unknown condition "${kind}". Use url_matches, text_appears, element_gone, user_clicked or navigated.`);
}

// A clicked element's label counts if it is the label asked for, as a whole word at its start ("Reply" matches "Reply"
// and "Reply all", not "Replying"), or one part of a label like "Reply · 3".
const labelMatches = (want, got) => {
  const g = norm(got);
  return !!g && (g === want || g.startsWith(`${want} `) || g.split(/\s*[·|,]\s*/).includes(want));
};

// Has it happened? state: { url, startUrl, navigations, text, present: { id: bool } | null, clicks: [label] }.
// Returns what happened, in the AI's own terms (never page text), or null.
function met(u, s) {
  switch (u.kind) {
    case 'url_matches': return u.test(s.url || '') ? { what: 'url_matches' } : null;
    case 'text_appears': return norm(s.text).includes(u.text) ? { what: 'text_appears' } : null;
    case 'element_gone': return s.present && u.ids.every((id) => s.present[id] === false) ? { what: 'element_gone', ids: u.ids } : null;
    case 'user_clicked': return (s.clicks || []).some((c) => labelMatches(u.label, c)) ? { what: 'user_clicked' } : null;
    case 'navigated': return s.navigations > 0 || (s.url && s.startUrl && s.url !== s.startUrl) ? { what: 'navigated' } : null;
    default: return null;
  }
}

module.exports = { checkUntil, met, labelMatches, urlMatcher, DEFAULT_WAIT_S, MAX_WAIT_S };
