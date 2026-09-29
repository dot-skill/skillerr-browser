// Skillerr's live view inside an AI app's chat (MCP Apps). Shows what the AI is doing in Skillerr right now:
// its tab, or the fleet when it works several tabs at once, with the latest steps and Pause / Take over.
// Bundled with src/ui/shared.js (describeStep, esc, hostOf) into mcp/preview.html by scripts/build-preview.mjs.
import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps/app-with-deps';

const LIVE_MS = 1000; // while the AI is working
const IDLE_MS = 3000; // connected but quiet
const SLEEP_AFTER_MS = 5 * 60 * 1000; // stop polling after this long with nothing happening

const $ = (id) => document.getElementById(id);
const root = $('root');
const viewId = Math.random().toString(36).slice(2);
const createdAt = Date.now();
const app = new App({ name: 'Skillerr live view', version: '1.0.0' }, { availableDisplayModes: ['inline', 'pip', 'fullscreen'] });

const SVG = {
  pip: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><rect x="12" y="12" width="7" height="6" rx="1" fill="currentColor"/></svg>',
  full: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  inline: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
};
const MARK = { ok: '✓', error: '✕', approval: '✋', running: '…' };
const AUDIT_MARK = { read: '✓', opened: '↗', failed: '✕', blocked: '✋', declined: '⊘' };
const AUDIT_WORD = { read: 'Read', opened: 'Opened', failed: "Couldn't open", blocked: 'Blocked', declined: 'Not allowed' };

let timer = null;
let lastActivity = Date.now();
let frame = null;
let busy = false;
let auditOpen = false;

function setState(name) {
  root.className = `state-${name}`;
}

function applyContext(ctx) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  const modes = ctx.availableDisplayModes || [];
  const mode = ctx.displayMode || 'inline';
  $('pip').hidden = !modes.includes('pip') || mode === 'pip' || !!frame?.superseded;
  $('full').hidden = !modes.includes('fullscreen') || !!frame?.superseded;
  $('full').innerHTML = mode === 'fullscreen' ? SVG.inline : SVG.full;
  $('full').title = $('full').ariaLabel = mode === 'fullscreen' ? 'Back to the chat' : 'Expand';
}

// Tiles are keyed by tab id and only their changed parts are touched, so the view doesn't flicker.
function renderTiles(f) {
  const stage = $('stage');
  stage.classList.toggle('fleet', f.mode === 'fleet');
  const n = f.tiles.length;
  stage.style.setProperty('--cols', n === 2 || n === 4 ? 2 : 3);
  const keep = new Set();
  for (const t of f.tiles) {
    keep.add(String(t.id));
    let el = stage.querySelector(`[data-tab="${t.id}"]`);
    if (!el) {
      el = document.createElement('button');
      el.type = 'button';
      el.className = 'tile';
      el.dataset.tab = t.id;
      el.innerHTML = '<div class="placeholder">Loading…</div><div class="cap"><span class="title"></span><span class="host"></span><span class="badge"></span></div>';
      el.onclick = () => act('focus', t.id);
      stage.append(el);
    }
    el.title = `Show this tab in Skillerr: ${t.title}`;
    el.classList.toggle('working', t.working);
    el.querySelector('.title').textContent = t.title || 'New tab';
    el.querySelector('.host').textContent = hostOf(t.url) || '';
    el.querySelector('.badge').textContent = t.working ? 'AI working' : t.loading ? 'Loading' : '';
    if (t.image) {
      let img = el.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        img.className = 'shot';
        img.alt = '';
        el.querySelector('.placeholder')?.replaceWith(img);
      }
      if (img.src !== t.image) img.src = t.image;
    }
  }
  for (const el of [...stage.children]) if (!keep.has(el.dataset.tab)) el.remove();
  // Keep the order Skillerr gives (fleet order, or the one tab).
  f.tiles.forEach((t, i) => {
    const el = stage.querySelector(`[data-tab="${t.id}"]`);
    if (stage.children[i] !== el) stage.insertBefore(el, stage.children[i] || null);
  });
}

function renderSteps(steps) {
  $('steps').innerHTML = steps.slice().reverse().map((e) => {
    const d = describeStep(e);
    const state = e.state === 'approval' ? 'approval' : e.state || 'running';
    const text = state === 'approval' ? `Needs your OK in Skillerr: ${d.text}` : d.text;
    return `<li class="${state}"><i>${MARK[state] || '·'}</i><span>${esc(text)}</span></li>`;
  }).join('');
}

function render(f) {
  frame = f;
  if (f.offline) {
    setState('offline');
    $('who').textContent = 'Skillerr';
    $('state').textContent = 'Closed';
    $('pause').hidden = $('takeover').hidden = true;
    note('Skillerr is closed. It opens again the next time your AI browses.');
    return;
  }
  renderCount(f.count);
  if (f.superseded) {
    // One quiet line: the live view is the newest one, further down the chat. The Audit list still opens here.
    setState('superseded');
    $('who').textContent = '↓ Live view continues below';
    $('state').textContent = f.count ? `${f.count} page${f.count === 1 ? '' : 's'} so far` : 'Earlier';
    $('pause').hidden = $('takeover').hidden = $('pip').hidden = $('full').hidden = true;
    $('stage').replaceChildren();
    $('steps').replaceChildren();
    note('');
    stop();
    return;
  }
  const name = f.controller || 'Your AI';
  $('who').textContent = `${name} in Skillerr`;
  $('deep').hidden = !f.deep;
  $('deep').textContent = f.deep ? `Deep · depth ${f.deep}` : '';
  const approval = f.awaitingApproval;
  setState(approval ? 'approval' : f.paused ? 'paused' : f.live ? 'live' : 'idle');
  $('state').textContent = approval ? 'Needs your OK' : f.paused ? 'Paused' : f.live ? (f.mode === 'fleet' ? `Working · ${f.tiles.length} tabs` : 'Working') : 'Idle';
  $('pause').hidden = false;
  $('pause').textContent = f.paused ? 'Resume' : 'Pause';
  // A pending approval is decided in Skillerr, next to the page, never from the chat.
  $('takeover').hidden = f.paused && !approval;
  $('takeover').textContent = approval ? 'Review in Skillerr' : 'Take over';
  renderTiles(f);
  renderSteps(f.steps || []);
  note(!f.tiles.length ? (f.count ? 'Its pages are closed now. Audit lists them all.' : 'No page open yet.') : approval ? 'Skillerr is waiting for you to allow or deny an action.' : '');
  if (f.live || approval) lastActivity = Date.now();
}

function renderCount(n) {
  $('audit').hidden = !n && !auditOpen;
  $('audit').textContent = n ? `Audit · ${n}` : 'Audit';
}

function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? 'now' : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
}

function renderAudit(pages) {
  const list = $('auditList');
  if (!pages.length) {
    list.innerHTML = '<li class="empty">Nothing opened yet in this research.</li>';
    return;
  }
  list.innerHTML = pages.map((p, i) => {
    const why = p.reason ? ` · ${p.reason}` : '';
    const tries = p.attempts > 1 ? ` · ${p.attempts} tries` : '';
    return `<li class="${esc(p.state)}"><button type="button" data-i="${i}" title="${esc(`${AUDIT_WORD[p.state] || ''}${why}${tries}\n${p.url}\nOpen in Skillerr`)}">` +
      `<i>${AUDIT_MARK[p.state] || '·'}</i><span class="t"><b>${esc(p.title || hostOf(p.url) || p.url)}</b><span>${esc(hostOf(p.url) || p.url)}${p.state === 'failed' || p.state === 'blocked' || p.state === 'declined' ? ` · ${esc(AUDIT_WORD[p.state])}` : ''}</span></span>` +
      `<time>${ago(p.ts)}</time></button></li>`;
  }).join('');
  list.querySelectorAll('button[data-i]').forEach((b) => {
    b.onclick = () => act('open', null, pages[Number(b.dataset.i)].url);
  });
}

async function loadAudit() {
  try {
    const r = await app.callServerTool({ name: 'skillerr_preview_audit', arguments: {} });
    const sc = r.structuredContent || {};
    if (sc.offline) {
      $('auditList').innerHTML = '<li class="empty">Skillerr is closed.</li>';
      return;
    }
    renderAudit(sc.pages || []);
    renderCount((sc.pages || []).length);
  } catch (err) {
    $('auditList').innerHTML = `<li class="empty">Can't reach Skillerr (${esc(err.message)}).</li>`;
  }
}

function toggleAudit() {
  auditOpen = !auditOpen;
  $('auditPanel').hidden = !auditOpen;
  $('audit').setAttribute('aria-expanded', String(auditOpen));
  if (auditOpen) loadAudit();
}

function note(text) {
  $('note').hidden = !text;
  $('note').textContent = text || '';
}

async function poll() {
  if (busy) return;
  busy = true;
  try {
    const r = await app.callServerTool({ name: 'skillerr_preview_frame', arguments: { viewId, createdAt } });
    if (r.isError) throw new Error(r.content?.[0]?.text || 'error');
    render(r.structuredContent || {});
    if (auditOpen) loadAudit();
  } catch (err) {
    setState('offline');
    $('state').textContent = 'Not connected';
    note(`Can't reach Skillerr (${err.message}).`);
  } finally {
    busy = false;
  }
  schedule();
}

function schedule() {
  clearTimeout(timer);
  if (frame?.superseded || document.hidden) return;
  if (Date.now() - lastActivity > SLEEP_AFTER_MS) {
    note('Live view paused while nothing is happening. It picks up again when you click.');
    root.addEventListener('click', wake, { once: true });
    return;
  }
  timer = setTimeout(poll, frame?.live || frame?.awaitingApproval ? LIVE_MS : IDLE_MS);
}

function stop() {
  clearTimeout(timer);
  timer = null;
}

function wake() {
  lastActivity = Date.now();
  poll();
}

async function act(action, tabId, url) {
  try {
    await app.callServerTool({ name: 'skillerr_preview_action', arguments: { action, ...(tabId != null ? { tabId } : {}), ...(url ? { url } : {}) } });
  } catch {}
  if (frame?.superseded) return; // an earlier view stays a quiet line
  wake();
}

$('pause').onclick = () => act(frame?.paused ? 'resume' : 'pause');
$('takeover').onclick = () => act(frame?.awaitingApproval ? 'focus' : 'takeover', frame?.tiles?.find((t) => t.working)?.id ?? frame?.tiles?.[0]?.id);
$('audit').onclick = toggleAudit;
// The header opens Skillerr on what the AI is working on.
$('open').onclick = () => !frame?.superseded && act('focus', frame?.tiles?.find((t) => t.working)?.id ?? frame?.tiles?.[0]?.id);
$('pip').innerHTML = SVG.pip;
$('pip').onclick = () => app.requestDisplayMode({ mode: 'pip' }).then((r) => applyContext({ ...app.getHostContext(), displayMode: r.mode })).catch(() => {});
$('full').onclick = () => {
  const mode = app.getHostContext()?.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
  app.requestDisplayMode({ mode }).then((r) => applyContext({ ...app.getHostContext(), displayMode: r.mode })).catch(() => {});
};
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : wake()));

app.onhostcontextchanged = (ctx) => applyContext({ ...app.getHostContext(), ...ctx });
app.ontoolresult = () => wake(); // the tool this view belongs to finished: refresh at once
app.onteardown = async () => {
  stop();
  return {};
};
app.onerror = () => {};

app.connect().then(() => {
  applyContext(app.getHostContext());
  wake();
});
