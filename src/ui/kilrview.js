/* global skillerr, icon, esc, trunc, learnResultText */
// The Orb's own panel, over the Skillerr Orb page: what the Orb is, what it's doing right now, and what it costs this
// computer (disk, memory, speed), how it learns, and the skills it suggests from tasks done the same way again and again.
// Opens from the orb or the Kilr button; while open it asks for kilr-status every two seconds.
(() => {
  const $ = (id) => document.getElementById(id);
  const panel = $('kilrPanel');
  const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = (n) => (n || 0).toLocaleString();
  const EVERY = { daily: 1, weekly: 7, monthly: 30 };
  let open = false;
  let poll = 0;
  let raf = 0;
  let status = null;
  let progress = null; // 0…1 while learning
  let lastResult = null;
  let seen = new Set(); // log entries already shown, so new ones can flash in
  let suggestions = null;

  const ago = (at) => {
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return `${s} s ago`;
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' });
  };
  const day = (at) => new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' });

  function skeleton() {
    panel.innerHTML = `
      <button type="button" class="mv-close kp-close" title="Close">${icon('x', 14)}</button>
      <header class="kp-head">
        <canvas class="kp-orb" id="kpOrb" width="192" height="192"></canvas>
        <div>
          <div class="kp-eyebrow">Built into Skillerr</div>
          <h3>Skillerr Orb</h3>
          <p>Skillerr's own small AI. It turns page titles and searches into meaning, files them into trails and finds things by meaning. It doesn't write text, so it can't make things up.</p>
        </div>
      </header>
      <div class="kp-now" id="kpNow"></div>
      <div class="kp-off" id="kpOff" hidden></div>
      <section class="kp-sec">
        <h4>On this computer</h4>
        <div class="kp-tiles" id="kpTiles"></div>
        <div class="kp-runs" id="kpRuns"></div>
      </section>
      <section class="kp-sec">
        <h4>Learning your words</h4>
        <div id="kpLearn"></div>
      </section>
      <section class="kp-sec" id="kpSuggestSec" hidden>
        <h4>Skills the Orb suggests</h4>
        <p class="kp-note">Things you (or your AIs) keep doing the same way. Save one as a skill and any AI app can do it your way next time.</p>
        <div id="kpSuggest"></div>
      </section>
      <section class="kp-sec">
        <h4>What the Orb did lately</h4>
        <ol class="kp-log" id="kpLog"></ol>
      </section>`;
    panel.querySelector('.kp-close').onclick = close;
  }

  function tile(label, value, sub, ic) {
    return `<div class="kp-tile"><div class="kp-tl">${ic ? icon(ic, 12) : ''}${label}</div><div class="kp-tv">${value}</div><div class="kp-ts">${sub}</div></div>`;
  }

  function render() {
    const s = status;
    if (!s) return;
    const m = s.model || {};
    const p = s.personal || {};
    $('kpOff').hidden = s.on !== false;
    if (s.on === false) $('kpOff').innerHTML = `The Orb is off. Trails match pages by shared words instead. <button type="button" class="link-btn" id="kpOn">Turn it on in Trails settings</button>`;
    $('kpOn')?.addEventListener('click', () => skillerr.send('open-trails'));

    // Right now
    const learningNow = s.learning?.running || progress != null;
    const recent = s.log?.[0] && Date.now() - s.log[0].at < 15000 ? s.log[0] : null;
    $('kpNow').className = `kp-now${learningNow || recent ? ' busy' : ''}`;
    $('kpNow').innerHTML = learningNow
      ? `<i class="kp-dot"></i><div><b>Learning your words…</b><div class="kp-bar"><i style="width:${Math.round((progress || 0) * 100)}%"></i></div></div>`
      : recent ? `<i class="kp-dot"></i><div><b>${esc(recent.what)}</b><span>${ago(recent.at)}</span></div>`
        : `<i class="kp-dot"></i><div><b>Resting</b><span>It only works when a page is filed or you search: a few microseconds each time.</span></div>`;

    // Tiles
    const personalKB = p.exists ? ` + ${fmt(p.sizeKB)} KB learned` : '';
    $('kpTiles').innerHTML = [
      tile('On disk', `${m.sizeMB ?? 7.9}<small> MB</small>`, `one file${personalKB}`, 'doc'),
      tile('Memory now', m.loaded ? `${s.memoryMB}<small> MB</small>` : '0<small> MB</small>', m.loaded ? `woke in ${fmt(m.loadMs)} ms` : 'asleep until it\'s needed', 'layers'),
      tile('Knows', `${fmt(m.words)}<small> words</small>`, `each as ${m.dims} numbers of meaning`, 'book'),
      tile('Speed', s.avgMicros != null ? `${fmt(s.avgMicros)}<small> µs</small>` : '–', s.texts ? `per text · ${fmt(s.texts)} read since Skillerr started` : 'per text · nothing read yet', 'clock'),
      tile('Finds by meaning', `${fmt(s.recallVectors)}`, 'things in research memory it can recall', 'search'),
      tile('Trails', `${fmt(s.trails?.you)}<small> yours</small> · ${fmt(s.trails?.ai)}<small> AIs'</small>`, 'threads of work it keeps filed', 'list'),
    ].join('');
    const r = s.runsOn || {};
    $('kpRuns').innerHTML = [
      `${icon('cpu', 13)}Runs on your CPU`,
      r.gpu ? `${icon('cpu', 13)}Uses your GPU` : `${icon('check', 13)}No GPU needed`,
      r.network ? `${icon('globe', 13)}Uses the internet` : `${icon('shield', 13)}Works offline. Nothing leaves your computer`,
    ].map((x) => `<span>${x}</span>`).join('');

    // Learning
    const L = s.learning || {};
    const last = p.last || null;
    const mode = L.mode === 'auto' ? 'Automatically, when your computer is idle' : L.mode === 'off' ? 'Off' : 'Asks you first';
    const reads = [L.fromYou && 'your browsing', L.fromAi && 'your AIs\' research'].filter(Boolean).join(' and ') || 'nothing (both switched off)';
    let next;
    if (L.mode === 'off') next = 'Learning is off.';
    else if (L.due) next = `Ready now: ${fmt(L.due.newPages)} new pages (${fmt(L.due.you)} yours, ${fmt(L.due.ai)} your AIs').`;
    else {
      const at = (last?.at || 0) + (EVERY[L.every] || 7) * 864e5;
      next = at > Date.now() ? `Next: ${day(at)}, once there are 20 new pages.` : 'Next: once there are 20 new pages to learn from.';
    }
    const result = lastResult || last;
    $('kpLearn').innerHTML = `
      <div class="kp-rows">
        <div><span>Learned so far</span><b>${p.exists ? `${fmt(p.words)} words of yours` : 'Not yet: it uses the words it came with'}</b></div>
        <div><span>Last time</span><b>${last ? `${day(last.at)}: read ${fmt(last.sources?.you)} of your pages and ${fmt(last.sources?.ai)} from your AIs'` : 'Never'}</b></div>
        <div><span>Learns from</span><b>${esc(reads)}</b></div>
        <div><span>When</span><b>${esc(mode)}${L.mode !== 'off' ? `, ${esc(L.every || 'weekly')}` : ''}</b></div>
      </div>
      ${result ? `<p class="kp-note">${esc(learnResultText(result))}</p>` : ''}
      <div class="kp-learn-row"><button type="button" class="btn sm primary" id="kpLearnNow" ${learningNow || s.on === false ? 'disabled' : ''}>${learningNow ? 'Learning…' : `${icon('sparkle', 12)}Learn now`}</button><span class="kp-note">${esc(next)}</span></div>`;
    $('kpLearnNow').onclick = async () => {
      progress = 0;
      render();
      try {
        lastResult = await skillerr.invoke('kilr-learn');
      } catch {}
      progress = null;
      refresh();
    };

    // Activity
    const log = s.log || [];
    $('kpLog').innerHTML = log.length ? log.map((e) => `<li class="${seen.has(e.at + e.what) ? '' : 'new'}"><span>${ago(e.at)}</span>${esc(e.what)}</li>`).join('')
      : '<li class="kp-empty-log">Nothing yet this session. Open a few pages, or search from the address bar, and you\'ll see the Orb file and find them here.</li>';
    seen = new Set(log.map((e) => e.at + e.what));
  }

  function renderSuggestions() {
    const list = Array.isArray(suggestions) ? suggestions : [];
    $('kpSuggestSec').hidden = !list.length;
    if (!list.length) return;
    $('kpSuggest').innerHTML = list.map((s, i) => `<div class="kp-sug" data-i="${i}">
        <b>${esc(s.title)}</b>
        ${s.why ? `<div class="kp-note">${esc(s.why)}</div>` : ''}
        ${s.trails?.length ? `<div class="kp-chips">${s.trails.slice(0, 5).map((t) => `<span class="${t.by ? 'ai' : 'you'}" title="${t.by ? esc(`Researched by ${t.by}`) : 'Your trail'}">${esc(trunc(t.title, 32))}</span>`).join('')}</div>` : ''}
        ${s.preview ? `<details><summary>Preview</summary><pre>${esc(String(s.preview).slice(0, 1500))}</pre></details>` : ''}
        <div class="kp-sug-acts"><button type="button" class="btn sm primary" data-a="save">${icon('sparkle', 12)}Save as a skill</button><button type="button" class="btn sm ghost" data-a="dismiss">Not now</button></div>
      </div>`).join('');
    $('kpSuggest').querySelectorAll('.kp-sug').forEach((el) => {
      const s = list[+el.dataset.i];
      el.querySelector('[data-a="save"]').onclick = async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          const r = await skillerr.invoke('kilr-suggestion-save', s.id);
          b.innerHTML = r && r.ok === false ? esc(r.message || 'Couldn\'t save') : `${icon('check', 12)}Saved`;
        } catch {
          b.textContent = 'Couldn\'t save';
        }
      };
      el.querySelector('[data-a="dismiss"]').onclick = async () => {
        try {
          await skillerr.invoke('kilr-suggestion-dismiss', s.id);
        } catch {}
        suggestions = list.filter((x) => x !== s);
        renderSuggestions();
      };
    });
  }

  async function refresh() {
    if (!open) return;
    try {
      status = await skillerr.invoke('kilr-status');
    } catch {
      status = null;
    }
    render();
  }
  async function loadSuggestions() {
    try {
      suggestions = await skillerr.invoke('kilr-suggestions');
    } catch {
      suggestions = null;
    }
    if (open) renderSuggestions();
  }

  // The orb at the top of the panel, burning as bright as the one on the page.
  function animate(now) {
    raf = 0;
    if (!open || document.hidden) return;
    const c = $('kpOrb');
    if (c && window.KilrOrb) {
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      const glow = window.memoryView?.glow?.() ?? 0.5;
      window.KilrOrb.draw(g, c.width / 2, c.height / 2, c.width * 0.25, Math.max(0.12, glow), now / 1000);
    }
    if (!still()) raf = requestAnimationFrame(animate);
  }

  function show() {
    if (open) return;
    open = true;
    skeleton();
    panel.hidden = false;
    panel.classList.remove('out');
    render();
    refresh();
    loadSuggestions();
    clearInterval(poll);
    poll = setInterval(() => {
      if (!document.hidden) refresh();
    }, 2000);
    if (!raf) raf = requestAnimationFrame(animate);
  }
  function close() {
    if (!open) return;
    open = false;
    clearInterval(poll);
    panel.hidden = true;
  }
  document.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape' && !$('memView').hidden) close();
  });
  document.addEventListener('visibilitychange', () => {
    if (open && !document.hidden && !raf) raf = requestAnimationFrame(animate);
  });
  skillerr.on('kilr-learning', ({ progress: p }) => {
    progress = p;
    if (!open) return;
    const bar = panel.querySelector('.kp-bar i');
    if (bar) bar.style.width = `${Math.round(p * 100)}%`;
    else render();
  });
  skillerr.on('kilr-learned', (r) => {
    progress = null;
    lastResult = r;
    refresh();
  });

  window.kilrPanel = { open: show, close, toggle: () => (open ? close() : show()), isOpen: () => open };
})();
