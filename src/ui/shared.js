// Shared by the browser chrome (ui.js) and the floating HUD (hud.js).

const ICON_PATHS = {
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  pointer: '<path d="m4 4 7.07 17 2.51-7.39L21 11.07z"/>',
  type: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  keyboard: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>',
  sparkle: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<path d="M6 3l14 9-14 9z"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  arrowUp: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  reload: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  more: '<circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/>',
  blocks: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/>',
  film: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M7 3v18M17 3v18M2 8h5M2 16h5M17 8h5M17 16h5"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  captions: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/>',
  record: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
};

// Brand marks for the AI apps people connect (shown as masks, in each brand's colour).
const BRANDS = {
  'claude desktop': { file: 'claude', color: '#D97757' }, 'claude-desktop': { file: 'claude', color: '#D97757' },
  'claude code': { file: 'claude', color: '#D97757', badge: '>_' }, 'claude-code': { file: 'claude', color: '#D97757', badge: '>_' },
  cursor: { file: 'cursor' }, windsurf: { file: 'windsurf', color: '#0B9B8A' }, ollama: { file: 'ollama' },
};
function brandIcon(name, size = 16) {
  const b = BRANDS[String(name || '').toLowerCase()];
  if (!b) return '';
  const mark = `<span class="brand" style="--sz:${size}px;--c:${b.color || 'currentColor'};--m:url(brands/${b.file}.svg)"></span>`;
  return b.badge ? `<span class="brand-wrap">${mark}<i>${b.badge}</i></span>` : mark;
}

function icon(name, size = 16) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ''}</svg>`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const trunc = (s, n) => (String(s ?? '').length > n ? String(s).slice(0, n - 1) + '…' : String(s ?? ''));

// ---------- what does the user mean? ----------

function looksLikeUrl(s) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^localhost(:\d+)?(\/|$)/.test(s) || (!/\s/.test(s) && /^[^/]+\.[a-z]{2,}(\/|$|:|\?)/i.test(s));
}

const TASK_VERBS = /^(please\s+)?(find|book|compare|summari[sz]e|go to|open|search for|look up|buy|order|check|show|get|tell|list|write|reply|fill|sign|help|plan|research|read|explain|translate|make|create|add|remove|download|watch|play|track|schedule|email|send|draft|what|how|why|who|when|where|which|is|are|can|could|should|do|does)\b/i;

function detectIntent(text) {
  const s = text.trim();
  if (!s) return null;
  if (looksLikeUrl(s)) return 'go';
  const words = s.split(/\s+/).length;
  if (words >= 6 || (TASK_VERBS.test(s) && words >= 3)) return 'ask';
  return 'search';
}

const INTENTS = {
  go: { label: 'Go', icon: 'arrowRight' },
  search: { label: 'Search', icon: 'search' },
  ask: { label: 'Ask Skillerr', icon: 'sparkle' },
};

// ---------- plain-English activity ----------

function hostOf(u) {
  const s = String(u || '').trim();
  if (!looksLikeUrl(s)) return null;
  try {
    return new URL(/^[a-z]+:\/\//i.test(s) ? s : 'https://' + s).hostname.replace(/^www\./, '');
  } catch {
    return s;
  }
}

function describeStep(e) {
  const a = e.args || {};
  const t = e.target ? `“${trunc(e.target, 40)}”` : a.id != null ? `item ${a.id}` : '';
  switch (e.tool) {
    case 'navigate': {
      const h = hostOf(a.url);
      return { icon: h ? 'globe' : 'search', text: h ? `Opening ${h}` : `Searching for “${trunc(a.url, 50)}”` };
    }
    case 'click': return { icon: 'pointer', text: `Clicking ${t}` };
    case 'type': return { icon: 'type', text: `Typing “${trunc(a.text, 40)}”${e.target ? ` into ${t}` : ''}${a.submit ? ' and submitting' : ''}` };
    case 'select_option': return { icon: 'list', text: `Choosing “${trunc(a.option, 40)}”${e.target ? ` in ${t}` : ''}` };
    case 'press_key': return { icon: 'keyboard', text: `Pressing ${a.key}` };
    case 'scroll': return { icon: a.direction === 'up' ? 'up' : 'down', text: `Scrolling ${a.direction || 'down'}` };
    case 'snapshot': return { icon: 'eye', text: 'Looking at the page' };
    case 'read_page': return { icon: 'book', text: 'Reading the page' };
    case 'screenshot': return { icon: 'camera', text: 'Taking a screenshot' };
    case 'go_back': return { icon: 'left', text: 'Going back' };
    case 'go_forward': return { icon: 'right', text: 'Going forward' };
    case 'list_tabs': return { icon: 'layers', text: 'Checking open tabs' };
    case 'new_tab': return { icon: 'plus', text: a.url ? `Opening ${hostOf(a.url) || trunc(a.url, 40)} in a new tab` : 'Opening a new tab' };
    case 'switch_tab': return { icon: 'layers', text: 'Switching tabs' };
    case 'close_tab': return { icon: 'x', text: 'Closing a tab' };
    case 'wait': return { icon: 'clock', text: 'Waiting for the page' };
    case 'open_tabs': return { icon: 'layers', text: `Opening ${(a.urls || []).length} tabs` };
    case 'read_tabs': return { icon: 'book', text: 'Reading several tabs' };
    case 'dispatch': return { icon: 'layers', text: `Running “${trunc(a.instruction, 40)}” in parallel tabs` };
    case 'deep_research': return { icon: 'layers', text: `Deep research on “${trunc(a.query, 40)}”${a.depth ? ` · depth ${a.depth}` : ''}` };
    case 'web_search': return { icon: 'search', text: `Searching for “${trunc(a.query, 48)}”` };
    case 'fetch_page': { const h = hostOf(a.url); return { icon: 'book', text: `Reading ${h || trunc(a.url, 40)}` }; }
    case 'save_screenshot': return { icon: 'camera', text: a.scope === 'window' ? 'Screenshotting the Skillerr window' : a.scope === 'full_page' ? 'Screenshotting the whole page' : 'Taking a screenshot' };
    case 'open_view': return { icon: 'eye', text: a.view === 'memory' ? `Showing your research graph${a.query ? ` for “${trunc(a.query, 30)}”` : ''}` : `Showing ${a.view}` };
    case 'my_research': return { icon: 'folder', text: 'Checking your saved research' };
    case 'read_note': return { icon: 'doc', text: `Reading your note “${trunc(a.title, 40)}”` };
    case 'recall': return { icon: 'clock', text: `Recalling past research on “${trunc(a.query, 44)}”` };
    case 'tag_session': return { icon: 'layers', text: (a.topics || []).length ? `Filing this research under ${trunc(a.topics.join(', '), 50)}` : 'Filing this research' };
    case 'save_skill': return { icon: 'blocks', text: `Learning a skill: ${a.name}` };
    case 'save_note': return { icon: 'doc', text: `Saving “${trunc(a.title, 40)}” to your notes` };
    case 'list_skills': return { icon: 'blocks', text: 'Checking skills' };
    case 'use_skill': return { icon: 'blocks', text: `Using the ${a.name} skill` };
    case 'record_start': return { icon: 'record', text: a.title ? `Recording “${trunc(a.title, 40)}”` : 'Starting a recording' };
    case 'caption': return { icon: 'captions', text: a.text ? `Caption: “${trunc(a.text, 48)}”` : 'Hiding the caption' };
    case 'record_stop': return { icon: 'film', text: 'Saving the recording' };
    default: return { icon: 'sparkle', text: e.tool };
  }
}

// ---------- tiny, safe markdown for AI replies ----------

function mdInline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="#" data-url="$2">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="#" data-url="$2">$2</a>');
}

function markdown(src) {
  let html = '';
  let list = null;
  for (const line of esc(src).split('\n')) {
    const li = line.match(/^\s*([-*•]|\d+\.)\s+(.*)/);
    if (li) {
      const kind = /\d/.test(li[1]) ? 'ol' : 'ul';
      if (list !== kind) {
        if (list) html += `</${list}>`;
        html += `<${kind}>`;
        list = kind;
      }
      html += `<li>${mdInline(li[2])}</li>`;
      continue;
    }
    if (list) {
      html += `</${list}>`;
      list = null;
    }
    const h = line.match(/^#{1,6}\s+(.*)/);
    if (h) html += `<h4>${mdInline(h[1])}</h4>`;
    else if (line.trim()) html += `<p>${mdInline(line)}</p>`;
  }
  if (list) html += `</${list}>`;
  return html;
}
