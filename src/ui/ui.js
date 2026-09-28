/* global skillerr, icon, esc, trunc, detectIntent, looksLikeUrl, INTENTS, describeStep, markdown */
const $ = (id) => document.getElementById(id);
// Window buttons: macOS puts them top-left, Windows and Linux top-right; the tab strip leaves room for them.
document.body.classList.add(/Mac/.test(navigator.platform) ? 'os-mac' : 'os-other');
const h = (tag, cls, html) => Object.assign(document.createElement(tag), { className: cls || '', innerHTML: html || '' });

const IDEAS = [
  'Summarize today’s top story on Hacker News',
  'Check this weekend’s weather in Tokyo, Paris and New York',
  'Find well-reviewed noise-cancelling headphones under $200',
  'Explain the Wikipedia article on auroras simply',
];
// Page suggestions that need the built-in AI stay off until Pro; the panel offers what works with any AI.
const PAGE_CHIPS = [];
const CONN_ICONS = { 'claude-desktop': 'message', 'claude-code': 'terminal', cursor: 'code' };
const OTHER_PRESETS = {
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: '' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: '' },
  custom: { baseUrl: '', model: '' },
};
const PRO_GATEWAY = 'https://ai-gateway.vercel.sh/v1'; // direct, for a gateway key (the owner's own)
const PRO_API = 'https://skillerr.com/api/pro/v1'; // licensed: skillerr.com checks the license, then calls the gateway
const PRO_NAMES = { 'anthropic/claude-sonnet-5': 'Claude Sonnet 5', 'anthropic/claude-opus-5.5': 'Claude Opus 5.5', 'anthropic/claude-haiku-4.5': 'Claude Haiku 4.5', 'google/gemini-3.5-flash': 'Gemini 3.5 Flash' };
const CLAUDE_NAMES = { 'claude-opus-5': 'Claude Opus 5', 'claude-sonnet-5': 'Claude Sonnet 5', 'claude-haiku-4-5': 'Claude Haiku 4.5' };

let currentTab = null;
let status = {};
let settings = {};
let agentRunning = false;
let pendingTask = null;

// Static icons
$('newtab').innerHTML = icon('plus', 16);
$('tidyBtn').innerHTML = `${icon('layers', 13)}<span>Tidy</span>`;
$('back').innerHTML = icon('left', 18);
$('forward').innerHTML = icon('right', 18);
$('reload').innerHTML = icon('reload', 15);
$('openConnect').innerHTML = icon('plug', 16);
$('openSettings').innerHTML = icon('sliders', 16);
$('closePanel').innerHTML = icon('panel', 16);
$('openSkills').innerHTML = icon('blocks', 16);
$('moreMenu').innerHTML = icon('more', 18);
$('moreMenu').onclick = () => {
  const r = $('moreMenu').getBoundingClientRect();
  skillerr.send('app-menu', { x: r.right - 240, y: r.bottom + 4 });
};
skillerr.on('open-sheet', (name) => openSheet(name));

// ----- find in page (⌘F) -----
$('findPrev').innerHTML = icon('up', 15);
$('findNext').innerHTML = icon('down', 15);
$('findClose').innerHTML = icon('x', 14);
function openFind() {
  $('findBar').hidden = false;
  $('findInput').focus();
  $('findInput').select();
}
function closeFind() {
  $('findBar').hidden = true;
  $('findCount').textContent = '';
  skillerr.send('find-stop');
}
const findGo = (forward = true, next = true) => skillerr.send('find', { text: $('findInput').value, forward, next });
$('findInput').addEventListener('input', () => findGo(true, false));
$('findInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') findGo(!e.shiftKey, true);
  if (e.key === 'Escape') closeFind();
});
$('findPrev').onclick = () => findGo(false, true);
$('findNext').onclick = () => findGo(true, true);
$('findClose').onclick = closeFind;
skillerr.on('find-open', openFind);
skillerr.on('find-next', (fwd) => ($('findBar').hidden ? openFind() : findGo(fwd, true)));
skillerr.on('find-result', (r) => ($('findCount').textContent = $('findInput').value ? `${r.active}/${r.total}` : ''));

// ----- zoom -----
skillerr.on('zoom', (pct) => {
  $('zoomBadge').hidden = pct === 100;
  $('zoomBadge').textContent = `${pct}%`;
});
$('zoomBadge').onclick = () => skillerr.send('zoom', 0);

// ----- pop-up blocker -----
skillerr.on('popup-blocked', ({ host, url }) => {
  const chip = $('popupChip');
  chip.hidden = false;
  chip.innerHTML = `${icon('x', 12)}<span>Pop-up blocked</span>`;
  const open = btn('Open', 'ghost', () => {
    skillerr.send('popup-open', url);
    chip.hidden = true;
  });
  const allow = btn(`Always allow ${esc(host)}`, 'ghost', () => {
    skillerr.send('popup-allow', { host, url });
    chip.hidden = true;
  });
  chip.append(open, allow);
  clearTimeout(chip.timer);
  chip.timer = setTimeout(() => (chip.hidden = true), 12000);
});

// ----- updates and notices from skillerr.com (stays until closed) -----
skillerr.on('update', (u) => {
  const chip = $('updateChip');
  chip.hidden = false;
  chip.title = u.restart ? `Skillerr ${u.version} is ready. Click to restart and update.`
    : u.version ? `Skillerr ${u.version} is available${u.text ? `: ${u.text}` : ''}. Click to download.` : u.text;
  chip.innerHTML = `<span class="dot"></span><span>${u.restart ? 'Restart to update' : u.version ? 'Update' : esc(u.text.length > 32 ? u.text.slice(0, 31) + '…' : u.text)}</span>`;
  chip.onclick = () => (u.restart ? skillerr.send('update-restart') : u.url && skillerr.send('update-open', u.url));
  chip.append(btn(icon('x', 10), 'ghost icon-only', (e) => {
    e?.stopPropagation?.();
    skillerr.send('update-dismiss', u.id);
    chip.hidden = true;
  }));
});

// ----- passkeys: when one can't be used here, say why and point to the site's other sign-in route -----
skillerr.on('passkey-help', ({ tabId, reason, platform }) => {
  const chip = $('passkeyChip');
  chip.hidden = false;
  const text = reason === 'failed' ? "That passkey isn't saved in Skillerr"
    : platform === 'darwin' ? 'Passkeys need the signed Skillerr for Mac' : "Passkeys aren't available here yet";
  chip.title = reason === 'failed'
    ? 'Skillerr can use passkeys created in Skillerr (Touch ID or Windows Hello). Passkeys saved in iCloud Keychain or another browser stay there. Sign in another way, then add a passkey for Skillerr in your account settings.'
    : 'Sign in another way, like a password or a code sent to your phone.';
  chip.innerHTML = `${icon('key', 12)}<span>${esc(text)}</span>`;
  chip.append(btn('Use another way', 'ghost', () => {
    skillerr.send('passkey-other-way', tabId);
    chip.hidden = true;
  }), btn(icon('x', 11), 'ghost icon-only', () => (chip.hidden = true)));
  clearTimeout(chip.timer);
  chip.timer = setTimeout(() => (chip.hidden = true), 30000);
});

// ----- downloads -----
$('dlBtn').innerHTML = icon('down', 16);
$('dlBtn').onclick = () => openSheet('downloads');
const downloads = new Map();
const mb = (n) => `${(n / 1048576).toFixed(n > 1048576 * 10 ? 0 : 1)} MB`;
skillerr.on('download', (d) => {
  downloads.set(d.id, d);
  $('dlBtn').hidden = false;
  $('dlBtn').classList.toggle('busy', [...downloads.values()].some((x) => x.state === 'progressing'));
  const list = $('dlList');
  list.innerHTML = '';
  for (const x of [...downloads.values()].reverse()) {
    const pct = x.total ? Math.round((x.received / x.total) * 100) : 0;
    const row = h('div', 'dl-row', `<div class="dl-name">${esc(x.name)}</div><div class="dl-sub muted">${
      x.state === 'completed' ? `${mb(x.total || x.received)} · done` : x.state === 'progressing' ? `${mb(x.received)}${x.total ? ` of ${mb(x.total)}` : ''}` : x.state}</div>
      ${x.state === 'progressing' ? `<div class="dl-bar"><i style="width:${pct}%"></i></div>` : ''}`);
    if (x.state === 'completed') {
      const acts = h('div', 'imp-row');
      acts.append(btn('Open', 'ghost', () => skillerr.send('download-open', { file: x.file })), btn('Show in folder', 'ghost', () => skillerr.send('download-open', { file: x.file, reveal: true })));
      row.appendChild(acts);
    }
    list.appendChild(row);
  }
});

// Window screenshots: grab one frame of Skillerr's own window (same source as window recordings).
skillerr.on('grab-window', async ({ id, sourceId, width, height }) => {
  try {
    const dpr = window.devicePixelRatio || 1;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId,
      maxWidth: Math.round(width * dpr), maxHeight: Math.round(height * dpr) } } });
    const v = document.createElement('video');
    v.srcObject = stream;
    v.muted = true;
    await v.play();
    await new Promise((r) => setTimeout(r, 250));
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    stream.getTracks().forEach((t) => t.stop());
    skillerr.send('grab-window-done', { id, data: c.toDataURL('image/png').split(',')[1] });
  } catch (err) {
    skillerr.send('grab-window-done', { id, error: err.message || String(err) });
  }
});
skillerr.on('compose-window', async ({ id, width, height, layers }) => {
  try {
    const dpr = window.devicePixelRatio || 1;
    const c = document.createElement('canvas');
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext('2d');
    g.fillStyle = getComputedStyle(document.body).backgroundColor || '#0c0c10';
    g.fillRect(0, 0, c.width, c.height);
    for (const l of layers) {
      const img = new Image();
      img.src = `data:image/png;base64,${l.data}`;
      await img.decode();
      g.drawImage(img, l.x * dpr, l.y * dpr, l.w * dpr, l.h * dpr);
    }
    skillerr.send('grab-window-done', { id, data: c.toDataURL('image/png').split(',')[1] });
  } catch (err) {
    skillerr.send('grab-window-done', { id, error: err.message || String(err) });
  }
});
skillerr.on('shot-saved', () => flash('Screenshot saved to Pictures/Skillerr'));

// Right-click → "Ask Skillerr about …" fills the composer.
skillerr.on('prefill-task', (text) => {
  taskInput.value = text;
  autosize();
  taskInput.focus();
});

// Search engine applies right away.
$('searchEngine').onchange = () => saveSettings({ searchEngine: $('searchEngine').value });
$('searchApi').onchange = () => ($('searchApiKeyRow').hidden = !$('searchApi').value);
skillerr.on('close-sheets', () => closeSheets());
$('installSkill').innerHTML = `${icon('plus', 14)}Install a skill…`;
document.querySelector('#recPill .rec-stop').innerHTML = icon('stop', 11);
$('heroSend').innerHTML = icon('arrowUp', 18);
$('trustIcon').innerHTML = icon('shield', 15);
document.querySelectorAll('.back-btn').forEach((b) => (b.innerHTML = icon('left', 18)));

// ================= tabs =================

const collapsedGroups = new Set();
skillerr.on('tabs', (list) => {
  const box = $('tabs');
  box.innerHTML = '';
  let lastGroup = null;
  for (const t of list) {
    // A chip starts each group: the tabs one AI opened for one research task, or the open tabs of one trail.
    const grp = t.group || t.trailGroup;
    if (grp && grp.id !== lastGroup) {
      const members = list.filter((x) => (x.group || x.trailGroup)?.id === grp.id);
      const folded = collapsedGroups.has(grp.id);
      const g = h('div', 'tab-group' + (folded ? ' collapsed' : '') + (members.some((x) => x.ai) ? ' live' : '') + (t.trailGroup ? ' trail' : ''));
      g.style.setProperty('--g', grp.color);
      if (t.trailGroup) {
        g.title = `${grp.title} · ${members.length} tabs of this trail. Click to ${folded ? 'unfold' : 'fold'} them. Focus folds every other trail; × puts them away in the trail.`;
        g.innerHTML = `<span class="gdot"></span><span class="gtitle">${esc(trunc(grp.title, 22))}</span><span class="gn">${members.length}</span>` +
          `<button class="focus" title="Focus on this trail: fold the others">${icon('eye', 11)}</button><button class="x" title="Put these ${members.length} tabs away in the trail">${icon('x', 11)}</button>`;
      } else {
        g.title = `${grp.title} · ${members.length} tab${members.length === 1 ? '' : 's'} opened by ${grp.controller}. Click to ${folded ? 'expand' : 'collapse'}.`;
        g.innerHTML = `<span class="gdot"></span><span class="gtitle">${esc(trunc(grp.title, 22))}</span><span class="gn">${members.length}</span><button class="x" title="Close all ${members.length} tabs">${icon('x', 11)}</button>`;
      }
      g.onclick = (e) => {
        if (e.target.closest('.x')) return t.trailGroup ? skillerr.send('trail-group-tuck', grp.trailId) : skillerr.send('group-close', grp.id);
        if (e.target.closest('.focus')) {
          for (const x of list) {
            const o = x.trailGroup;
            if (o && o.id !== grp.id) collapsedGroups.add(o.id);
          }
          collapsedGroups.delete(grp.id);
          return skillerr.invoke('tabs-refresh');
        }
        if (collapsedGroups.has(grp.id)) collapsedGroups.delete(grp.id);
        else collapsedGroups.add(grp.id);
        skillerr.invoke('tabs-refresh');
      };
      box.appendChild(g);
    }
    lastGroup = grp?.id ?? null;
    if (grp && collapsedGroups.has(grp.id) && !t.active) continue;
    const el = h('div', 'tab' + (t.active ? ' on' : '') + (t.loading ? ' loading' : '') + (t.ai ? ' ai' : '') + (grp ? ' grouped' : '') + (t.asleep ? ' asleep' : ''));
    if (grp) el.style.setProperty('--g', grp.color);
    el.title = t.asleep ? `${t.title}\nSleeping to keep Skillerr light. Click to wake it.` : t.title;
    const fav = t.favicon ? `<img src="${esc(t.favicon)}">` : icon(t.isStart ? 'sparkle' : 'globe', 13);
    el.innerHTML = `<span class="fav">${fav}</span><span class="title">${esc(t.title)}</span><button class="x" title="Close  ⌘W">${icon('x', 12)}</button>`;
    el.onmousedown = (e) => e.button === 0 && !e.target.closest('.x') && skillerr.send('switch-tab', t.id);
    el.onauxclick = (e) => e.button === 1 && skillerr.send('close-tab', t.id);
    el.querySelector('.x').onclick = () => skillerr.send('close-tab', t.id);
    const img = el.querySelector('img');
    if (img) img.onerror = () => (img.outerHTML = icon('globe', 13));
    box.appendChild(el);
    if (t.active) currentTab = t;
  }
  renderMosaicLabels(list);
  renderGroupsOnStart(list);
  // Many open tabs: offer to tidy them into their trails.
  const pages = list.filter((t) => !t.isStart && !t.internal).length;
  $('tidyBtn').hidden = pages < 9 || settings.trails === false;
  $('tidyBtn').querySelector('span').textContent = `Tidy ${pages} tabs`;
  if (!currentTab) return;
  const memTab = currentTab.internal === 'memory';
  const dataTab = currentTab.internal === 'data';
  const trailsTab = currentTab.internal === 'trails';
  const wasStart = !$('start').hidden;
  $('start').hidden = !currentTab.isStart || memTab || dataTab || trailsTab || list.some((x) => x.tiled);
  $('memView').hidden = !memTab;
  $('dataView').hidden = !dataTab;
  $('trailsView').hidden = !trailsTab;
  if (memTab) window.memoryView?.show();
  if (dataTab) window.dataView?.show();
  if (trailsTab && $('trailsView').dataset.shown !== '1') window.trailsView?.show();
  $('trailsView').dataset.shown = trailsTab ? '1' : '';
  if (!$('start').hidden && !wasStart) renderTrailsHome();
  if (document.activeElement !== $('url')) omni.reset();
  $('back').disabled = !currentTab.canGoBack;
  $('forward').disabled = !currentTab.canGoForward;
  $('reload').innerHTML = currentTab.loading ? icon('x', 16) : icon('reload', 15);
  $('reload').title = currentTab.loading ? 'Stop' : 'Reload  ⌘R';
  $('omni').classList.toggle('loading', !!currentTab.loading && !currentTab.isStart);
  $('omni').classList.toggle('ai', !!currentTab.ai);
  if (currentTab.isStart && document.activeElement !== $('task')) setTimeout(() => $('hero').focus(), 0);
  renderComposerContext();
});

$('newtab').onclick = () => skillerr.send('new-tab');

// ================= the trail shelf: tucked tabs, still there by their icons =================
// Tabs tucked into trails don't vanish from where the user looks for them: each trail is a chip at the start of the
// tab strip with its tabs' icons. Click it and its tabs unfold in place, as icons; click one to bring it back.
let shelfData = { trails: [], more: 0 };
let shelfOpen = null; // the trail unfolded in the strip
const favImg = (f, size) => (f ? `<img src="${esc(f)}" width="${size}" height="${size}">` : icon('globe', size - 1));
function iconFallback(el, size) {
  el.querySelectorAll('img').forEach((img) => (img.onerror = () => (img.outerHTML = icon('globe', size - 1))));
}
function renderShelf() {
  const box = $('shelf');
  const { trails, more } = shelfData;
  box.hidden = !trails.length || settings.trails === false;
  box.innerHTML = '';
  if (box.hidden) return;
  if (shelfOpen && !trails.some((t) => t.id === shelfOpen)) shelfOpen = null;
  for (const t of trails) {
    const open = shelfOpen === t.id;
    const icons = [...new Map(t.tabs.map((x) => [x.favicon || x.url, x])).values()].slice(0, 3);
    const chip = h('button', 'shelf-trail' + (open ? ' open' : ''));
    chip.type = 'button';
    chip.title = `${t.title}\n${t.count} tucked tab${t.count === 1 ? '' : 's'}: ${t.tabs.slice(0, 6).map((x) => x.title).join(', ')}${t.count > 6 ? '…' : ''}\n\nClick to ${open ? 'fold them away' : 'show them'}.`;
    chip.innerHTML = `<span class="st-icons">${icons.map((x) => `<span class="st-fav">${favImg(x.favicon, 14)}</span>`).join('')}</span>` +
      (open ? `<span class="st-title">${esc(trunc(t.title, 22))}</span>` : '') + `<span class="st-n">${t.count}</span>`;
    chip.onclick = () => {
      shelfOpen = open ? null : t.id;
      renderShelf();
    };
    iconFallback(chip, 14);
    box.appendChild(chip);
    if (!open) continue;
    const group = h('div', 'shelf-tabs');
    for (const x of t.tabs.slice(0, 12)) {
      const g = h('button', 'ghost-tab', favImg(x.favicon, 16));
      g.type = 'button';
      g.title = `${x.title}\n${x.url}\n\nClick to open it again.`;
      g.onclick = () => skillerr.invoke('trails-reopen-tab', { id: t.id, url: x.url });
      iconFallback(g, 16);
      group.appendChild(g);
    }
    if (t.count > 12) {
      const rest = h('button', 'ghost-tab rest', `+${t.count - 12}`);
      rest.type = 'button';
      rest.title = `${t.count - 12} more tabs in “${t.title}”`;
      rest.onclick = () => skillerr.send('open-trails');
      group.appendChild(rest);
    }
    const all = h('button', 'ghost-tab all', icon('arrowUp', 13));
    all.type = 'button';
    all.title = `Open all ${t.count} tabs of “${t.title}”`;
    all.onclick = () => {
      shelfOpen = null;
      skillerr.invoke('trails-continue', t.id);
    };
    group.appendChild(all);
    box.appendChild(group);
  }
  if (more) {
    const m = h('button', 'shelf-trail more', `+${more}`);
    m.type = 'button';
    m.title = `${more} more trail${more === 1 ? '' : 's'} with tucked tabs`;
    m.onclick = () => skillerr.send('open-trails');
    box.appendChild(m);
  }
}
skillerr.on('trails-shelf', (data) => {
  shelfData = data || { trails: [], more: 0 };
  renderShelf();
});
$('tidyBtn').onclick = () => skillerr.invoke('trails-tidy');
$('back').onclick = () => skillerr.send('back');
$('forward').onclick = () => skillerr.send('forward');
$('reload').onclick = () => skillerr.send(currentTab && currentTab.loading ? 'stop-loading' : 'reload');

// ================= fleet view: live tabs side by side =================
// Main lays the tab views out in a grid; this draws each tile's label and frame underneath.

let tiles = null;
let tabList = [];
skillerr.on('mosaic', (t) => {
  tiles = t;
  document.body.classList.toggle('mosaic', !!t);
  const layer = $('mosaic');
  layer.innerHTML = '';
  if (!t) return;
  for (const tile of t) {
    const el = h('div', 'tile');
    el.dataset.id = tile.id;
    Object.assign(el.style, { left: tile.x + 'px', top: tile.y + 'px', width: tile.width + 'px', height: tile.height + 'px' });
    el.innerHTML = `<button class="tile-label" type="button" title="Focus this tab"><span class="fav"></span><span class="title"></span><span class="state"></span></button><div class="tile-frame"></div>`;
    el.querySelector('.tile-label').onclick = () => skillerr.send('switch-tab', tile.id);
    layer.appendChild(el);
  }
  renderMosaicLabels(tabList);
});

function renderMosaicLabels(list) {
  tabList = list;
  if (!tiles) return;
  for (const el of $('mosaic').children) {
    const t = list.find((x) => x.id === +el.dataset.id);
    if (!t) continue;
    el.classList.toggle('ai', t.ai);
    el.classList.toggle('loading', t.loading);
    el.querySelector('.fav').innerHTML = t.favicon ? `<img src="${esc(t.favicon)}">` : icon('globe', 12);
    const img = el.querySelector('.fav img');
    if (img) img.onerror = () => (img.outerHTML = icon('globe', 12));
    el.querySelector('.title').textContent = t.title;
    el.querySelector('.state').textContent = t.ai ? 'AI working' : t.loading ? 'Loading…' : '';
  }
}

// ================= research in progress (start page) =================
function renderGroupsOnStart(list) {
  const box = $('liveGroups');
  const byId = new Map();
  for (const t of list) if (t.group) (byId.get(t.group.id) || byId.set(t.group.id, { g: t.group, tabs: [] }).get(t.group.id)).tabs.push(t);
  $('liveGroupsLabel').hidden = !byId.size;
  box.innerHTML = '';
  for (const { g, tabs: ts } of byId.values()) {
    const live = ts.some((t) => t.ai);
    const card = h('div', 'lg-card' + (live ? ' live' : ''));
    card.style.setProperty('--g', g.color);
    const by = g.controller && g.controller !== g.title ? `${esc(g.controller)} · ` : '';
    card.innerHTML = `<div class="lg-head"><span class="lg-ic">${brandIcon(g.controller, 16) || '<span class="gdot"></span>'}</span>
      <div class="lg-meta"><div class="lg-title">${esc(g.title)}</div><div class="lg-sub">${by}${ts.length} tab${ts.length === 1 ? '' : 's'}</div></div>
      <span class="lg-state${live ? ' on' : ''}">${live ? '<span class="orb live"></span>Researching' : 'Idle'}</span></div>
      <div class="lg-tabs">${ts.slice(0, 4).map((t) => `<span title="${esc(t.title)}">${esc(t.title)}</span>`).join('')}${ts.length > 4 ? `<span class="more">+${ts.length - 4}</span>` : ''}</div>`;
    const acts = h('div', 'imp-row');
    acts.append(btn(`${icon('layers', 12)}Show all`, 'ghost', () => skillerr.send('group-show', g.id)),
      btn(`${icon('x', 12)}Close all`, 'ghost', () => skillerr.send('group-close', g.id)));
    card.appendChild(acts);
    box.appendChild(card);
  }
}

// ================= trails: pick up where you left off (start page) =================
const UNFINISHED = {
  form: () => 'Form not sent',
  read: (u) => `Read ${u.pct || 0}%`,
  cart: () => 'In your cart',
  watch: (u) => `Watched ${u.pct || 0}%`,
};
function agoText(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} h ago`;
  const d = Math.round(hr / 24);
  return d === 1 ? 'yesterday' : d < 7 ? `${d} days ago` : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
const favStack = (icons) => icons.length
  ? icons.slice(0, 3).map((f) => `<img src="${esc(f)}">`).join('')
  : icon('layers', 15);

// One trail as a card: title, where you stopped, what's unfinished, and Continue.
function trailCard(t, { onChange } = {}) {
  const card = h('div', 'trail-card');
  const badges = [
    ...t.unfinished.slice(0, 2).map((u) => `<span class="tb warn" title="${esc(u.title)}">${esc((UNFINISHED[u.kind] || (() => u.kind))(u))}</span>`),
    t.tucked ? `<span class="tb">${t.tucked} tab${t.tucked === 1 ? '' : 's'} tucked</span>` : '',
    t.sessions > 1 ? `<span class="tb">Back ${t.sessions} times</span>` : '',
    t.seeded ? '<span class="tb">From Chrome</span>' : '',
  ].filter(Boolean).join('');
  const stop = t.stoppedAt ? `Stopped at <b>${esc(trunc(t.stoppedAt.title, 60))}</b> · ${agoText(t.lastAt)}` : `${t.tucked} tabs · ${agoText(t.lastAt)}`;
  card.innerHTML = `<div class="tc-ic">${favStack(t.favicons)}</div>
    <div class="tc-meta"><div class="tc-title">${esc(t.title)}</div><div class="tc-sub">${stop}</div>${badges ? `<div class="tc-badges">${badges}</div>` : ''}</div>
    <div class="tc-acts"></div>`;
  // The trail as the tabs the user remembers: icon and title, like the tab strip. Click one to open just that tab.
  if (t.tabs?.length) {
    const row = h('div', 'tc-tabs');
    for (const x of t.tabs.slice(0, 5)) {
      const m = h('button', 'mini-tab' + (x.tucked ? ' tucked' : ''), `${favImg(x.favicon, 13)}<span>${esc(x.title)}</span>`);
      m.type = 'button';
      m.title = `${x.title}\n${x.url}`;
      m.onclick = (e) => {
        e.stopPropagation();
        if (x.tucked) skillerr.invoke('trails-reopen-tab', { id: t.id, url: x.url });
        else skillerr.send('open-url', x.url);
      };
      iconFallback(m, 13);
      row.appendChild(m);
    }
    const extra = (t.tucked || t.pageCount) - 5;
    if (extra > 0) row.appendChild(h('span', 'mini-more', `+${extra}`));
    card.querySelector('.tc-meta').appendChild(row);
  }
  const cont = btn(`${icon('play', 11)}Continue`, 'primary', () => skillerr.invoke('trails-continue', t.id));
  const done = btn(icon('check', 13), 'ghost icon-only', async () => {
    await skillerr.invoke('trails-state', { id: t.id, state: 'done' });
    onChange?.();
  });
  done.title = 'Done with this: move it to Done';
  card.querySelector('.tc-acts').append(cont, done);
  const ic = card.querySelector('.tc-ic');
  ic.querySelectorAll('img').forEach((img) => (img.onerror = () => {
    img.remove();
    if (!ic.querySelector('img')) ic.innerHTML = icon('layers', 15);
  }));
  return card;
}

async function renderTrailsHome() {
  const home = await skillerr.invoke('trails-home');
  const box = $('trailsHome');
  box.hidden = !home.enabled || (!home.trails.length && !home.session && !home.intro && !home.learn && !home.learned && !home.learning);
  if (box.hidden) return;
  const intro = $('trailsIntro');
  intro.hidden = !home.intro;
  if (home.intro) {
    intro.innerHTML = `<div class="ti-ic">${icon('layers', 16)}</div><div class="ti-text"><b>New: Trails.</b> Skillerr now files what you browse into threads of work,
      notices what you leave unfinished, and tucks away tabs you haven't used for half a day, so the tabs you're working in stay in reach.
      It all stays on this computer.</div>`;
    const acts = h('div', 'ti-acts');
    acts.append(btn('Got it', 'primary', async () => {
      await saveSettings({ trailsIntroSeen: true });
      renderTrailsHome();
    }), btn('Turn off', 'ghost', async () => {
      await saveSettings({ trailsIntroSeen: true, trails: false });
      renderTrailsHome();
    }));
    intro.appendChild(acts);
  }
  renderWenloLine($('wenloLine'), home.wenlo);
  renderLearnCard(home);
  const row = $('sessionRow');
  row.hidden = !home.session;
  if (home.session) {
    const { tabs: n, trails: k } = home.session;
    row.innerHTML = `<span class="sr-ic">${icon('reload', 14)}</span><span class="sr-text">You had <b>${n} tab${n === 1 ? '' : 's'}</b> open${k > 1 ? ` across ${k} trails` : ''} when Skillerr closed.</span>`;
    const x = btn(icon('x', 12), 'ghost icon-only', async () => {
      await skillerr.invoke('trails-dismiss-session');
      renderTrailsHome();
    });
    x.title = 'Dismiss. They stay in their trails.';
    row.append(btn('Reopen all', 'primary', () => skillerr.invoke('trails-restore-session')), x);
  }
  const cards = $('trailCards');
  cards.innerHTML = '';
  for (const t of home.trails) cards.appendChild(trailCard(t, { onChange: renderTrailsHome }));
  $('allTrails').textContent = home.total > home.trails.length ? `All ${home.total} trails` : 'All trails';
  box.querySelector('.section-row').hidden = !home.trails.length;
}
// Wenlo's line: one or two sentences built from a trail's facts, with Continue.
function renderWenloLine(box, line) {
  box.hidden = !line;
  if (!line) return;
  box.innerHTML = `<span class="orb xs"></span><span class="sl-text"><b>Wenlo</b> ${esc(line.text)}</span>`;
  const go = btn('Continue', 'ghost', () => skillerr.invoke('trails-continue', line.trailId));
  box.appendChild(go);
}
// ----- Wenlo learning from the user's trails -----
function learnResultText(r) {
  if (!r) return '';
  if (r.error) return 'Wenlo couldn\'t learn this time. It will try again later.';
  const rep = r.report || {};
  if (r.accepted) {
    const pct = (x) => Math.round((x || 0) * 100);
    return `Wenlo learned your words from ${rep.items} pages and searches in ${rep.trails} trails. It now files your pages right ${pct(rep.after)}% of the time, up from ${pct(rep.before)}%.`;
  }
  if (rep.reason === 'not-enough') return 'Not enough browsing yet for Wenlo to learn from. It will offer again later.';
  return 'Wenlo checked your latest browsing: it already files your pages well, so nothing changed.';
}
let learnProgress = null;
function renderLearnCard(home) {
  const card = $('learnCard');
  const show = home.learning || learnProgress != null || home.learn || home.learned;
  card.hidden = !show;
  if (!show) return;
  card.innerHTML = '';
  const ic = h('div', 'ti-ic', icon('sparkle', 16));
  const text = h('div', 'ti-text');
  const acts = h('div', 'ti-acts');
  card.append(ic, text, acts);
  if (home.learning || learnProgress != null) {
    text.innerHTML = `<b>Wenlo is learning your words…</b><div class="learn-bar"><i style="width:${Math.round((learnProgress || 0) * 100)}%"></i></div>`;
    return;
  }
  if (home.learned) {
    text.innerHTML = `<b>Wenlo learned.</b> ${esc(learnResultText(home.learned))}`;
    acts.append(btn('OK', 'ghost', async () => {
      await skillerr.invoke('wenlo-learned-seen');
      renderTrailsHome();
    }));
    return;
  }
  text.innerHTML = `<b>Wenlo can learn from your browsing.</b> ${home.learn.newPages} new pages since last time. It learns your own words (the places, products and jargon you look up) so new pages join the right trail. A few seconds, on this computer.`;
  acts.append(
    btn('Learn now', 'primary', () => skillerr.invoke('wenlo-learn')),
    btn('Always, automatically', 'ghost', async () => {
      await saveSettings({ wenloLearn: 'auto' });
      skillerr.invoke('wenlo-learn');
    }),
    btn('Not now', 'ghost', async () => {
      await skillerr.invoke('wenlo-learn-snooze');
      renderTrailsHome();
    }),
  );
}
skillerr.on('wenlo-learning', ({ progress }) => {
  const first = learnProgress == null;
  learnProgress = progress;
  const bar = document.querySelector('#learnCard .learn-bar i');
  if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
  else if (first && !$('start').hidden) renderTrailsHome();
  window.trailsView?.learning?.(progress);
});
skillerr.on('wenlo-learned', (r) => {
  learnProgress = null;
  if (!$('start').hidden) renderTrailsHome();
  window.trailsView?.learned?.(r);
});
$('allTrails').onclick = () => skillerr.send('open-trails');
$('manageTrails').onclick = (e) => {
  e.preventDefault();
  closeSheets();
  skillerr.send('open-trails');
};
skillerr.on('trails-changed', () => {
  if (!$('start').hidden) renderTrailsHome();
  window.trailsView?.refresh();
});

// "Tucked 12 tabs into 4 trails": in the toolbar, where it can be seen over any page. Undo brings them all back.
skillerr.on('trails-tucked', ({ count, trails: k, dupes = 0, auto }) => {
  const chip = $('trailsChip');
  chip.hidden = false;
  const parts = [];
  if (count) parts.push(`${auto ? 'Tucked away' : 'Tucked'} ${count} tab${count === 1 ? '' : 's'} into ${k} trail${k === 1 ? '' : 's'}`);
  if (dupes) parts.push(`closed ${dupes} duplicate${dupes === 1 ? '' : 's'}`);
  const text = parts.join(', ');
  chip.innerHTML = `${icon('layers', 12)}<span>${text[0].toUpperCase() + text.slice(1)}</span>`;
  chip.append(btn('Undo', 'ghost', () => {
    skillerr.invoke('trails-undo-tuck');
    chip.hidden = true;
  }), btn('See trails', 'ghost', () => {
    skillerr.send('open-trails');
    chip.hidden = true;
  }));
  clearTimeout(chip.timer);
  chip.timer = setTimeout(() => (chip.hidden = true), 15000);
});

// ================= intent-aware inputs (address bar + start page) =================

function intentInput({ input, badge, form, hint, idleIcon, onValue, idleWhenBlurred, emptyHint }) {
  let manual = null;
  const current = () => (input.value.trim() && !(idleWhenBlurred && document.activeElement !== input) ? manual || detectIntent(input.value) : null);
  const options = () => (looksLikeUrl(input.value.trim()) ? ['go', 'search', 'ask'] : ['search', 'ask']);

  function render() {
    const it = current();
    badge.className = 'intent ' + (it || 'idle');
    badge.innerHTML = it ? `${icon(INTENTS[it].icon, 12)}${INTENTS[it].label}` : icon(idleIcon(), 14);
    form.classList.toggle('ask', it === 'ask');
    if (hint) {
      const focused = document.activeElement === input;
      const next = options().filter((o) => o !== it)[0];
      hint.innerHTML = !it ? (emptyHint || '') : !focused ? '' :
        `<kbd>↵</kbd> ${INTENTS[it].label}${next ? ` · <kbd>Tab</kbd> ${INTENTS[next].label} instead` : ''}`;
    }
  }
  function cycle() {
    const opts = options();
    const i = opts.indexOf(current());
    manual = opts[(i + 1) % opts.length];
    render();
  }
  input.addEventListener('input', () => {
    manual = null;
    render();
  });
  input.addEventListener('focus', render);
  input.addEventListener('blur', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && input.value.trim()) {
      e.preventDefault();
      cycle();
    }
  });
  badge.addEventListener('mousedown', (e) => e.preventDefault());
  badge.addEventListener('click', () => (input.value.trim() ? cycle() : input.focus()));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const it = current();
    if (!it) return;
    onValue(it, input.value.trim());
    manual = null;
    input.value = '';
    render();
    input.blur();
  });
  render();
  return { render, clearManual: () => (manual = null) };
}

// ================= find anything by meaning =================
// Typing in the address bar (or the start page's box) shows matching tabs, tucked tabs and trail pages, by words and by
// Wenlo's sense of meaning. ↑/↓ choose, ↵ opens the chosen one (or does what the bar would do if none is chosen).
const jump = { input: null, items: [], sel: -1, seq: 0 };
const JUMP_KIND = { tab: 'Open tab', tucked: 'Tucked away', page: 'Visited' };
function jumpHide() {
  $('jump').hidden = true;
  $('jump').innerHTML = '';
  jump.items = [];
  jump.sel = -1;
  skillerr.send('chrome-on-top', false);
}
function jumpRender() {
  const box = $('jump');
  if (!jump.items.length || !jump.input || document.activeElement !== jump.input) return jumpHide();
  const r = (jump.input.closest('form') || jump.input).getBoundingClientRect();
  Object.assign(box.style, { left: `${r.left}px`, top: `${r.bottom + 6}px`, width: `${r.width}px` });
  box.innerHTML = `<div class="jump-head">${icon('sparkle', 11)} Wenlo found</div>`;
  jump.items.forEach((c, i) => {
    const el = h('button', 'jump-item' + (i === jump.sel ? ' on' : ''));
    el.type = 'button';
    const fav = c.favicon ? `<img src="${esc(c.favicon)}" width="16" height="16">` : icon('globe', 15);
    let host = '';
    try {
      host = new URL(c.url).hostname.replace(/^www\./, '');
    } catch {}
    el.innerHTML = `<span class="ji-fav">${fav}</span><span class="ji-text"><b>${esc(c.title || c.url)}</b><span>${esc(host)}${c.trail ? ` · ${esc(c.trail)}` : ''}${c.why === 'meaning' ? ' · similar in meaning' : ''}</span></span><span class="ji-kind k-${c.kind}">${JUMP_KIND[c.kind]}</span>`;
    el.querySelectorAll('img').forEach((img) => (img.onerror = () => (img.outerHTML = icon('globe', 15))));
    el.onmousedown = (e) => e.preventDefault(); // keep focus in the input
    el.onclick = () => jumpChoose(i);
    box.appendChild(el);
  });
  box.hidden = false;
  if (jump.input === $('url')) skillerr.send('chrome-on-top', true); // over the page, or it would be hidden behind it
}
function jumpChoose(i) {
  const c = jump.items[i];
  if (!c) return;
  const input = jump.input;
  jumpHide();
  skillerr.send('jump-open', c);
  input.value = '';
  input.dispatchEvent(new Event('input'));
  input.blur();
}
function wireJump(input) {
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    // An address being typed or edited is navigation, not a search of what the user remembers.
    if (q.length < 2 || settings.trails === false || looksLikeUrl(q) || /^[a-z]+:\/\//i.test(q)) return jumpHide();
    timer = setTimeout(async () => {
      const seq = ++jump.seq;
      const items = await skillerr.invoke('jump-search', q);
      if (seq !== jump.seq || input.value.trim() !== q) return;
      jump.input = input;
      jump.items = items;
      jump.sel = -1;
      jumpRender();
    }, 60);
  });
  // Capture phase: before the bar's own Tab/Enter handling.
  input.addEventListener('keydown', (e) => {
    if ($('jump').hidden || jump.input !== input) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = jump.items.length;
      jump.sel = e.key === 'ArrowDown' ? (jump.sel + 1) % n : (jump.sel - 1 + n) % n;
      jumpRender();
    } else if (e.key === 'Enter' && jump.sel >= 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      jumpChoose(jump.sel);
    } else if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      jumpHide();
    }
  }, true);
  input.addEventListener('blur', () => setTimeout(() => document.activeElement !== input && jump.input === input && jumpHide(), 120));
}
wireJump($('url'));
wireJump($('hero'));
window.addEventListener('resize', () => !$('jump').hidden && jumpRender());

function go(intent, value) {
  if (intent === 'ask') startTask(value);
  else skillerr.send('navigate', value);
}

const omniCtl = intentInput({
  input: $('url'),
  badge: $('intent'),
  form: $('omni'),
  hint: $('omniHint'),
  idleWhenBlurred: true,
  idleIcon: () => (currentTab && !currentTab.isStart ? 'globe' : 'search'),
  onValue: go,
});
// Unfocused, the bar reads like a place: the site's name, then the rest of the address, dimmed.
function prettyUrl() {
  const u = currentTab && !currentTab.isStart ? currentTab.url : '';
  let host = '', rest = '';
  try {
    const p = new URL(u);
    if (/^https?:$/.test(p.protocol)) {
      host = p.hostname.replace(/^www\./, '');
      rest = (p.pathname === '/' ? '' : p.pathname) + p.search;
      try { rest = decodeURI(rest); } catch {} // show ’Ship's_wheel’, not ’Ship%27s_wheel’
    }
  } catch {}
  const on = !!host && document.activeElement !== $('url');
  $('omni').classList.toggle('pretty', on);
  if (on) {
    $('urlShow').querySelector('b').textContent = host;
    $('urlShow').querySelector('span').textContent = rest;
  }
}
const omni = {
  reset() {
    $('url').value = currentTab && !currentTab.isStart ? currentTab.url : '';
    omniCtl.clearManual();
    omniCtl.render();
    prettyUrl();
  },
};
$('urlShow').addEventListener('mousedown', (e) => {
  e.preventDefault();
  $('url').focus();
});
$('url').addEventListener('focus', () => {
  $('omni').classList.remove('pretty');
  omniCtl.render();
  setTimeout(() => $('url').select(), 0);
});
$('url').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    omni.reset();
    $('url').blur();
  }
});
// Show intent badges only while typing; the unfocused bar shows the page URL.
$('url').addEventListener('blur', () => setTimeout(() => document.activeElement !== $('url') && omni.reset(), 0));
skillerr.on('focus-url', () => $('url').focus());

intentInput({ input: $('hero'), badge: $('heroIntent'), form: $('heroForm'), hint: $('heroHint'), idleIcon: () => 'sparkle', onValue: go,
  emptyHint: 'Type an address, a search, or something for Skillerr to do' });

// ================= start page =================

function greet() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Up late? What should we do?' : hr < 12 ? 'Good morning. What should we do?' : hr < 18 ? 'Good afternoon. What should we do?' : 'Good evening. What should we do?';
}
$('greeting').textContent = greet();
$('ideas').innerHTML = '';
IDEAS.forEach((text, i) => {
  const b = h('button', 'idea', `${icon('sparkle', 13)}${esc(text)}`);
  b.type = 'button';
  b.style.animationDelay = `${i * 60}ms`;
  b.onclick = () => startTask(text);
  $('ideas').appendChild(b);
});

async function renderAiCards() {
  const [targets, ready, local] = await Promise.all([skillerr.invoke('connect-targets'), skillerr.invoke('agent-ready'), skillerr.invoke('detect-local')]);
  const grid = $('aiGrid');
  grid.innerHTML = '';

  // Built-in agent card
  const builtin = h('div', 'ai-card');
  let sub;
  let action = '';
  // Pro settings saved before launch (testing) don't count: the card offers a local model or an API key instead.
  const proLocked = !PRO_OPEN && (settings.baseUrl === PRO_GATEWAY || settings.baseUrl === PRO_API);
  const configured = !proLocked && (settings.provider === 'anthropic' ? !!settings.apiKey : !!(settings.baseUrl && settings.model));
  if (ready) sub = `<div class="sub ok">Ready · ${esc(agentName())}</div>`;
  else if (proLocked && !local.length) {
    sub = '<div class="sub">Skillerr Pro: coming soon</div>';
    action = '<button class="btn ghost sm" data-act="setup">Set up</button>';
  }
  else if (configured && settings.builtinOff) {
    sub = `<div class="sub">Off · ${esc(agentName())}</div>`;
  } else if (local.length) {
    sub = `<div class="sub">${esc(local[0].source)} found — free & private</div>`;
    action = '<button class="btn primary sm" data-act="use-local">Use it</button>';
  } else {
    sub = '<div class="sub">Local model or API key</div>';
    action = '<button class="btn ghost sm" data-act="setup">Set up</button>';
  }
  if (configured) action = aiSwitch(ready, 'Turn the built-in AI on or off');
  builtin.innerHTML = `<div class="ic ${ready ? 'on' : ''}">${icon('sparkle', 18)}</div><div class="meta"><div class="name">Built-in AI</div>${sub}</div>${action}`;
  builtin.querySelector('.ai-switch input')?.addEventListener('change', async (e) => {
    await saveSettings({ builtinOff: !e.target.checked });
    renderAiCards();
    renderModelPill?.();
  });
  builtin.querySelector('[data-act=use-local]')?.addEventListener('click', async () => {
    await saveSettings({ pane: 'local', provider: 'openai-compatible', baseUrl: local[0].baseUrl, model: local[0].model, apiKey: '', localModel: local[0].model, localBaseUrl: local[0].baseUrl });
    renderAiCards();
  });
  builtin.querySelector('[data-act=setup]')?.addEventListener('click', () => openSheet('settings'));
  grid.appendChild(builtin);

  for (const t of targets) grid.appendChild(connCard(t, 'ai-card'));
  grid.querySelectorAll('.ai-card').forEach((c, i) => (c.style.animationDelay = `${i * 60}ms`));
}

// Connections left by an earlier install were removed (Skillerr's data was fresh): say so, and show the cards as they are now.
skillerr.on('connections-reset', (names) => {
  const note = $('aiNote');
  note.hidden = false;
  note.textContent = `Removed old connections from an earlier install of Skillerr (${names.join(', ')}). Connect the apps you want below.`;
  renderAiCards();
});

// A small on/off switch for the start page's AI cards.
function aiSwitch(on, title) {
  return `<label class="ai-switch" title="${esc(title)}"><input type="checkbox" ${on ? 'checked' : ''} /><span class="switch"></span></label>`;
}

function connCard(t, cls) {
  const card = h('div', cls);
  const state = t.connected ? '<div class="sub ok">Connected</div>' : t.stale ? '<div class="sub err">Connection points to an old copy of Skillerr</div>'
    : t.detected ? '<div class="sub">Installed · not connected</div>' : '<div class="sub">Not installed</div>';
  let action = '';
  // On the start page, a connected (or connectable) app gets an on/off switch: off disconnects it.
  if (cls === 'ai-card' && (t.connected || (t.detected && !t.stale))) action = aiSwitch(t.connected, t.connected ? `Disconnect ${t.name} from Skillerr` : `Connect ${t.name} to Skillerr`);
  else if (!t.connected && t.detected) action = `<button class="btn primary sm" data-act="connect">${t.stale ? 'Reconnect' : 'Connect'}</button>`;
  else if (!t.detected && t.id === 'claude-desktop') action = '<button class="btn ghost sm" data-act="get">Get it</button>';
  card.innerHTML = `<div class="ic ${t.connected ? 'on' : ''}">${brandIcon(t.id, 18) || icon(CONN_ICONS[t.id] || 'plug', 17)}</div><div class="meta"><div class="name">${esc(t.name)}</div>${state}</div>${action}`;
  card.querySelector('[data-act=get]')?.addEventListener('click', () => skillerr.send('open-url', 'https://claude.ai/download'));
  card.querySelector('.ai-switch input')?.addEventListener('change', async (e) => {
    const on = e.target.checked;
    e.target.disabled = true;
    const r = await skillerr.invoke(on ? 'connect' : 'disconnect', t.id);
    const subEl = card.querySelector('.sub');
    subEl.className = 'sub ' + (r.ok ? (on ? 'ok' : '') : 'err');
    subEl.textContent = r.ok ? (on ? 'Connected' : 'Disconnected') : r.message;
    subEl.title = r.message || '';
    card.querySelector('.ic').classList.toggle('on', r.ok ? on : !on);
    if (!r.ok) e.target.checked = !on;
    e.target.disabled = false;
  });
  card.querySelector('[data-act=connect]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    const r = await skillerr.invoke('connect', t.id);
    const subEl = card.querySelector('.sub');
    subEl.className = 'sub ' + (r.ok ? 'ok' : 'err');
    subEl.textContent = r.message;
    subEl.title = r.message;
    btn.outerHTML = r.ok ? `<span class="btn done sm">${icon('check', 14)}</span>` : '';
    if (r.ok) card.querySelector('.ic').classList.add('on');
    // Claude Desktop only reads its connections at start: offer to restart it right here.
    if (r.ok && t.id === 'claude-desktop') {
      const rs = h('button', 'btn primary sm', 'Restart Claude Desktop');
      rs.type = 'button';
      rs.onclick = async () => {
        rs.disabled = true;
        rs.textContent = 'Restarting…';
        const x = await skillerr.invoke('restart-claude-desktop');
        subEl.className = 'sub ' + (x.ok ? 'ok' : 'err');
        subEl.textContent = x.message;
        rs.remove();
      };
      card.appendChild(rs);
    }
  });
  return card;
}

// ================= presence (who is driving) =================

skillerr.on('status', (s) => {
  status = s;
  const driving = s.active && !s.paused;
  document.body.classList.toggle('driving', driving);
  document.body.classList.toggle('paused', s.paused);
  $('orb').className = 'orb' + (s.paused ? ' paused' : driving ? ' live' : '');
  $('miniOrb').className = 'orb xs' + (s.paused ? ' paused' : driving ? ' live' : '');
  $('whoName').innerHTML = s.paused ? 'AI paused' : s.controller ? `${brandIcon(s.controller.name, 15)}${esc(s.controller.name)}` : 'Skillerr Pilot';
  $('whoSub').className = 'who-sub' + (s.paused ? ' paused' : driving ? ' live' : '');
  $('whoSub').textContent = s.paused ? 'You have control' : driving ? 'Driving now' : s.controller ? (s.controller.via === 'builtin' ? 'Idle' : 'Idle · connected') : 'Ready when you are';
  const pb = $('pauseBtn');
  pb.className = 'pause-btn' + (s.paused ? ' paused' : driving ? ' live' : '');
  pb.hidden = !s.controller && !s.paused; // nothing to pause until an AI has connected
  // Human mode: with AI paused, this is just your browser. Say so plainly.
  document.body.classList.toggle('human-mode', !!s.paused);
  $('humanPill').hidden = !s.paused;
  pb.innerHTML = s.paused ? `${icon('play', 12)}Resume` : `${icon('pause', 12)}Pause`;
  pb.title = s.paused ? 'Let AI act again  ⇧⌘P' : 'Stop all AI instantly  ⇧⌘P';
  if (!driving) for (const g of document.querySelectorAll('.group.session.live')) endSession(g);
  renderRecPill(s.recording);
});
$('pauseBtn').onclick = () => skillerr.send('pause', !status.paused);
$('humanPill').onclick = () => skillerr.send('pause', false);

// ================= timeline =================

const timeline = $('timeline');
const stepEls = new Map();
let task = null; // the built-in agent task in progress
let session = null; // the external AI session in progress
let undoTop = null;

function place(el) {
  $('welcome')?.remove();
  const nearBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 80;
  timeline.appendChild(el);
  if (nearBottom) timeline.scrollTop = timeline.scrollHeight;
}
const keepScrolled = () => {
  if (timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 160) timeline.scrollTop = timeline.scrollHeight;
};

function newTaskGroup(text) {
  const g = h('div', 'group task live');
  g.innerHTML = `<div class="ask-bubble"></div><div class="steps"></div><div class="g-foot working"><span class="dot"></span><span class="ft">Starting…</span></div>`;
  g.querySelector('.ask-bubble').textContent = text;
  place(g);
  task = { el: g, steps: g.querySelector('.steps'), foot: g.querySelector('.g-foot'), started: Date.now(), count: 0, says: [] };
  task.timer = setInterval(() => {
    if (task) task.foot.querySelector('.ft').textContent = `Working · ${Math.round((Date.now() - task.started) / 1000)}s`;
  }, 1000);
}

function finishTask(kind, text) {
  if (!task) return;
  clearInterval(task.timer);
  const secs = Math.round((Date.now() - task.started) / 1000);
  const f = task.foot;
  const forget = f.querySelector('.forget'); // survives the footer being rewritten below
  f.className = 'g-foot ' + kind;
  if (kind === 'ok') {
    task.says[task.says.length - 1]?.classList.add('answer');
    f.innerHTML = `<span class="dot"></span>Done in ${secs}s · ${task.count} step${task.count === 1 ? '' : 's'}`;
  } else if (kind === 'error') {
    f.innerHTML = `<span class="dot"></span><span>${esc(text)}</span>`;
    if (/settings|api key|base url|model name/i.test(text)) {
      const b = h('button', 'btn primary sm', 'Set up AI');
      b.type = 'button';
      b.onclick = () => openSheet('settings');
      f.appendChild(b);
    }
  } else f.innerHTML = '<span class="dot"></span>Stopped by you';
  if (forget) f.appendChild(forget);
  task.el.classList.remove('live');
  task = null;
}

function sessionFor(e) {
  if (session && session.controller === e.controller && document.body.contains(session.el)) return session;
  // same AI back after a pause, nothing else in between: continue its card instead of stacking a new one
  const last = timeline.lastElementChild;
  if (last?.classList.contains('session') && last.dataset.controller === e.controller) {
    last.classList.add('live');
    last.querySelector('.g-head .orb')?.classList.add('live');
    last.querySelector('.verb').textContent = 'is driving';
    const steps = last.querySelector('.steps');
    session = { controller: e.controller, el: last, steps, foot: last.querySelector('.ft'), count: steps.children.length };
    return session;
  }
  const g = h('div', 'group session live');
  g.dataset.controller = e.controller;
  g.innerHTML = `<div class="g-head"><span class="orb live"></span>${brandIcon(e.controller, 14)}<span><b>${esc(e.controller)}</b> <span class="verb">is driving</span></span></div><div class="steps"></div><div class="g-foot"><span class="dot"></span><span class="ft"></span></div>`;
  place(g);
  session = { controller: e.controller, el: g, steps: g.querySelector('.steps'), foot: g.querySelector('.ft'), count: 0 };
  return session;
}

function endSession(g) {
  g.classList.remove('live');
  g.querySelector('.g-head .orb')?.classList.remove('live');
  const v = g.querySelector('.verb');
  if (v) v.textContent = 'drove Skillerr';
  if (session && session.el === g) session = null;
}

// A connected AI talking to the user (the `say` tool): goes in its session card.
skillerr.on('say', (e) => {
  const owner = e.via === 'builtin' && task ? task : sessionFor(e);
  owner.steps.appendChild(h('div', 'say answer', markdown(e.text)));
  keepScrolled();
});

const QUIET = new Set(['snapshot', 'read_page', 'wait']); // repeated look/read steps collapse into one row

skillerr.on('log', (e) => {
  let el = stepEls.get(e.id);
  if (!el) {
    const owner = e.via === 'builtin' && task ? task : sessionFor(e);
    const prev = owner.steps.lastElementChild;
    if (QUIET.has(e.tool) && prev && prev.dataset.tool === e.tool && prev.dataset.tab === String(e.args?.tab_id ?? '') && prev.classList.contains('ok')) {
      prev.dataset.repeat = String((+prev.dataset.repeat || 1) + 1);
      stepEls.set(e.id, prev);
      renderStep(prev, e);
      return;
    }
    el = h('div', 'step');
    owner.steps.appendChild(el);
    owner.count++;
    if (owner.foot && owner === session) owner.foot.textContent = `${owner.count} action${owner.count === 1 ? '' : 's'}`;
    stepEls.set(e.id, el);
  }
  renderStep(el, e);
  keepScrolled();
});

function renderStep(el, e) {
  const d = describeStep(e);
  const tag = e.args && e.args.tab_id != null ? `<span class="tabtag">Tab ${esc(e.args.tab_id)}</span>` : '';
  el.className = 'step ' + e.state + (undoTop === e.id ? ' can-undo' : '');
  el.dataset.id = e.id;
  el.dataset.tool = e.tool;
  el.dataset.tab = String(e.args?.tab_id ?? '');
  const times = +el.dataset.repeat > 1 ? ` <span class="times">×${el.dataset.repeat}</span>` : '';
  const trailing = e.state === 'ok' ? `<button class="undo" type="button">Undo</button><span class="st">${icon('check', 13)}</span>`
    : e.state === 'error' ? `<span class="st">${icon('x', 13)}</span>` : e.state === 'running' ? '<span class="st"></span>' : '';
  let body = `<div class="main">${tag}${esc(d.text)}${times}</div>`;
  if (e.state === 'approval') {
    body = `<div class="main"><b>Needs your OK:</b> ${tag}${esc(d.text)}</div><div class="why">${esc(e.reason || 'You asked Skillerr to check before every action.')}</div>`;
  }
  if (e.state === 'error' && e.summary) body += `<div class="err">${esc(trunc(e.summary, 200))}</div>`;
  el.innerHTML = `<div class="ic">${icon(e.state === 'approval' ? 'hand' : d.icon, 13)}</div><div class="txt">${body}</div>${trailing}`;
  if (e.state === 'approval') {
    const row = h('div', 'approve-row', '<button type="button" class="btn ghost sm deny">Deny</button><button type="button" class="btn sm allow">Allow</button>');
    row.querySelector('.allow').onclick = () => skillerr.send('approval', { id: e.id, ok: true });
    row.querySelector('.deny').onclick = () => skillerr.send('approval', { id: e.id, ok: false });
    el.appendChild(row);
    skillerr.send('toggle-panel', true);
    el.scrollIntoView({ block: 'nearest' });
  }
  el.querySelector('.undo')?.addEventListener('click', () => skillerr.send('undo', e.id));
}

skillerr.on('undo-top', (id) => {
  undoTop = id;
  document.querySelectorAll('.step.can-undo').forEach((s) => s.classList.remove('can-undo'));
  if (id != null) stepEls.get(id)?.classList.add('can-undo');
});
skillerr.on('log-undone', ({ id, error }) => {
  const el = stepEls.get(id);
  if (!el) return;
  el.classList.remove('can-undo');
  if (error) {
    el.querySelector('.txt').insertAdjacentHTML('beforeend', `<div class="err">${esc(error)}</div>`);
    return;
  }
  el.classList.add('undone');
  el.querySelector('.undo')?.remove();
  const st = el.querySelector('.st');
  if (st) st.innerHTML = icon('reload', 12);
});

// ================= built-in agent =================

async function startTask(text) {
  if (!text) return;
  skillerr.send('toggle-panel', true);
  if (agentRunning) return flash('Skillerr is still working on the last task — stop it first.');
  if (!(await skillerr.invoke('agent-ready'))) {
    // No built-in AI yet: most people drive Skillerr from Claude Desktop, Claude Code or Cursor. Hand them the task.
    skillerr.send('copy', `Use Skillerr to ${text.charAt(0).toLowerCase()}${text.slice(1)}`);
    flash('Copied. Paste it into Claude Desktop, Claude Code or Cursor: it will do it here, where you can watch. (Or pick a built-in AI in Settings to run it right here.)', 8000);
    return;
  }
  newTaskGroup(text);
  setRunning(true);
  skillerr.send('agent-run', text);
}

function flash(text, ms = 4000) {
  const s = h('div', 'say', esc(text));
  place(s);
  setTimeout(() => s.remove(), ms);
}

function setRunning(on) {
  agentRunning = on;
  $('send').className = 'send' + (on ? ' stop' : '');
  $('send').innerHTML = on ? icon('stop', 14) : icon('arrowUp', 16);
  $('send').title = on ? 'Stop  Esc' : 'Run  ↵';
  renderChips();
}

skillerr.on('agent', (ev) => {
  if (ev.type === 'text') {
    if (!task) return;
    const s = h('div', 'say', markdown(ev.text));
    task.steps.appendChild(s);
    task.says.push(s);
    keepScrolled();
  } else if (ev.type === 'done') {
    finishTask('ok');
    setRunning(false);
  } else if (ev.type === 'error') {
    if (task) finishTask('error', ev.text);
    else flash(ev.text);
    setRunning(false);
  } else if (ev.type === 'stopped') {
    finishTask('stopped');
    setRunning(false);
  }
});

// ================= composer =================

const taskInput = $('task');
function autosize() {
  taskInput.style.height = 'auto';
  taskInput.style.height = Math.min(taskInput.scrollHeight, 160) + 'px';
}
taskInput.addEventListener('input', () => {
  autosize();
  renderChips();
  renderSlash();
  renderComposerContext();
});
taskInput.addEventListener('keydown', (e) => {
  if (slashKey(e)) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('composer').requestSubmit();
  } else if (e.key === 'Escape' && agentRunning) skillerr.send('agent-stop');
});
$('composer').onsubmit = (e) => {
  e.preventDefault();
  if (agentRunning) return skillerr.send('agent-stop');
  const text = taskInput.value.trim();
  if (!text) return;
  taskInput.value = '';
  autosize();
  startTask(text);
};
skillerr.on('focus-composer', () => taskInput.focus());

function renderChips() {
  const box = $('chips');
  box.innerHTML = '';
  if (agentRunning || taskInput.value.trim() || !currentTab) return;
  if (currentTab.isStart) return; // the start page already shows ideas
  const list = PAGE_CHIPS;
  list.forEach((text, i) => {
    const c = h('button', 'chip', `${icon('sparkle', 11)}${esc(trunc(text, 42))}`);
    c.type = 'button';
    c.style.animationDelay = `${i * 50}ms`;
    c.onclick = () => startTask(text);
    box.appendChild(c);
  });
  const snap = h('button', 'chip', `${icon('camera', 11)}Show my AI this page`);
  snap.type = 'button';
  snap.style.animationDelay = `${list.length * 50}ms`;
  snap.title = 'Captures the page and copies a line to paste into your AI';
  snap.onclick = snapForAi;
  box.appendChild(snap);
  if (skillCache.some((s) => s.name === 'demo-recorder')) {
    const c = h('button', 'chip', `${icon('film', 11)}Record a demo of this page`);
    c.type = 'button';
    c.style.animationDelay = `${list.length * 50}ms`;
    c.onclick = () => startTask('/demo-recorder Record a short captioned tour of this page');
    box.appendChild(c);
  }
}

function renderComposerContext() {
  const ctx = $('ctx');
  const using = activeSkill();
  $('box').classList.toggle('with-skill', !!using);
  if (using) {
    ctx.innerHTML = `${icon(using.icon, 12)}<span>Using the <b>${esc(using.name)}</b> skill · ${esc(using.description)}</span>`;
    return;
  }
  if (!currentTab || currentTab.isStart) {
    ctx.innerHTML = `${icon('sparkle', 12)}<span>Skillerr can open sites, click, type and read for you</span>`;
  } else {
    const fav = currentTab.favicon ? `<img src="${esc(currentTab.favicon)}">` : icon('globe', 12);
    ctx.innerHTML = `${fav}<span>On this page · ${esc(currentTab.title)}</span>`;
    const img = ctx.querySelector('img');
    if (img) img.onerror = () => (img.outerHTML = icon('globe', 12));
  }
  renderChips();
}

function agentName() {
  if (settings.baseUrl === PRO_GATEWAY || settings.baseUrl === PRO_API) return `Pro · ${PRO_NAMES[settings.model] || settings.model}`;
  if (settings.provider === 'anthropic') return CLAUDE_NAMES[settings.model] || settings.model;
  return settings.model || 'Local AI';
}

async function renderModelPill() {
  const ready = await skillerr.invoke('agent-ready');
  const p = $('modelPill');
  p.className = 'model-pill ' + (ready ? 'ready' : 'setup');
  p.innerHTML = ready ? `<span class="dot"></span><span>${esc(agentName())}</span>` : `${icon('sparkle', 12)}<span>Choose an AI to power Skillerr</span>`;
}
$('modelPill').onclick = () => openSheet('settings');

// Screenshot for your AI: capture the page, copy one line, paste it into your AI and just say what's wrong.
$('snapBtn').innerHTML = icon('camera', 13);
async function snapForAi() {
  const r = await skillerr.invoke('capture-for-ai');
  showCaptured(r);
}
function showCaptured(r) {
  const b = $('snapBtn');
  if (!r.ok) {
    b.title = r.message;
    return;
  }
  b.classList.add('on');
  b.innerHTML = icon('check', 13);
  setTimeout(() => {
    b.classList.remove('on');
    b.innerHTML = icon('camera', 13);
  }, 2200);
  // The first few times, say what to do next, in one line.
  const seen = Number(localStorage.getItem('snapHints') || 0);
  if (seen < 3) {
    localStorage.setItem('snapHints', String(seen + 1));
    flash(`Copied. Paste it into Claude or any AI, then say what's wrong. It opens the screenshot itself.`, 7000);
  }
}
$('snapBtn').onclick = snapForAi;
skillerr.on('captured', (r) => showCaptured({ ok: true, ...r }));

// Deep research toggle: applies to the built-in AI and to connected AIs (they're told when it's on).
function renderDeep() {
  const on = !!settings.deepResearch;
  $('deepBtn').className = 'deep-btn' + (on ? ' on' : '');
  $('deepBtn').innerHTML = `${icon('layers', 12)}<span>Deep</span>`;
  $('deepDepth').hidden = !on;
  $('deepDepth').value = String(settings.deepDepth || 3);
}
$('deepBtn').onclick = async () => {
  await saveSettings({ deepResearch: !settings.deepResearch });
  renderDeep();
};
$('deepDepth').onchange = async () => {
  await saveSettings({ deepDepth: Number($('deepDepth').value) });
  renderDeep();
};

// ================= panel + sheets =================

skillerr.on('panel', (open) => {
  document.body.classList.toggle('panel-closed', !open);
  $('togglePanel').classList.toggle('on', open);
});
$('togglePanel').onclick = () => skillerr.send('toggle-panel');
$('closePanel').onclick = () => skillerr.send('toggle-panel', false);
$('openConnect').onclick = () => openSheet('connect');
$('openSettings').onclick = () => openSheet('settings');
$('openSkills').onclick = () => openSheet('skills');
document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeSheets));

function openSheet(name, opts = {}) {
  skillerr.send('toggle-panel', true);
  closeSheets();
  $('sheet-' + name).classList.add('open');
  if (name === 'connect') renderConnectSheet();
  if (name === 'settings') loadSettingsSheet(opts);
  if (name === 'skills') renderSkillsSheet();
}
function closeSheets() {
  document.querySelectorAll('.sheet.open').forEach((s) => s.classList.remove('open'));
}

document.addEventListener('click', (e) => {
  const sheetLink = e.target.closest('[data-sheet]');
  if (sheetLink) {
    e.preventDefault();
    openSheet(sheetLink.dataset.sheet);
  }
  const link = e.target.closest('[data-url]');
  if (link) {
    e.preventDefault();
    skillerr.send('open-url', link.dataset.url);
  }
});

async function renderConnectSheet() {
  const list = $('connList');
  const targets = await skillerr.invoke('connect-targets');
  list.innerHTML = '';
  const blocked = new Set((await skillerr.invoke('get-settings')).blockedClients || []);
  for (const t of targets) {
    const card = connCard(t, 'conn');
    if (t.connected) {
      // Turn an app off without uninstalling anything, or disconnect it for good.
      const ctl = h('div', 'conn-ctl', `<label class="mini-switch" title="Off: ${esc(t.name)} can't use Skillerr, even though it's connected">
        <input type="checkbox" ${blocked.has(t.name) ? '' : 'checked'} /><span class="switch"></span><span class="lbl">${blocked.has(t.name) ? 'Off' : 'On'}</span></label>`);
      const input = ctl.querySelector('input');
      input.onchange = async () => {
        await skillerr.invoke('set-client-blocked', { name: t.name, blocked: !input.checked });
        ctl.querySelector('.lbl').textContent = input.checked ? 'On' : 'Off';
        card.classList.toggle('off', !input.checked);
      };
      const dis = btn('Disconnect', 'ghost', async () => {
        dis.disabled = true;
        const r = await skillerr.invoke('disconnect', t.id);
        const sub = card.querySelector('.sub');
        sub.className = 'sub ' + (r.ok ? '' : 'err');
        sub.textContent = r.message;
        ctl.remove();
      });
      ctl.appendChild(dis);
      card.appendChild(ctl);
      card.classList.toggle('off', blocked.has(t.name));
    }
    list.appendChild(card);
  }
  const json = await skillerr.invoke('mcp-config');
  $('mcpJson').textContent = json;
  $('copyJson').onclick = () => {
    skillerr.send('copy', json);
    $('copyJson').textContent = 'Copied ✓';
    setTimeout(() => ($('copyJson').textContent = 'Copy config'), 1500);
  };
}

// ----- settings -----
// Skillerr Pro stays switched off until launch: no tab, no keys. (skillerr.com refuses Pro requests too.)
const PRO_OPEN = false;
if (!PRO_OPEN) {
  document.querySelector('#providerSeg [data-p="cloud"]').style.display = 'none';
  document.querySelector('.pane[data-pane="cloud"]').style.display = 'none';
}
let pane = 'local';
let localChoice = null;

function showPane(p) {
  pane = p;
  document.querySelectorAll('#providerSeg button').forEach((b) => b.classList.toggle('on', b.dataset.p === p));
  document.querySelectorAll('.pane').forEach((el) => el.classList.toggle('on', el.dataset.pane === p));
}
document.querySelectorAll('#providerSeg button').forEach((b) => (b.onclick = () => showPane(b.dataset.p)));
$('otherPreset').onchange = () => {
  const p = OTHER_PRESETS[$('otherPreset').value];
  $('otherUrl').value = p.baseUrl;
  $('otherModel').value = p.model;
};

async function loadSettingsSheet({ setup } = {}) {
  settings = await skillerr.invoke('get-settings');
  $('setupBanner').hidden = !setup;
  const s = settings;
  showPane((PRO_OPEN || s.pane !== 'cloud' ? s.pane : '') || (s.provider === 'anthropic' ? (s.apiKey ? 'claude' : 'local') : /localhost|127\.0\.0\.1/.test(s.baseUrl) ? 'local' : 'other'));
  $('claudeModel').value = s.claudeModel || (s.provider === 'anthropic' ? s.model : 'claude-opus-5') || 'claude-opus-5';
  $('claudeKey').value = s.anthropicKey || (s.provider === 'anthropic' ? s.apiKey : '') || '';
  $('otherPreset').value = s.otherPreset || 'gemini';
  $('otherUrl').value = s.otherUrl || OTHER_PRESETS[$('otherPreset').value].baseUrl;
  $('otherModel').value = s.otherModel || OTHER_PRESETS[$('otherPreset').value].model;
  $('otherKey').value = s.otherKey || '';
  $('proModel').value = s.proModel || 'anthropic/claude-sonnet-5';
  $('proKey').value = s.proKey || '';
  $('requireApproval').checked = !!s.requireApproval;
  $('remember').checked = s.remember !== false;
  $('semanticRecall').checked = s.semanticRecall !== false;
  $('shareSkills').checked = !!s.shareSkillsWithClaudeCode;
  $('sleepTabs').checked = s.sleepTabs !== false;
  $('trailsOn').checked = s.trails !== false;
  $('updateChecks').checked = s.updateChecks !== false;
  $('betaUpdates').checked = s.betaUpdates === true;
  $('searchEngine').value = s.searchEngine || 'google';
  $('searchApi').value = s.searchApi || '';
  $('searchApiKey').value = s.searchApiKey || '';
  $('searchApiKeyRow').hidden = !$('searchApi').value;
  document.querySelectorAll('#themeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.t === (s.theme || 'system')));
  renderMemStats();
  loadImportBox();
  renderProAccount();

  const box = $('localModels');
  box.innerHTML = '<div class="muted">Looking for local models…</div>';
  const found = await skillerr.invoke('detect-local');
  box.innerHTML = '';
  if (!found.length) {
    box.innerHTML = `<div class="muted">No local AI running. Install <a href="#" data-url="https://ollama.com/download">Ollama</a>, then run
      <code>ollama pull qwen3</code> — Skillerr finds it automatically.</div>`;
    localChoice = null;
    return;
  }
  localChoice = found.find((m) => m.model === s.localModel && m.baseUrl === s.localBaseUrl) || found[0];
  for (const m of found) {
    const b = h('button', 'model-opt', `<span class="radio"></span><span>${esc(m.model)}</span><span class="src">${esc(m.source)}</span>`);
    b.type = 'button';
    b.classList.toggle('on', m === localChoice);
    b.onclick = () => {
      localChoice = m;
      box.querySelectorAll('.model-opt').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    };
    box.appendChild(b);
  }
}

async function saveSettings(patch) {
  settings = await skillerr.invoke('save-settings', patch);
  renderModelPill();
  return settings;
}

$('saveSettings').onclick = async () => {
  const common = {
    pane,
    requireApproval: $('requireApproval').checked,
    remember: $('remember').checked,
    semanticRecall: $('semanticRecall').checked,
    shareSkillsWithClaudeCode: $('shareSkills').checked,
    sleepTabs: $('sleepTabs').checked,
    trails: $('trailsOn').checked,
    updateChecks: $('updateChecks').checked,
    betaUpdates: $('betaUpdates').checked,
    searchApi: $('searchApi').value,
    searchApiKey: $('searchApiKey').value.trim(),
    claudeModel: $('claudeModel').value,
    anthropicKey: $('claudeKey').value.trim(),
    otherPreset: $('otherPreset').value,
    otherUrl: $('otherUrl').value.trim(),
    otherModel: $('otherModel').value.trim(),
    otherKey: $('otherKey').value.trim(),
    proModel: $('proModel').value,
    proKey: $('proKey').value.trim(),
  };
  let active;
  if (pane === 'claude') active = { provider: 'anthropic', model: common.claudeModel, apiKey: common.anthropicKey, baseUrl: '' };
  else if (pane === 'cloud') active = { provider: 'openai-compatible', baseUrl: /^vck_/.test(common.proKey) ? PRO_GATEWAY : PRO_API, model: common.proModel, apiKey: common.proKey };
  else if (pane === 'other') active = { provider: 'openai-compatible', baseUrl: common.otherUrl, model: common.otherModel, apiKey: common.otherKey };
  else if (localChoice) active = { provider: 'openai-compatible', baseUrl: localChoice.baseUrl, model: localChoice.model, apiKey: '', localModel: localChoice.model, localBaseUrl: localChoice.baseUrl };
  else active = {};
  await saveSettings({ ...common, ...active });
  $('saved').textContent = 'Saved ✓';
  setTimeout(() => ($('saved').textContent = ''), 1500);
  renderAiCards();
  if (pendingTask && (await skillerr.invoke('agent-ready'))) {
    const t = pendingTask;
    pendingTask = null;
    closeSheets();
    startTask(t);
  } else if (!pendingTask) closeSheets();
};

// ================= skills =================

let skillCache = [];
async function loadSkills() {
  skillCache = await skillerr.invoke('skills-list');
  return skillCache;
}

// "/demo-recorder …" at the start of the composer
function activeSkill() {
  const m = taskInput.value.match(/^\/([a-z0-9-]+)(\s|$)/);
  return m ? skillCache.find((s) => s.name === m[1]) : null;
}

const TRUST = {
  'built-in': ['ok', 'Built-in'],
  learned: ['ok', 'Learned'],
  verified_issuer: ['ok', 'Verified signer'],
  self_reported: ['warn', 'Self-reported signer'],
  development: ['warn', 'Dev seal'],
  unsigned: ['warn', 'Unsigned'],
  untrusted: ['bad', 'Seal failed'],
  unknown: ['warn', 'Unverified'],
};
function trustBadge(t) {
  const [kind, label] = TRUST[t?.state] || TRUST.unknown;
  return `<span class="badge ${kind}" title="${esc(t?.summary || '')}">${kind === 'ok' ? icon('shield', 11) : ''}${esc(label)}</span>`;
}

function skillCard(s, actions) {
  const card = h('div', 'skill');
  card.innerHTML = `<div class="ic">${icon(s.icon, 17)}</div><div class="meta"><div class="name">${esc(s.name)} ${trustBadge(s.trust)}</div>
    <div class="desc">${esc(s.description)}</div></div><div class="acts"></div>`;
  for (const a of actions) card.querySelector('.acts').appendChild(a);
  return card;
}

function btn(label, cls, onclick) {
  const b = h('button', 'btn sm ' + cls, label);
  b.type = 'button';
  b.onclick = onclick;
  return b;
}

function useSkill(s) {
  closeSheets();
  taskInput.value = `/${s.name} `;
  autosize();
  renderComposerContext();
  renderSlash();
  taskInput.focus();
}

async function renderSkillsSheet() {
  const list = $('skillList');
  await loadSkills();
  list.innerHTML = '';
  if (!skillCache.length) list.innerHTML = '<div class="muted">No skills yet.</div>';
  for (const s of skillCache) {
    const acts = [btn('Use', 'primary', () => useSkill(s))];
    if (s.source === 'installed') {
      acts.push(btn(icon('trash', 13), 'ghost icon-only', async () => {
        const r = await skillerr.invoke('skills-remove', s.name);
        if (r.ok) renderSkillsSheet();
      }));
    }
    list.appendChild(skillCard(s, acts));
  }
}

$('installSkill').onclick = async () => {
  const box = $('installPreview');
  const r = await skillerr.invoke('skills-pick');
  if (!r) return;
  box.hidden = false;
  if (!r.ok) {
    box.className = 'install-preview error';
    box.innerHTML = `<b>Couldn't open that skill</b><div>${esc(r.message)}</div>`;
    return;
  }
  const s = r.skill;
  box.className = 'install-preview';
  box.innerHTML = `<div class="ip-title">Install this skill?</div>`;
  const notes = [s.trust.summary];
  if (s.hasScripts) notes.push('It bundles scripts. Skillerr never runs them, but other apps you copy it to might.');
  if (r.replaces) notes.push(`Replaces your installed “${s.name}”.`);
  const install = btn('Install', 'primary', async () => {
    const done = await skillerr.invoke('skills-install', r.staging);
    if (!done.ok) {
      box.className = 'install-preview error';
      box.innerHTML = `<b>Install failed</b><div>${esc(done.message)}</div>`;
      return;
    }
    box.hidden = true;
    renderSkillsSheet();
  });
  const cancel = btn('Cancel', 'ghost', () => (box.hidden = true));
  box.appendChild(skillCard(s, []));
  box.insertAdjacentHTML('beforeend', `<ul class="ip-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`);
  if (s.trust.report) box.insertAdjacentHTML('beforeend', `<details class="manual"><summary>skillerr report</summary><pre>${esc(s.trust.report)}</pre></details>`);
  const row = h('div', 'ip-row');
  row.append(cancel, install);
  box.appendChild(row);
};

// ----- slash menu in the composer -----
let slashSel = 0;
function slashMatches() {
  const m = taskInput.value.match(/^\/([a-z0-9-]*)$/);
  return m ? skillCache.filter((s) => s.name.includes(m[1])) : [];
}
function renderSlash() {
  const box = $('slash');
  const matches = slashMatches();
  box.hidden = !matches.length;
  if (!matches.length) return;
  slashSel = Math.min(slashSel, matches.length - 1);
  box.innerHTML = '';
  matches.forEach((s, i) => {
    const row = h('button', 'slash-row' + (i === slashSel ? ' on' : ''), `${icon(s.icon, 14)}<b>/${esc(s.name)}</b><span>${esc(s.description)}</span>`);
    row.type = 'button';
    row.onmousedown = (e) => e.preventDefault();
    row.onclick = () => useSkill(s);
    box.appendChild(row);
  });
}
function slashKey(e) {
  const matches = slashMatches();
  if (!matches.length) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    slashSel = (slashSel + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length;
    renderSlash();
  } else if (e.key === 'Enter' || e.key === 'Tab') useSkill(matches[slashSel]);
  else if (e.key === 'Escape') {
    taskInput.value = '';
    renderSlash();
  } else return false;
  e.preventDefault();
  return true;
}

// ================= recording =================
// Main asks this renderer to record a tab (tab capture: only the page, no screen permission).

let media = null;
skillerr.on('rec-start', async ({ kind, sourceId, width, height }) => {
  try {
    const dpr = window.devicePixelRatio || 1;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: kind || 'tab', chromeMediaSourceId: sourceId, maxWidth: Math.round(width * dpr), maxHeight: Math.round(height * dpr), maxFrameRate: 30 } },
    });
    const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 10e6 });
    let queue = Promise.resolve(); // keep chunks in order
    rec.ondataavailable = (e) => {
      if (e.data.size) queue = queue.then(async () => skillerr.send('rec-chunk', new Uint8Array(await e.data.arrayBuffer())));
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      queue.then(() => skillerr.send('rec-ended', { ext: type.startsWith('video/mp4') ? 'mp4' : 'webm' }));
      media = null;
    };
    rec.start(1000);
    media = rec;
    skillerr.send('rec-started');
  } catch (err) {
    skillerr.send('rec-ended', { error: err.message || String(err) });
  }
});
skillerr.on('rec-stop', () => {
  if (media && media.state !== 'inactive') media.stop();
  else skillerr.send('rec-ended', {});
});

let recTimer = null;
function renderRecPill(rec) {
  const pill = $('recPill');
  pill.hidden = !rec;
  document.body.classList.toggle('recording', !!rec);
  clearInterval(recTimer);
  if (!rec) return;
  const tick = () => {
    const s = Math.max(0, Math.round((Date.now() - rec.startedAt) / 1000));
    $('recTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  tick();
  recTimer = setInterval(tick, 1000);
}
$('recPill').onclick = () => skillerr.send('rec-stop-user');

// Skillerr Pro account: Sign in with Google (in your browser), then Pro follows your subscription.
async function renderProAccount() {
  const box = $('proAccount');
  const [a, st] = await Promise.all([skillerr.invoke('pro-account'), skillerr.invoke('pro-status')]);
  box.innerHTML = '';
  // Until Pro opens, say so plainly; a key bought later activates here without a new download.
  $('proIntro').innerHTML = st.pro ? 'Top models built in, no provider accounts or API keys.'
    : '<b>Skillerr Pro is coming soon</b>: top models built in, no accounts or API keys. Already have a Pro key? Paste it below.';
  if (!a.signedIn && !st.signIn) {
    box.innerHTML = '<span class="muted small">Sign-in is coming soon.</span>';
    return;
  }
  if (!a.signedIn) {
    box.appendChild(btn(`${icon('globe', 13)}Sign in with Google`, 'primary', () => {
      skillerr.send('pro-sign-in');
      if (box.querySelector('.code-row')) return;
      // Normally the browser hands the sign-in back by itself; if it can't, the page shows a code to paste here.
      const row = h('div', 'imp-row code-row', '<input class="code-in" spellcheck="false" placeholder="Or paste the sign-in code" />');
      row.appendChild(btn('Use code', 'ghost', async () => {
        const r = await skillerr.invoke('pro-activate', row.querySelector('input').value.trim());
        if (r.ok) renderProAccount();
        else row.querySelector('input').placeholder = r.message;
      }));
      box.appendChild(h('span', 'muted small', 'Finish signing in in your browser, then come back here.'));
      box.appendChild(row);
    }));
    return;
  }
  const status = !PRO_OPEN ? '' : `<span class="${a.pro ? 'ok-text' : 'muted'}">${a.pro ? 'Pro active' : a.pro === null ? 'Offline' : 'No Pro yet'}</span>`;
  const line = h('div', 'pro-line', `<span>Signed in as <b>${esc(a.email)}</b></span>${status}`);
  box.appendChild(line);
  const row = h('div', 'imp-row');
  if (PRO_OPEN && !a.pro && st.pro) row.appendChild(btn('Get Pro', 'primary', () => skillerr.send('open-url', a.checkout || 'https://skillerr.com/#pricing')));
  row.appendChild(btn('Sign out', 'ghost', async () => {
    await skillerr.invoke('pro-sign-out');
    renderProAccount();
  }));
  box.appendChild(row);
}
skillerr.on('pro-account', () => {
  renderProAccount();
  renderModelPill();
});

// Skillerr Pro: activate a Lemon Squeezy license on this computer, then use it.
$('proActivate').onclick = async () => {
  const b = $('proActivate');
  b.disabled = true;
  const r = await skillerr.invoke('pro-activate', $('proKey').value.trim());
  b.disabled = false;
  $('proStatus').className = 'small ' + (r.ok ? 'ok-text' : 'err-text');
  $('proStatus').textContent = r.message;
  if (r.ok && $('proKey').value.trim().startsWith('sk1.')) return renderProAccount();
  if (r.ok) {
    await saveSettings({ pane: 'cloud', proKey: $('proKey').value.trim(), proModel: $('proModel').value, provider: 'openai-compatible',
      baseUrl: /^vck_/.test($('proKey').value.trim()) ? PRO_GATEWAY : PRO_API, model: $('proModel').value, apiKey: $('proKey').value.trim() });
    renderAiCards();
  }
};

// Appearance applies right away; no need to press Save.
document.querySelectorAll('#themeSeg button').forEach((b) => (b.onclick = async () => {
  await saveSettings({ theme: b.dataset.t });
  document.querySelectorAll('#themeSeg button').forEach((x) => x.classList.toggle('on', x === b));
}));

// ----- Chrome import + bookmarks -----
async function loadImportBox() {
  const { available, profiles } = await skillerr.invoke('chrome-profiles');
  $('importBox').hidden = !available;
  $('chromeProfile').innerHTML = profiles.map((p) => `<option value="${esc(p.dir)}">${esc(p.name)}</option>`).join('');
}
$('doImport').onclick = async () => {
  const b = $('doImport');
  b.disabled = true;
  b.textContent = 'Importing…';
  const r = await skillerr.invoke('chrome-import', { profile: $('chromeProfile').value, bookmarks: $('impBookmarks').checked, history: $('impHistory').checked });
  b.disabled = false;
  b.textContent = 'Import';
  $('importResult').className = 'small ' + (r.ok ? 'ok-text' : 'err-text');
  $('importResult').textContent = r.message;
  renderMemStats();
};
$('signInGoogle').onclick = () => {
  skillerr.send('sign-in-google');
  closeSheets();
};

skillerr.on('bookmarks-changed', () => window.dataView?.refresh());

// ----- research memory -----
async function renderMemStats() {
  const s = await skillerr.invoke('mem-stats');
  $('memStats').textContent = `${s.session} sessions · ${s.page} pages · ${s.note} notes · ${s.skill} skills · ${s.topic} topics remembered`;
}
$('forgetAll').onclick = async () => {
  const b = $('forgetAll');
  if (b.dataset.armed !== '1') {
    b.dataset.armed = '1';
    b.textContent = 'Click again to forget all';
    setTimeout(() => {
      b.dataset.armed = '';
      b.textContent = 'Forget everything';
    }, 3000);
    return;
  }
  await skillerr.invoke('mem-forget-all');
  b.dataset.armed = '';
  b.textContent = 'Forgotten ✓';
  renderMemStats();
};

// Each research session can be dropped from memory from its card.
skillerr.on('mem-session', (e) => {
  const owner = e.via === 'builtin' && task ? task : sessionFor(e);
  const foot = owner.el.querySelector('.g-foot');
  if (!foot || foot.querySelector('.forget')) return;
  const b = h('button', 'forget', 'Don’t remember');
  b.type = 'button';
  b.title = 'Remove this research session, and pages seen only in it, from Skillerr’s memory';
  b.onclick = async () => {
    if (await skillerr.invoke('mem-forget-session', e.id)) {
      b.textContent = 'Not remembered';
      b.disabled = true;
    }
  };
  foot.appendChild(b);
});

// A robot check is the person's to do: say so plainly, in the AI's card.
skillerr.on('human-check', (e) => {
  const owner = e.via === 'builtin' && task ? task : sessionFor(e);
  const card = h('div', 'step approval human', `<div class="ic">${icon('hand', 13)}</div><div class="txt"><div class="main"><b>Your turn:</b> this page wants to check you're human.</div>
    <div class="why">Complete the check in the tab. The AI waits and continues after.</div></div>`);
  owner.steps.appendChild(card);
  keepScrolled();
});

skillerr.on('recall', (r) => {
  const owner = r.via === 'builtin' && task ? task : sessionFor(r);
  const card = h('div', 'rec-card recall-card');
  const items = r.items.slice(0, 5);
  card.innerHTML = `<div class="rc-head"><div class="ic">${icon('clock', 16)}</div><div><div class="name">${items.length ? 'Related past research' : 'Nothing related yet'}</div>
    <div class="sub">for “${esc(trunc(r.query, 60))}”</div></div></div>` +
    (items.length ? `<ul class="recall-list">${items.map((it, i) => `<li data-i="${i}"><span class="rt">${esc(it.type)}</span><span class="rl">${esc(trunc(it.label, 60))}</span><span class="rw">${esc(it.why)} · ${esc(it.when)}</span></li>`).join('')}</ul>` : '');
  card.querySelectorAll('li').forEach((li) => {
    const it = items[+li.dataset.i];
    if (it.file) li.onclick = () => skillerr.send('open-output', { file: it.file });
    else if (it.url) li.onclick = () => skillerr.send('open-url', it.url);
    else li.classList.add('plain');
  });
  owner.steps.appendChild(card);
  keepScrolled();
});

skillerr.on('skill-learned', (k) => {
  const card = h('div', 'rec-card note-card');
  card.innerHTML = `<div class="rc-head"><div class="ic">${icon('blocks', 16)}</div><div><div class="name">${k.updated ? 'Refined' : 'Learned'} a skill: ${esc(k.name)}</div>
    <div class="sub">${esc(k.description)}</div></div></div><div class="rc-acts"></div>`;
  card.querySelector('.rc-acts').append(
    btn(`${icon('doc', 12)}View SKILL.md`, 'ghost', () => skillerr.send('open-output', { file: k.file })),
    btn(`${icon('blocks', 12)}All skills`, 'ghost', () => openSheet('skills')),
  );
  const owner = task || session;
  if (owner) owner.steps.appendChild(card);
  else place(card);
  loadSkills();
  keepScrolled();
});

skillerr.on('note-saved', (n) => {
  const card = h('div', 'rec-card note-card');
  card.innerHTML = `<div class="rc-head"><div class="ic">${icon('doc', 16)}</div><div><div class="name">${esc(n.title)}</div>
    <div class="sub">Saved to Skillerr/notes</div></div></div><div class="rc-acts"></div>`;
  card.querySelector('.rc-acts').append(
    btn(`${icon('doc', 12)}Open note`, 'primary', () => skillerr.send('open-output', { file: n.file })),
    btn(`${icon('folder', 12)}Show in Finder`, 'ghost', () => skillerr.send('open-output', { file: n.file, reveal: true })),
  );
  const owner = task || session;
  if (owner) owner.steps.appendChild(card);
  else place(card);
  keepScrolled();
});

skillerr.on('rec-saved', (r) => {
  const card = h('div', 'rec-card');
  card.innerHTML = `<div class="rc-head"><div class="ic">${icon('film', 16)}</div><div><div class="name">${esc(r.title)}</div>
    <div class="sub">Demo saved · ${r.secs}s · ${r.steps} step${r.steps === 1 ? '' : 's'}</div></div></div><div class="rc-acts"></div>`;
  const open = (file, reveal) => () => skillerr.send('open-output', { file, reveal });
  card.querySelector('.rc-acts').append(
    btn(`${icon('play', 11)}Play video`, 'primary', open(r.video)),
    btn(`${icon('doc', 12)}Open guide`, 'ghost', open(r.guide)),
    btn(`${icon('folder', 12)}Show files`, 'ghost', open(r.video, true)),
  );
  const owner = task || session;
  if (owner) owner.steps.appendChild(card);
  else place(card);
  keepScrolled();
});

// ================= first launch =================

async function showOnboarding() {
  const box = $('onboard');
  box.hidden = false;
  let step = 0;
  const go = (n) => {
    step = n;
    box.querySelectorAll('.ob-step').forEach((el) => el.classList.toggle('on', +el.dataset.step === n));
    box.querySelectorAll('.ob-dots i').forEach((d, i) => d.classList.toggle('on', i === n));
  };
  box.querySelectorAll('.ob-next').forEach((b) => (b.onclick = () => go(step + 1)));
  box.addEventListener('keydown', (e) => e.key === 'Enter' && step < 2 && go(step + 1));

  // Step 2: the same one-click connect cards as the start page, plus the built-in options.
  const cards = $('obCards');
  const targets = await skillerr.invoke('connect-targets');
  for (const t of targets) cards.appendChild(connCard(t, 'conn'));
  const pro = h('div', 'conn', `<div class="ic">${icon('sparkle', 17)}</div><div class="meta"><div class="name">Built-in AI</div><div class="sub">A free local model or your own API key</div></div>`);
  pro.appendChild(btn('Set up later', 'ghost', () => go(2)));
  cards.appendChild(pro);

  const { available } = await skillerr.invoke('chrome-profiles');
  $('obImportRow').hidden = !available;
  let theme = settings.theme || 'system';
  const paintTheme = () => document.querySelectorAll('#obTheme button').forEach((b) => b.classList.toggle('on', b.dataset.t === theme));
  document.querySelectorAll('#obTheme button').forEach((b) => (b.onclick = async () => {
    theme = b.dataset.t;
    paintTheme();
    await saveSettings({ theme });
  }));
  paintTheme();

  box.querySelector('.ob-done').onclick = async () => {
    await saveSettings({ onboarded: true, remember: $('obRemember').checked, trails: $('obTrails').checked, trailsIntroSeen: true });
    if (available && $('obImport').checked) {
      const { profiles } = await skillerr.invoke('chrome-profiles');
      if (profiles[0]) {
        skillerr.invoke('chrome-import', { profile: profiles[0].dir, bookmarks: true, history: $('obRemember').checked });
        if ($('obTrails').checked) skillerr.invoke('trails-seed', profiles[0].dir).then(() => renderTrailsHome());
      }
    }
    box.classList.add('leaving');
    setTimeout(() => (box.hidden = true), 450);
    $('hero').focus();
  };
  setTimeout(() => box.querySelector('.ob-next').focus(), 50);
}

// ================= boot =================

(async () => {
  loadSkills().then(renderChips);
  settings = await skillerr.invoke('get-settings');
  renderModelPill();
  renderDeep();
  if (!settings.onboarded) showOnboarding();
  renderAiCards();
  setRunning(false);
})();
skillerr.send('ui-ready');
