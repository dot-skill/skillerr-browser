/* global skillerr, icon, esc, trunc */
// Research memory view: the knowledge graph as an interactive map (canvas, no libraries).
// Drag the background to pan, scroll to zoom, drag a node to move it, click it to see details.
(() => {
  const $ = (id) => document.getElementById(id);
  const TYPES = {
    session: { color: '#a4a4b2', label: 'Research session', r: 7 },
    note: { color: '#34d399', label: 'Note', r: 7 },
    skill: { color: '#fbbf24', label: 'Skill', r: 7 },
    topic: { color: '#60a5fa', label: 'Topic', r: 6 },
    entity: { color: '#fb923c', label: 'Entity', r: 5 },
    page: { color: '#6d6d7c', label: 'Page', r: 3.5 },
  };
  const canvas = $('mvCanvas');
  const ctx = canvas.getContext('2d');
  let nodes = [];
  let edges = [];
  let byId = new Map();
  let view = { x: 0, y: 0, k: 1 };
  let selected = null;
  let highlight = null; // Set of ids from a search
  let raf = null;
  let heat = 0;

  $('mvLegend').innerHTML = Object.entries(TYPES).map(([, t]) => `<span><i style="background:${t.color}"></i>${t.label}</span>`).join('') +
    '<span class="lg-sep"></span><span><i class="heat-dot"></i>Warm = visited often, recently or together</span><span><b class="ln"></b>happened</span><span><b class="ln dash"></b>inferred</span>';

  async function load() {
    const g = await skillerr.invoke('mem-graph', { pages: $('mvPages').checked });
    const old = new Map(nodes.map((n) => [n.id, n]));
    nodes = g.nodes.map((n) => ({ ...n, ...(old.get(n.id) ? { x: old.get(n.id).x, y: old.get(n.id).y } : { x: (Math.random() - 0.5) * 400, y: (Math.random() - 0.5) * 400 }), vx: 0, vy: 0 }));
    byId = new Map(nodes.map((n) => [n.id, n]));
    edges = g.edges.filter((e) => byId.has(e.from) && byId.has(e.to)).map((e) => ({ ...e, a: byId.get(e.from), b: byId.get(e.to) }));
    for (const n of nodes) n.deg = 0;
    for (const e of edges) {
      e.a.deg++;
      e.b.deg++;
    }
    const s = g.stats;
    $('mvStats').textContent = `${s.session} sessions · ${s.note} notes · ${s.skill} skills · ${s.topic} topics · ${s.entity} entities · ${s.page} pages · ${s.edges} links`;
    $('mvEmpty').hidden = nodes.length > 0;
    if (selected && !byId.has(selected.id)) selected = null;
    renderSide();
    kick(1);
  }

  // ---------- layout: a small force simulation ----------
  function step() {
    const k = 0.012 * heat;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy || 0.01;
        if (d2 > 90000) continue;
        const f = 900 / d2;
        dx *= f;
        dy *= f;
        a.vx += dx;
        a.vy += dy;
        b.vx -= dx;
        b.vy -= dy;
      }
    }
    for (const e of edges) {
      const dx = e.b.x - e.a.x;
      const dy = e.b.y - e.a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      // Strong ties (read together often, linked) pull closer, so clusters form on their own.
      const want = e.type === 'visited_in' ? 40 : e.type === 'broader' ? 50 : e.type === 'co_visited' || e.type === 'links_to' ? Math.max(28, 70 - 10 * Math.log2(1 + (e.weight || 1))) : 70;
      const f = ((d - want) / d) * (e.type === 'co_visited' ? 0.03 : 0.06);
      e.a.vx += dx * f;
      e.a.vy += dy * f;
      e.b.vx -= dx * f;
      e.b.vy -= dy * f;
    }
    for (const n of nodes) {
      n.vx -= n.x * 0.002; // gentle pull to the centre
      n.vy -= n.y * 0.002;
      if (n === dragging) continue;
      n.x += Math.max(-20, Math.min(20, n.vx * k * 60));
      n.y += Math.max(-20, Math.min(20, n.vy * k * 60));
      n.vx *= 0.55;
      n.vy *= 0.55;
    }
  }

  function kick(h) {
    heat = Math.max(heat, h);
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function tick() {
    raf = null;
    if (heat > 0.02) {
      step();
      heat *= 0.985;
    }
    draw();
    if (heat > 0.02 || dragging) raf = requestAnimationFrame(tick);
  }

  // ---------- drawing ----------
  function fit() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  const toScreen = (n) => {
    const r = canvas.getBoundingClientRect();
    return { x: r.width / 2 + (n.x + view.x) * view.k, y: r.height / 2 + (n.y + view.y) * view.k };
  };
  const toWorld = (sx, sy) => {
    const r = canvas.getBoundingClientRect();
    return { x: (sx - r.width / 2) / view.k - view.x, y: (sy - r.height / 2) / view.k - view.y };
  };

  function draw() {
    const r = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    const css = getComputedStyle(document.body);
    const line = css.getPropertyValue('--line-2').trim() || 'rgba(255,255,255,.12)';
    const text = css.getPropertyValue('--text-2').trim() || '#a4a4b2';
    const focus = selected ? new Set([selected.id, ...edges.filter((e) => e.a === selected || e.b === selected).flatMap((e) => [e.a.id, e.b.id])]) : null;
    const lit = (n) => (highlight ? highlight.has(n.id) : focus ? focus.has(n.id) : true);
    // Heat first, underneath everything: warm glows where attention concentrates.
    if ($('mvHeat').checked) {
      ctx.globalCompositeOperation = 'lighter';
      for (const n of nodes) {
        if (!n.heat || n.heat < 0.08) continue;
        const p = toScreen(n);
        const rad = (18 + 60 * n.heat) * Math.max(0.5, Math.min(1.8, view.k));
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
        g.addColorStop(0, `rgba(251, 146, 60, ${0.34 * n.heat})`);
        g.addColorStop(1, 'rgba(251, 146, 60, 0)');
        ctx.fillStyle = g;
        ctx.globalAlpha = lit(n) ? 1 : 0.3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    for (const e of edges) {
      const a = toScreen(e.a);
      const b = toScreen(e.b);
      ctx.strokeStyle = line;
      ctx.globalAlpha = lit(e.a) && lit(e.b) ? 1 : 0.15;
      ctx.lineWidth = e.source === 'inferred' ? 1 : Math.min(4, 1 + Math.log2(e.weight || 1) * 0.8);
      ctx.setLineDash(e.source === 'inferred' ? [4, 4] : []);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const n of nodes) {
      const p = toScreen(n);
      const t = TYPES[n.type] || TYPES.page;
      const rad = (t.r + Math.min(6, Math.sqrt(n.deg || 0))) * Math.max(0.6, Math.min(1.6, view.k));
      ctx.globalAlpha = lit(n) ? 1 : 0.18;
      ctx.fillStyle = t.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
      ctx.fill();
      if (n === selected) {
        ctx.strokeStyle = text;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      const showLabel = n.type !== 'page' || view.k > 1.4 || n === selected || (highlight && highlight.has(n.id));
      if (showLabel && lit(n)) {
        ctx.fillStyle = text;
        ctx.font = `${n.type === 'topic' || n.type === 'session' ? 600 : 400} 11.5px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillText(trunc(n.type === 'topic' ? n.label.split(' > ').pop() : n.label, 34), p.x + rad + 4, p.y + 4);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- details ----------
  function renderSide() {
    const side = $('mvSide');
    side.hidden = !selected;
    if (!selected) return;
    const n = selected;
    const t = TYPES[n.type] || TYPES.page;
    const links = edges.filter((e) => e.a === n || e.b === n).map((e) => ({ e, other: e.a === n ? e.b : e.a }));
    side.innerHTML = `<button type="button" class="mv-close" title="Close">${icon('x', 14)}</button><div class="mv-kind"><i style="background:${t.color}"></i>${t.label}${n.kind ? ` · ${esc(n.kind)}` : ''}</div>
      <h3>${esc(n.label)}</h3>
      ${n.summary ? `<p class="muted">${esc(n.summary)}</p>` : ''}
      <div class="muted small">${n.when ? `Last updated ${esc(n.when)}` : ''}${n.controller ? ` · by ${esc(n.controller)}` : ''}</div>
      <div class="mv-acts"></div>
      <div class="mv-links-h">${links.length} connection${links.length === 1 ? '' : 's'}</div>
      <ul class="mv-links">${links.slice(0, 40).map((l, i) => `<li data-i="${i}"><i style="background:${(TYPES[l.other.type] || TYPES.page).color}"></i><span>${esc(trunc(l.other.label, 44))}</span><em>${esc(l.e.type.replace('_', ' '))}${l.e.source === 'inferred' ? ' · inferred' : ''}</em></li>`).join('')}</ul>`;
    side.querySelectorAll('.mv-links li').forEach((li) => (li.onclick = () => select(links[+li.dataset.i].other, true)));
    side.querySelector('.mv-close').onclick = () => select(null);
    const acts = side.querySelector('.mv-acts');
    const add = (label, cls, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn sm ' + cls;
      b.innerHTML = label;
      b.onclick = fn;
      acts.appendChild(b);
    };
    if (n.file) add(`${icon('doc', 12)}Open`, 'ghost', () => skillerr.send('open-output', { file: n.file }));
    if (n.url) add(`${icon('globe', 12)}Open page`, 'ghost', () => skillerr.send('open-url', n.url));
    add(`${icon('trash', 12)}Forget`, 'ghost', async () => {
      await skillerr.invoke('mem-forget-node', n.id);
      selected = null;
      load();
    });
  }

  function select(n, center) {
    selected = n;
    highlight = null;
    if (center && n) view = { ...view, x: -n.x, y: -n.y };
    renderSide();
    draw();
  }

  // ---------- interaction ----------
  let dragging = null;
  let panning = null;
  let moved = false;
  const hit = (sx, sy) => {
    let best = null;
    let bd = 14;
    for (const n of nodes) {
      const p = toScreen(n);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  };
  canvas.addEventListener('mousedown', (e) => {
    const r = canvas.getBoundingClientRect();
    const n = hit(e.clientX - r.left, e.clientY - r.top);
    moved = false;
    if (n) {
      dragging = n;
      kick(0.3);
    } else panning = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging && !panning) return;
    moved = true;
    const r = canvas.getBoundingClientRect();
    if (dragging) {
      const w = toWorld(e.clientX - r.left, e.clientY - r.top);
      dragging.x = w.x;
      dragging.y = w.y;
    } else {
      view.x = panning.vx + (e.clientX - panning.x) / view.k;
      view.y = panning.vy + (e.clientY - panning.y) / view.k;
      draw();
    }
  });
  window.addEventListener('mouseup', () => {
    if (dragging && !moved) select(dragging);
    else if (panning && !moved) select(null);
    dragging = null;
    panning = null;
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.k = Math.max(0.25, Math.min(4, view.k * Math.exp(-e.deltaY * 0.0015)));
    draw();
  }, { passive: false });

  $('mvPages').onchange = load;
  $('mvHeat').onchange = draw;
  $('mvSearch').onsubmit = async (e) => {
    e.preventDefault();
    const q = $('mvQuery').value.trim();
    if (!q) {
      highlight = null;
      return draw();
    }
    const results = await skillerr.invoke('mem-recall', q);
    highlight = new Set();
    for (const r of results) {
      highlight.add(r.id);
      for (const ed of edges) if (ed.a.id === r.id || ed.b.id === r.id) highlight.add(ed.a.id === r.id ? ed.b.id : ed.a.id);
    }
    const top = results.length && byId.get(results[0].id);
    if (top) {
      selected = top;
      view = { ...view, x: -top.x, y: -top.y };
      renderSide();
    }
    draw();
  };

  // ---------- Folders: the research taxonomy as a tree ----------
  let mode = 'map';
  let tree = [];
  let openFolder = null;
  const expanded = new Set();
  const FICON = { session: '◎', note: '✎', skill: '✦', page: '↗' };

  function setMode(m) {
    mode = m;
    document.querySelectorAll('#mvMode button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    document.querySelector('.mv-body').hidden = m !== 'map';
    $('mvBottom').hidden = m !== 'map';
    $('mvFolders').hidden = m !== 'folders';
    if (m === 'folders') loadFolders();
    else {
      // Back to the map: start clean, not stuck on an old search highlight or selection.
      highlight = null;
      selected = null;
      $('mvQuery').value = '';
      renderSide();
      view = { x: 0, y: 0, k: 1 };
      fit();
      load();
    }
  }
  document.querySelectorAll('#mvMode button').forEach((b) => (b.onclick = () => setMode(b.dataset.m)));
  skillerr.on('memory-mode', async (m) => {
    const { mode: next, query } = typeof m === 'string' ? { mode: m } : m;
    setMode(next);
    if (next !== 'folders' || !query) return;
    await loadFolders();
    const q = query.toLowerCase();
    const all = [];
    const walk = (list) => list.forEach((f) => (all.push(f), walk(f.children)));
    walk(tree);
    const hit = all.find((f) => f.name.toLowerCase() === q) || all.find((f) => f.path.toLowerCase().includes(q));
    if (hit) reveal(hit.id);
  });

  const findF = (list, id) => {
    for (const f of list) {
      if (f.id === id) return f;
      const hit = findF(f.children, id);
      if (hit) return hit;
    }
    return null;
  };

  async function loadFolders() {
    tree = await skillerr.invoke('mem-taxonomy');
    if (!openFolder && tree[0]) {
      openFolder = tree[0].id;
      expanded.add(tree[0].id);
    }
    renderTree();
    renderFolder();
  }

  function renderTree() {
    const box = $('fdTree');
    box.innerHTML = tree.length ? '<div class="fd-root"><button type="button" class="btn ghost sm" id="fdRootOpen">Open all research folders</button></div>'
      : '<div class="muted small" style="padding:12px">Folders appear once research is filed under topics (your AI does this at the end of a research task).</div>';
    const add = (f, depth) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'fd-row' + (f.id === openFolder ? ' on' : '');
      row.style.paddingLeft = `${10 + depth * 16}px`;
      row.innerHTML = `<span class="fd-caret">${f.children.length ? (expanded.has(f.id) ? '▾' : '▸') : ''}</span><span class="fd-ic">📁</span><span class="fd-name">${esc(f.name)}</span><span class="fd-n">${f.total}</span>`;
      row.onclick = (e) => {
        if (e.target.classList.contains('fd-caret') || f.id === openFolder) {
          if (expanded.has(f.id)) expanded.delete(f.id);
          else expanded.add(f.id);
        } else expanded.add(f.id);
        openFolder = f.id;
        renderTree();
        renderFolder();
      };
      box.appendChild(row);
      if (expanded.has(f.id)) for (const c of f.children) add(c, depth + 1);
    };
    for (const f of tree) add(f, 0);
    $('fdRootOpen')?.addEventListener('click', () => skillerr.invoke('mem-folders-root'));
  }

  function reveal(id) {
    // expand every ancestor so the folder is visible in the tree
    const parts = id.split('>');
    for (let i = 1; i <= parts.length; i++) expanded.add(parts.slice(0, i).join('>'));
    openFolder = id;
    renderTree();
    renderFolder();
  }

  function renderFolder() {
    const box = $('fdDetail');
    const f = openFolder && findF(tree, openFolder);
    if (!f) {
      box.innerHTML = '';
      return;
    }
    const crumbs = f.path.split(' > ');
    const group = (t, title) => {
      const list = f.items.filter((i) => i.type === t);
      if (!list.length) return '';
      return `<h4>${title} <span class="muted">${list.length}</span></h4><ul class="fd-items">${list.slice(0, 60).map((i, k) =>
        `<li data-t="${t}" data-k="${k}"><span class="fd-ti">${FICON[t]}</span><span class="fd-l">${esc(trunc(i.label, 90))}${i.summary ? `<em>${esc(trunc(i.summary, 120))}</em>` : ''}</span><span class="muted fd-w">${esc(i.when)}</span></li>`).join('')}</ul>`;
    };
    box.innerHTML = `<div class="fd-crumbs">${crumbs.map((c, i) => `<button type="button" data-p="${esc(crumbs.slice(0, i + 1).join(' > '))}">${esc(c)}</button>`).join('<span>›</span>')}</div>
      <h3>${esc(f.name)}</h3>
      <div class="fd-actions"></div>
      ${f.children.length ? `<h4>Folders inside</h4><div class="fd-chips">${f.children.map((c) => `<button type="button" class="fd-chip" data-id="${esc(c.id)}">📁 ${esc(c.name)} <span>${c.total}</span></button>`).join('')}</div>` : ''}
      ${f.linked.length ? `<h4>Linked folders</h4><div class="fd-chips">${f.linked.map((l) => `<button type="button" class="fd-chip link" data-id="${esc(l.id)}">↔ ${esc(l.path)} <span>${l.shared}</span></button>`).join('')}</div>` : ''}
      ${group('session', 'Research sessions')}${group('note', 'Notes')}${group('skill', 'Skills')}${group('page', 'Pages read')}`;
    const acts = box.querySelector('.fd-actions');
    const mk = (label, cls, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn sm ' + cls;
      b.innerHTML = label;
      b.onclick = fn;
      acts.appendChild(b);
      return b;
    };
    mk(`${icon('folder', 12)}Open folder`, 'ghost', () => skillerr.invoke('mem-folder-open', f.id));
    const cp = mk(`${icon('sparkle', 12)}Copy prompt for your AI`, 'primary', async () => {
      const text = await skillerr.invoke('mem-folder-prompt', f.id);
      cp.innerHTML = `${icon('check', 12)}Copied`;
      cp.title = text;
      setTimeout(() => (cp.innerHTML = `${icon('sparkle', 12)}Copy prompt for your AI`), 1800);
    });
    mk(`${icon('eye', 12)}Show on map`, 'ghost', async () => {
      setMode('map');
      await load();
      $('mvQuery').value = f.name;
      $('mvSearch').requestSubmit();
    });
    box.querySelectorAll('.fd-crumbs button').forEach((b) => (b.onclick = () => reveal('topic:' + b.dataset.p.split(' > ').map((x) => x.toLowerCase().replace(/\s+/g, ' ').trim()).join('>'))));
    box.querySelectorAll('.fd-chip').forEach((b) => (b.onclick = () => reveal(b.dataset.id)));
    box.querySelectorAll('.fd-items li').forEach((li) => {
      const it = f.items.filter((i) => i.type === li.dataset.t)[+li.dataset.k];
      li.onclick = () => (it.file ? skillerr.send('open-output', { file: it.file }) : it.url ? skillerr.send('open-url', it.url) : null);
      if (!it.file && !it.url) li.classList.add('plain');
    });
  }

  new ResizeObserver(fit).observe(canvas);
  skillerr.on('memory-search', async (q) => {
    await load();
    $('mvQuery').value = q;
    $('mvSearch').requestSubmit();
  });
  window.memoryView = {
    show() {
      if (mode === 'folders') loadFolders();
      else {
        fit();
        load();
      }
    },
  };
})();
