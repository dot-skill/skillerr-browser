/* global skillerr, esc, trunc, icon, btn, h, trailCard, agoText, UNFINISHED, saveSettings, renderKilrLine, learnResultText */
// Trails page: every ongoing trail, what's in it, and the user's controls (rename, merge, done, forget, never learn
// from a site), plus the Trails settings.
(() => {
  const $ = (id) => document.getElementById(id);
  let tab = 'active';
  let open = null; // the trail whose pages are shown
  let list = [];
  let who = 'all'; // All / Yours / Your AIs'

  function showTab(name) {
    tab = name;
    document.querySelectorAll('#tvTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    document.querySelectorAll('#trailsView .dv-pane').forEach((p) => p.classList.toggle('on', p.dataset.tvpane === (name === 'settings' ? 'settings' : 'list')));
    refresh();
  }

  async function renderList() {
    const box = $('tvList');
    const q = $('tvQ').value.trim();
    // A question gets Kilr's answer on top; the list below is the trails it matches, by meaning.
    const answer = tab === 'active' && q.split(/\s+/).length >= 2 ? await skillerr.invoke('trails-ask', q) : null;
    renderKilrLine($('tvAnswer'), answer);
    list = await skillerr.invoke('trails-list', { state: tab, query: q, who });
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = `<div class="tv-empty muted">${$('tvQ').value ? 'No trails match.' : tab === 'done'
        ? 'Trails you mark done rest here for 30 days.'
        : 'No trails yet. Browse as usual: pages you search for, open from each other and come back to become trails. You can also start from your Chrome history in Settings.'}</div>`;
      return;
    }
    for (const t of list) box.appendChild(row(t));
  }

  function row(t) {
    const wrap = h('div', 'tv-trail' + (open === t.id ? ' open' : ''));
    const card = trailCard(t, { onChange: refresh });
    card.querySelector('.tc-meta').onclick = () => {
      open = open === t.id ? null : t.id;
      renderList();
    };
    card.querySelector('.tc-meta').title = 'Show the pages in this trail';
    const acts = card.querySelector('.tc-acts');
    if (t.state === 'done') {
      acts.innerHTML = '';
      acts.append(btn('Reopen', 'ghost', async () => {
        await skillerr.invoke('trails-state', { id: t.id, state: 'active' });
        refresh();
      }));
    }
    const more = btn(icon('more', 14), 'ghost icon-only', () => menu(t, more, wrap));
    more.title = 'Rename, merge, forget';
    acts.appendChild(more);
    wrap.appendChild(card);
    if (open === t.id) detail(t.id, wrap);
    return wrap;
  }

  // A small in-page menu: rename, merge into another trail, forget.
  function menu(t, anchor, wrap) {
    document.querySelector('.tv-menu')?.remove();
    const m = h('div', 'tv-menu');
    const item = (label, fn) => {
      const b = h('button', '', label);
      b.type = 'button';
      b.onclick = () => {
        m.remove();
        fn();
      };
      m.appendChild(b);
    };
    item(`${icon('type', 13)}Rename`, () => rename(t, wrap));
    const others = list.filter((x) => x.id !== t.id && !x.loose);
    if (others.length && !t.loose) item(`${icon('layers', 13)}Merge into…`, () => merge(t, others, wrap));
    item(`${icon('trash', 13)}Forget this trail`, async () => {
      await skillerr.invoke('trails-forget', t.id);
      refresh();
    });
    anchor.parentElement.appendChild(m);
    setTimeout(() => document.addEventListener('mousedown', function off(e) {
      if (!m.contains(e.target)) {
        m.remove();
        document.removeEventListener('mousedown', off);
      }
    }), 0);
  }

  function rename(t, wrap) {
    const title = wrap.querySelector('.tc-title');
    if (!title) return;
    const input = h('input', 'tv-rename');
    input.value = t.title;
    title.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const save = async (keep) => {
      if (done) return;
      done = true;
      if (keep && input.value.trim() && input.value.trim() !== t.title) await skillerr.invoke('trails-rename', { id: t.id, title: input.value });
      refresh();
    };
    input.onclick = (e) => e.stopPropagation();
    input.onkeydown = (e) => {
      if (e.key === 'Enter') save(true);
      if (e.key === 'Escape') save(false);
    };
    input.onblur = () => save(true);
  }

  function merge(t, others, wrap) {
    const sel = h('select', 'tv-merge', `<option value="">Merge “${esc(trunc(t.title, 40))}” into…</option>` +
      others.map((o) => `<option value="${esc(o.id)}">${esc(trunc(o.title, 60))}</option>`).join(''));
    wrap.prepend(sel);
    sel.focus();
    sel.onchange = async () => {
      if (sel.value) await skillerr.invoke('trails-merge', { into: sel.value, from: t.id });
      refresh();
    };
  }

  async function detail(id, wrap) {
    const d = await skillerr.invoke('trails-detail', id);
    if (!d) return;
    const box = h('div', 'tv-detail');
    if (d.searches.length) box.appendChild(h('div', 'tv-searches', `${icon('search', 12)}${d.searches.map((q) => `<span>${esc(q)}</span>`).join('')}`));
    if (d.tuckedTabs.length) {
      box.appendChild(h('div', 'tv-sub', `Tucked tabs (${d.tuckedTabs.length})`));
      const ul = h('ul', 'dv-list tv-pages');
      for (const x of d.tuckedTabs) ul.appendChild(pageRow(d, { ...x, lastAt: x.at, tucked: true }));
      box.appendChild(ul);
    }
    box.appendChild(h('div', 'tv-sub', `Pages (${d.pages.length})`));
    const ul = h('ul', 'dv-list tv-pages');
    for (const p of d.pages) ul.appendChild(pageRow(d, p));
    box.appendChild(ul);
    wrap.appendChild(box);
  }

  function pageRow(d, p) {
    const li = document.createElement('li');
    const host = p.host || (() => {
      try {
        return new URL(p.url).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })();
    const marks = Object.entries(p.unfinished || {}).map(([k, v]) => `<span class="tb warn">${esc((UNFINISHED[k] || (() => k))({ ...v }))}</span>`).join('');
    const fav = p.favicon ? `<img src="${esc(p.favicon)}">` : '•';
    li.innerHTML = `<span class="bm-l">${fav}</span><span class="dv-t"><b>${esc(trunc(p.title || p.url, 90))}</b>
      <span class="muted">${esc(host)}${p.visits > 1 ? ` · ${p.visits} visits` : ''}${p.days?.length >= 3 ? ` · on ${p.days.length} days` : ''}${p.tucked ? ' · tucked' : ''} ${marks}</span></span>
      <span class="dv-when muted">${esc(agoText(p.lastAt))}</span>
      <button type="button" class="dv-x tv-ignore" title="Never learn from ${esc(host)}">${icon('eye', 13)}</button>
      <button type="button" class="dv-x" title="Remove from this trail">${icon('x', 13)}</button>`;
    const img = li.querySelector('.bm-l img');
    if (img) img.onerror = () => img.replaceWith('•');
    li.querySelector('.dv-t').onclick = () => skillerr.send('open-url', p.url);
    li.querySelector('.tv-ignore').onclick = async () => {
      await skillerr.invoke('trails-ignore', host);
      refresh();
    };
    li.querySelector('.dv-x:last-child').onclick = async () => {
      await skillerr.invoke('trails-remove-page', { id: d.id, url: p.url });
      li.remove();
    };
    return li;
  }

  async function renderSettings() {
    const info = await skillerr.invoke('trails-info');
    $('tvLearn').checked = info.enabled;
    $('tvTuck').checked = info.tuck;
    $('tvKilr').checked = info.kilr;
    renderLearn();
    const hosts = (box, items, empty, action) => {
      box.innerHTML = items.length ? '' : `<span class="muted small">${empty}</span>`;
      for (const it of items) {
        const chip = h('span', 'tv-host', esc(it));
        if (action) {
          const b = h('button', '', icon(action.icon, 11));
          b.type = 'button';
          b.title = action.title(it);
          b.onclick = async () => {
            await action.run(it);
            renderSettings();
          };
          chip.appendChild(b);
        }
        box.appendChild(chip);
      }
    };
    hosts($('tvIgnored'), info.ignored, 'None.', { icon: 'x', title: (x) => `Learn from ${x} again`, run: (x) => skillerr.invoke('trails-unignore', x) });
    hosts($('tvEveryday'), info.everyday, 'None yet.', { icon: 'eye', title: (x) => `Never learn from ${x}`, run: (x) => skillerr.invoke('trails-ignore', x) });
    hosts($('tvClients'), info.clients, 'None. An AI app asks the first time it wants to see your trails.', { icon: 'x', title: (x) => `Stop ${x} seeing your trails`, run: (x) => skillerr.invoke('trails-revoke-client', x) });
    const chrome = $('tvChrome');
    chrome.hidden = !info.chrome.length;
    if (info.chrome.length) {
      chrome.innerHTML = `<b>Start from your Chrome history</b><span class="muted small">Finds trails in the last month of Chrome history on this computer. Nothing is sent anywhere.</span>`;
      const row = h('div', 'imp-row');
      const sel = h('select', 'tv-profile', info.chrome.map((p) => `<option value="${esc(p.dir)}">${esc(p.name)}</option>`).join(''));
      const msg = h('span', 'small muted');
      row.append(sel, btn('Find trails', 'ghost', async () => {
        msg.textContent = 'Looking…';
        msg.textContent = (await skillerr.invoke('trails-seed', sel.value)).message;
      }), msg);
      chrome.appendChild(row);
    }
  }

  $('tvLearn').onchange = () => saveSettings({ trails: $('tvLearn').checked });
  $('tvLearnMode').onchange = () => saveSettings({ kilrLearn: $('tvLearnMode').value });
  $('tvLearnEvery').onchange = () => saveSettings({ kilrLearnEvery: $('tvLearnEvery').value });
  $('tvLearnNow').onclick = () => skillerr.invoke('kilr-learn');
  $('tvLearnYou').onchange = () => saveSettings({ kilrLearnFromYou: $('tvLearnYou').checked });
  $('tvLearnAi').onchange = () => saveSettings({ kilrLearnFromAi: $('tvLearnAi').checked });
  $('tvResearch').onchange = () => saveSettings({ trailsResearch: $('tvResearch').checked });
  $('tvSkills').onchange = () => saveSettings({ kilrSkills: $('tvSkills').checked });
  document.querySelectorAll('#tvWho button').forEach((b) => (b.onclick = () => {
    who = b.dataset.who;
    document.querySelectorAll('#tvWho button').forEach((x) => x.classList.toggle('on', x === b));
    renderList();
  }));
  $('tvLearnForget').onclick = async () => {
    await skillerr.invoke('kilr-forget');
    renderLearn();
  };
  async function renderLearn() {
    const w = await skillerr.invoke('kilr-info');
    $('tvLearnMode').value = w.learn || 'suggest';
    $('tvLearnEvery').value = w.every || 'weekly';
    $('tvLearnEvery').disabled = w.learn === 'off';
    $('tvLearnNow').disabled = w.learning;
    $('tvLearnForget').hidden = !w.personal;
    $('tvLearnYou').checked = w.fromYou;
    $('tvLearnAi').checked = w.fromAi;
    $('tvResearch').checked = w.research;
    $('tvSkills').checked = w.skills;
    $('tvLearnStatus').textContent = w.learning ? 'Learning…' : w.last ? `${new Date(w.last.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}: ${learnResultText(w.last)}` : 'Kilr hasn\'t learned from your trails yet.';
  }
  $('tvTuck').onchange = () => saveSettings({ trailsTuck: $('tvTuck').checked });
  $('tvKilr').onchange = () => saveSettings({ kilr: $('tvKilr').checked });
  $('tvIgnoreForm').onsubmit = async (e) => {
    e.preventDefault();
    const v = $('tvIgnoreHost').value.trim().replace(/^https?:\/\//, '').split('/')[0];
    if (!v) return;
    await skillerr.invoke('trails-ignore', v);
    $('tvIgnoreHost').value = '';
    renderSettings();
  };
  $('tvForgetAll').onclick = async () => {
    const b = $('tvForgetAll');
    if (b.dataset.armed !== '1') {
      b.dataset.armed = '1';
      b.textContent = 'Click again to forget';
      setTimeout(() => {
        b.dataset.armed = '';
        b.textContent = 'Forget all trails';
      }, 3000);
      return;
    }
    b.dataset.armed = '';
    b.textContent = 'Forget all trails';
    await skillerr.invoke('trails-forget-all');
    $('tvMsg').textContent = 'Forgotten. Sites you excluded stay excluded.';
  };
  $('tvTidy').onclick = async () => {
    const r = await skillerr.invoke('trails-tidy');
    if (!r?.count) {
      $('tvTidy').textContent = 'Nothing to tidy';
      setTimeout(() => ($('tvTidy').textContent = 'Tidy tabs now'), 1800);
    }
  };
  document.querySelectorAll('#tvTabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  let qTimer = null;
  $('tvQ').oninput = () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(renderList, 200);
  };

  function refresh() {
    if ($('trailsView').hidden) return;
    if (tab === 'settings') renderSettings();
    else renderList();
  }

  window.trailsView = {
    show: refresh,
    refresh,
    learning: (p) => {
      if (tab === 'settings') $('tvLearnStatus').textContent = `Learning… ${Math.round(p * 100)}%`;
    },
    learned: () => tab === 'settings' && renderLearn(),
  };
})();
