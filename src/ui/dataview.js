/* global skillerr, esc, trunc, icon */
// History & Bookmarks page (⌘Y): browsing history by day, bookmarks, and clearing browsing data by time range.
(() => {
  const $ = (id) => document.getElementById(id);
  const selected = new Set();
  let tab = 'history';

  const when = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(+d)) return '';
    const days = Math.floor((Date.now() - d) / 864e5);
    return days < 1 ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : days < 7 ? d.toLocaleDateString([], { weekday: 'short' }) : d.toLocaleDateString();
  };
  const letter = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '')[0].toUpperCase();
    } catch {
      return '•';
    }
  };

  function showTab(name) {
    tab = name;
    document.querySelectorAll('#dvTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    document.querySelectorAll('#dataView .dv-pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === name));
    refresh();
  }

  // History like any browser's: newest first, by day, each page with its icon, time and who opened it.
  const dayLabel = (t) => {
    const d = new Date(t);
    const today = new Date();
    const days = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
    return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  };
  async function renderHistory() {
    const list = $('dvHist');
    const items = await skillerr.invoke('data-history', { q: $('dvHistQ').value });
    list.innerHTML = items.length ? '' : `<li class="empty muted">${$('dvHistQ').value ? 'Nothing in your history matches that.' : 'No history yet. Pages you and your AIs open in Skillerr appear here.'}</li>`;
    let day = '';
    for (const it of items) {
      const label = dayLabel(it.at);
      if (label !== day) {
        day = label;
        list.appendChild(Object.assign(document.createElement('li'), { className: 'dv-day', textContent: label }));
      }
      const li = document.createElement('li');
      const fav = it.favicon ? `<img src="${esc(it.favicon)}" width="16" height="16">` : `<span class="bm-l">${esc(letter(it.url))}</span>`;
      li.innerHTML = `<input type="checkbox" ${selected.has(it.url) ? 'checked' : ''} /><span class="dv-fav">${fav}</span>
        <span class="dv-t"><b>${esc(trunc(it.title || it.url, 90))}</b><span class="muted">${esc(host(it.url))}${it.by ? ` · <span class="dv-by">opened by ${esc(it.by)}</span>` : ''}</span></span>
        <span class="dv-when muted">${new Date(it.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><button type="button" class="dv-x" title="Remove from history">${icon('x', 13)}</button>`;
      const img = li.querySelector('img');
      if (img) img.onerror = () => (img.outerHTML = `<span class="bm-l">${esc(letter(it.url))}</span>`);
      li.querySelector('input').onchange = (e) => {
        if (e.target.checked) selected.add(it.url);
        else selected.delete(it.url);
        $('dvDelSel').disabled = !selected.size;
      };
      li.querySelector('.dv-t').onclick = () => skillerr.send('open-url', it.url);
      li.querySelector('.dv-x').onclick = async () => {
        await skillerr.invoke('data-delete-pages', [it.url]);
        renderHistory();
      };
      list.appendChild(li);
    }
  }
  const host = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  };

  async function renderBookmarks() {
    const list = $('dvBm');
    const q = $('dvBmQ').value.toLowerCase();
    const items = (await skillerr.invoke('bookmarks')).filter((b) => !q || `${b.title} ${b.url} ${b.folder}`.toLowerCase().includes(q));
    list.innerHTML = items.length ? '' : '<li class="empty muted">No bookmarks. Press ⌘D on any page, or import them from Chrome in Settings.</li>';
    for (const bm of items.slice(0, 500)) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="bm-l">${esc(letter(bm.url))}</span><span class="dv-t"><b>${esc(trunc(bm.title, 90))}</b><span class="muted">${esc(bm.folder ? `${bm.folder} · ` : '')}${esc(trunc(bm.url, 80))}</span></span>
        <button type="button" class="dv-x" title="Delete bookmark">${icon('x', 13)}</button>`;
      li.querySelector('.dv-t').onclick = () => skillerr.send('open-url', bm.url);
      li.querySelector('.dv-x').onclick = async () => {
        await skillerr.invoke('bookmark-delete', bm.url);
        li.remove();
      };
      list.appendChild(li);
    }
  }

  function refresh() {
    if ($('dataView').hidden) return;
    if (tab === 'history') renderHistory();
    else if (tab === 'bookmarks') renderBookmarks();
  }

  let t;
  const debounced = () => {
    clearTimeout(t);
    t = setTimeout(refresh, 150);
  };
  document.querySelectorAll('#dvTabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  $('dvHistQ').oninput = debounced;
  $('dvBmQ').oninput = debounced;
  $('dvDelSel').onclick = async () => {
    await skillerr.invoke('data-delete-pages', [...selected]);
    selected.clear();
    $('dvDelSel').disabled = true;
    renderHistory();
  };
  $('dvToClear').onclick = () => showTab('clear');
  $('dvBmAdd').onclick = async () => {
    const r = await skillerr.invoke('bookmark-add');
    $('dvBmAdd').textContent = r.ok ? 'Bookmarked ✓' : r.message;
    setTimeout(() => ($('dvBmAdd').textContent = 'Bookmark current page  ⌘D'), 1800);
    renderBookmarks();
  };
  // "Everything" ticks the rest, so it's obvious what goes.
  document.querySelector('[data-r=everything]').onchange = (e) => document.querySelectorAll('.dv-reset input').forEach((i) => (i.checked = e.target.checked));
  $('dvReset').onclick = async () => {
    const b = $('dvReset');
    const what = {};
    document.querySelectorAll('.dv-reset input').forEach((i) => (what[i.dataset.r] = i.checked));
    if (!Object.values(what).some(Boolean)) return;
    if (b.dataset.armed !== '1') {
      b.dataset.armed = '1';
      b.textContent = 'Click again to clear';
      setTimeout(() => {
        b.dataset.armed = '';
        b.textContent = 'Clear data';
      }, 3000);
      return;
    }
    b.dataset.armed = '';
    b.textContent = 'Clear data';
    if (what.everything) Object.assign(what, { history: true, browsing: true, cache: true, memory: true, trails: true, bookmarks: true, settings: true });
    const range = Number($('dvSince').value);
    what.since = range && !what.everything ? Date.now() - range : 0;
    $('dvResetMsg').textContent = await skillerr.invoke('data-reset', what);
    document.querySelectorAll('.dv-reset input').forEach((i) => (i.checked = false));
  };
  skillerr.on('data-tab', (name) => showTab(name));

  window.dataView = { show: refresh, refresh };
})();
