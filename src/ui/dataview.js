/* global skillerr, esc, trunc, icon */
// History & Bookmarks page: search and delete history, manage bookmarks, reset data.
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

  async function renderHistory() {
    const list = $('dvHist');
    const items = await skillerr.invoke('data-history', $('dvHistQ').value);
    list.innerHTML = items.length ? '' : '<li class="empty muted">No history yet. Pages your AIs and you visit through Skillerr appear here.</li>';
    for (const it of items) {
      const li = document.createElement('li');
      li.innerHTML = `<input type="checkbox" ${selected.has(it.id) ? 'checked' : ''} /><span class="bm-l">${esc(letter(it.url))}</span>
        <span class="dv-t"><b>${esc(trunc(it.title, 90))}</b><span class="muted">${esc(it.host || it.url)}${it.from === 'chrome-history' ? ' · from Chrome' : it.from === 'bookmark' ? ' · bookmark' : ''}${it.visits > 1 ? ` · ${it.visits} visits` : ''}</span></span>
        <span class="dv-when muted">${esc(when(it.lastVisited))}</span><button type="button" class="dv-x" title="Delete">${icon('x', 13)}</button>`;
      li.querySelector('input').onchange = (e) => {
        if (e.target.checked) selected.add(it.id);
        else selected.delete(it.id);
        $('dvDelSel').disabled = !selected.size;
      };
      li.querySelector('.dv-t').onclick = () => skillerr.send('open-url', it.url);
      li.querySelector('.dv-x').onclick = async () => {
        await skillerr.invoke('data-delete-pages', [it.id]);
        li.remove();
      };
      list.appendChild(li);
    }
  }

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
  $('dvRange').onchange = async () => {
    const v = $('dvRange').value;
    $('dvRange').value = '';
    if (!v) return;
    await skillerr.invoke('data-delete-since', v === 'all' ? 0 : Date.now() - Number(v));
    renderHistory();
  };
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
        b.textContent = 'Clear selected';
      }, 3000);
      return;
    }
    b.dataset.armed = '';
    b.textContent = 'Clear selected';
    if (what.everything) Object.assign(what, { browsing: true, memory: true, trails: true, bookmarks: true, settings: true });
    $('dvResetMsg').textContent = await skillerr.invoke('data-reset', what);
    document.querySelectorAll('.dv-reset input').forEach((i) => (i.checked = false));
  };
  skillerr.on('data-tab', (name) => showTab(name));

  window.dataView = { show: refresh, refresh };
})();
