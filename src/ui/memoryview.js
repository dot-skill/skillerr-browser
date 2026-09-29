/* global skillerr, icon, esc, trunc */
// History: everything the user and their AI apps looked into, as light pouring out of Kilr (canvas, no libraries).
// Kilr sits at the centre as a cracked metal star; every page, trail and research session comes out of it as a thin
// ray. The more there is, the brighter it burns (glow from the history-graph IPC, log scale). Colour is a VIBGYOR
// spectrum around the orb: the user's own on the warm side, their AIs' on the cool side, what both touched in green.
// Drag the background to pan, scroll to zoom, drag a node to move it, click it for details, click the orb for Kilr.
(() => {
  const $ = (id) => document.getElementById(id);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => reducedMotion.matches;
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const fmt = (n) => (n || 0).toLocaleString();

  // Small deterministic randomness, so the same history always lays out the same way.
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // =====================================================================================================
  // Kilr, the orb: a metal ball full of micro-holes and a few cracks, lit from inside like a dying star.
  // I (0…1) is how hot it burns: 0 is a cold ball with faint embers, 1 blazes through every hole and crack.
  // =====================================================================================================
  const KilrOrb = (() => {
    const r = rng(20260928);
    const holes = [];
    const N = 420;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - ((i + 0.5) / N) * 2;
      const rad = Math.sqrt(1 - y * y);
      const th = golden * i + (r() - 0.5) * 0.35;
      let x = Math.cos(th) * rad;
      let z = Math.sin(th) * rad;
      let yy = y + (r() - 0.5) * 0.04;
      const l = Math.hypot(x, yy, z);
      x /= l; yy /= l; z /= l;
      holes.push({ x, y: yy, z, s: 0.011 + r() ** 2.2 * 0.026, ph: r() * TAU, f: 0.5 + r() * 2.4 });
    }
    // Cracks: jagged walks over the surface, a few with a branch.
    const cracks = [];
    const norm = (v) => {
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    function walk(p, d, steps, width) {
      const pts = [p];
      for (let s = 0; s < steps; s++) {
        const len = 0.03 + r() * 0.05;
        let np = norm([p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len]);
        let nd = norm([d[0] - np[0] * dot(d, np), d[1] - np[1] * dot(d, np), d[2] - np[2] * dot(d, np)]);
        const turn = (r() - 0.5) * 1.9;
        const c = cross(np, nd);
        nd = norm([nd[0] * Math.cos(turn) + c[0] * Math.sin(turn), nd[1] * Math.cos(turn) + c[1] * Math.sin(turn), nd[2] * Math.cos(turn) + c[2] * Math.sin(turn)]);
        pts.push(np);
        if (s === Math.floor(steps / 2) && r() < 0.7) {
          const bd = norm([c[0] + nd[0] * 0.3, c[1] + nd[1] * 0.3, c[2] + nd[2] * 0.3]);
          cracks.push({ pts: walk(np, r() < 0.5 ? bd : bd.map((v) => -v), Math.floor(steps / 2), width * 0.6).pts, w: width * 0.6 });
        }
        p = np;
        d = nd;
      }
      return { pts, w: width };
    }
    const starts = [[0.2, -0.1, 0.97], [-0.6, 0.2, 0.77], [0.7, 0.45, 0.55], [-0.2, 0.75, 0.6], [0.1, 0.2, -0.97], [-0.8, -0.5, -0.3],
      [0.55, -0.7, 0.4], [-0.3, -0.8, 0.5], [0.9, -0.1, -0.4], [-0.95, 0.1, 0.2], [0.3, 0.9, -0.3]];
    for (const s of starts) {
      const p = norm(s);
      const t = norm(cross(p, [r() - 0.5, r() - 0.5, r() - 0.5]));
      cracks.push(walk(p, t, 14 + Math.floor(r() * 14), 0.8 + r() * 0.9));
    }
    // Corona flares for a history past a typical one.
    const flares = Array.from({ length: 14 }, (_, i) => ({ a: (i / 14) * TAU + r() * 0.3, l: 0.6 + r() * 1.4, w: 0.03 + r() * 0.05, sp: (r() - 0.5) * 0.08, ph: r() * TAU }));

    // Light temperature: dull ember red → orange → white-gold.
    const STOPS = [[0, [110, 18, 8]], [0.25, [235, 60, 18]], [0.5, [255, 128, 45]], [0.75, [255, 196, 120]], [1, [255, 244, 222]]];
    function temp(I) {
      I = clamp(I, 0, 1);
      for (let i = 1; i < STOPS.length; i++) {
        if (I <= STOPS[i][0]) {
          const [a, ca] = STOPS[i - 1];
          const [b, cb] = STOPS[i];
          const t = (I - a) / (b - a);
          return [0, 1, 2].map((k) => Math.round(ca[k] + (cb[k] - ca[k]) * t));
        }
      }
      return STOPS[STOPS.length - 1][1];
    }
    const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${clamp(a, 0, 1).toFixed(3)})`;
    const glowSprites = new Map();
    function glowSprite(q) {
      let s = glowSprites.get(q);
      if (s) return s;
      s = document.createElement('canvas');
      s.width = s.height = 32;
      const g = s.getContext('2d');
      const c = temp(q / 15);
      const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, rgba(c, 1));
      gr.addColorStop(0.3, rgba(c, 0.35));
      gr.addColorStop(1, rgba(c, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, 32, 32);
      glowSprites.set(q, s);
      return s;
    }

    // How hot it burns right now: glow plus a slow, uneven throb, like a star near its end.
    function intensity(glow, t) {
      const base = 0.07 + 0.93 * glow;
      if (still()) return base;
      const throb = 0.6 * Math.sin(t * 1.1) + 0.3 * Math.sin(t * 2.9 + 1.3) + 0.1 * Math.sin(t * 7.3);
      const flare = Math.max(0, Math.sin(t * 0.37)) ** 24 * 0.25; // now and then it flares
      return clamp(base * (1 + 0.1 * throb + flare), 0, 1.1);
    }

    function project(v, ca, sa, cb, sb) {
      const x = v[0] * ca + v[2] * sa;
      const z1 = -v[0] * sa + v[2] * ca;
      const y = v[1] * cb - z1 * sb;
      const z = v[1] * sb + z1 * cb;
      return [x, y, z];
    }

    // Bloom: the light that escapes, drawn underneath and around the ball.
    function bloom(ctx, cx, cy, R, I, extra = 0) {
      const c = temp(I);
      const reach = R * (1.8 + 6.5 * I + 3 * extra);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, reach);
      g.addColorStop(0, rgba(c, 0.08 + 0.62 * I));
      g.addColorStop(0.1, rgba(temp(I * 0.85), 0.05 + 0.4 * I));
      g.addColorStop(0.3, rgba(temp(I * 0.45), 0.03 + 0.12 * I));
      g.addColorStop(0.6, `rgba(120,90,255,${(0.05 * I + 0.02 * extra).toFixed(3)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - reach, cy - reach, reach * 2, reach * 2);
      if (extra > 0.01) {
        const t = performance.now() / 1000;
        for (const f of flares) {
          const a = f.a + (still() ? 0 : t * f.sp);
          const len = R * (1.2 + f.l * (0.6 + 1.6 * extra)) * (still() ? 1 : 0.85 + 0.15 * Math.sin(t * 0.8 + f.ph));
          const w = f.w * R;
          const gx = cx + Math.cos(a) * (R + len);
          const gy = cy + Math.sin(a) * (R + len);
          const lg = ctx.createLinearGradient(cx, cy, gx, gy);
          lg.addColorStop(0, rgba(c, 0));
          lg.addColorStop(R / (R + len), rgba(c, 0.5 * extra));
          lg.addColorStop(1, rgba(c, 0));
          ctx.fillStyle = lg;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a + Math.PI / 2) * w, cy + Math.sin(a + Math.PI / 2) * w);
          ctx.lineTo(gx, gy);
          ctx.lineTo(cx + Math.cos(a - Math.PI / 2) * w, cy + Math.sin(a - Math.PI / 2) * w);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // The ball itself.
    function ball(ctx, cx, cy, R, I, t) {
      const spin = still() ? 0.6 : t * 0.06;
      const ca = Math.cos(spin);
      const sa = Math.sin(spin);
      const tilt = 0.38;
      const cb = Math.cos(tilt);
      const sb = Math.sin(tilt);
      const c = temp(I);
      ctx.save();
      // metal body: dark gunmetal, lit from the top left
      const body = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R * 1.02);
      body.addColorStop(0, '#5d6270');
      body.addColorStop(0.45, '#2a2d36');
      body.addColorStop(0.85, '#111217');
      body.addColorStop(1, '#070709');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.fill();
      ctx.clip();
      // what polished metal reflects: a pale sky above a curved horizon, dark ground below
      // (the hotter it burns inside, the more the shell turns to a silhouette against its own light)
      const dim = 1 - 0.3 * clamp(I, 0, 1);
      const sky = ctx.createLinearGradient(cx, cy - R, cx, cy + R * 0.05);
      sky.addColorStop(0, `rgba(200,206,222,${0.5 * dim})`);
      sky.addColorStop(0.55, `rgba(120,124,140,${0.3 * dim})`);
      sky.addColorStop(1, `rgba(70,72,84,${0.08 * dim})`);
      ctx.fillStyle = sky;
      ctx.beginPath();
      ctx.arc(cx, cy, R, Math.PI, TAU);
      ctx.ellipse(cx, cy - R * 0.02, R, R * 0.3, 0, 0, Math.PI, false);
      ctx.fill();
      const ground = ctx.createLinearGradient(cx, cy + R * 0.1, cx, cy + R);
      ground.addColorStop(0, 'rgba(0,0,0,0.35)');
      ground.addColorStop(0.75, 'rgba(0,0,0,0.1)');
      ground.addColorStop(1, 'rgba(90,70,60,0.25)');
      ctx.fillStyle = ground;
      ctx.beginPath();
      ctx.ellipse(cx, cy - R * 0.02, R, R * 0.3, 0, 0, Math.PI, false);
      ctx.arc(cx, cy, R, Math.PI, 0, true);
      ctx.fill();
      // the horizon glints; the lower rim catches the star's own glow bouncing back
      const hz = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
      hz.addColorStop(0, 'rgba(255,255,255,0)');
      hz.addColorStop(0.3, `rgba(230,236,255,${0.28 * dim})`);
      hz.addColorStop(0.7, `rgba(230,236,255,${0.12 * dim})`);
      hz.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = hz;
      ctx.lineWidth = Math.max(0.6, R * 0.012);
      ctx.beginPath();
      ctx.ellipse(cx, cy - R * 0.02, R * 0.98, R * 0.3, 0, 0.1, Math.PI - 0.1, false);
      ctx.stroke();
      const bounce = ctx.createRadialGradient(cx + R * 0.1, cy + R * 1.25, R * 0.5, cx + R * 0.1, cy + R * 1.1, R * 0.95);
      bounce.addColorStop(0, rgba(c, 0.05 + 0.3 * I));
      bounce.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = bounce;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      // darker toward the rim, like a sphere
      const edge = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
      edge.addColorStop(0, 'rgba(0,0,0,0)');
      edge.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = edge;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      if (I > 0.3) {
        ctx.fillStyle = `rgba(10,5,3,${(0.35 * (I - 0.3)).toFixed(3)})`;
        ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      }
      // brushed-metal banding
      if (ctx.createConicGradient) {
        const cg = ctx.createConicGradient(spin * 0.5 - 0.6, cx, cy);
        for (let i = 0; i <= 12; i++) cg.addColorStop(i / 12, i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)');
        ctx.fillStyle = cg;
        ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      }
      // the star's light warming the underside of the metal from the rim
      const warm = ctx.createRadialGradient(cx + R * 0.45, cy + R * 0.55, R * 0.2, cx + R * 0.2, cy + R * 0.3, R * 1.1);
      warm.addColorStop(0, rgba(c, 0.02 + 0.12 * I));
      warm.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = warm;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

      // holes: first the pits, then the light inside them
      const vis = [];
      for (const h of holes) {
        const p = project([h.x, h.y, h.z], ca, sa, cb, sb);
        if (p[2] <= 0.05) continue;
        vis.push({ h, x: cx + p[0] * R, y: cy + p[1] * R, z: p[2], rot: Math.atan2(p[1], p[0]), rr: h.s * R });
      }
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.beginPath();
      for (const v of vis) {
        const rx = Math.max(0.35, v.rr * v.z);
        ctx.moveTo(v.x + Math.cos(v.rot) * rx, v.y + Math.sin(v.rot) * rx);
        ctx.ellipse(v.x, v.y, rx, Math.max(0.5, v.rr), v.rot, 0, TAU);
      }
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      const levels = [[], [], [], []];
      for (const v of vis) {
        const fl = still() ? 0.85 : 0.72 + 0.28 * Math.sin(t * v.h.f + v.h.ph);
        v.b = clamp(I * fl * Math.pow(v.z, 0.6), 0, 1);
        levels[Math.min(3, Math.floor(v.b * 4))].push(v);
      }
      levels.forEach((list, li) => {
        if (!list.length) return;
        ctx.fillStyle = rgba(temp(clamp(((li + 1) / 4) * I * 1.1 + 0.3 * I + 0.1, 0, 1)), 0.45 + 0.55 * Math.min(1, I * 1.6 + 0.2));
        ctx.beginPath();
        for (const v of list) {
          const rx = Math.max(0.35, v.rr * v.z * 0.75);
          ctx.moveTo(v.x + Math.cos(v.rot) * rx, v.y + Math.sin(v.rot) * rx);
          ctx.ellipse(v.x, v.y, rx, Math.max(0.45, v.rr * 0.75), v.rot, 0, TAU);
        }
        ctx.fill();
      });
      if (I > 0.12) {
        for (const v of vis) {
          if (v.b < 0.08) continue;
          const g = v.rr * (1.1 + 3.2 * v.b) + 0.6;
          ctx.globalAlpha = clamp(v.b * 0.75, 0, 1);
          ctx.drawImage(glowSprite(Math.round(clamp(v.b, 0, 1) * 15)), v.x - g, v.y - g, g * 2, g * 2);
        }
        ctx.globalAlpha = 1;
      }

      // cracks
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const segs = [];
      for (const cr of cracks) {
        let prev = null;
        cr.pts.forEach((pt, i) => {
          const p = project(pt, ca, sa, cb, sb);
          const cur = { x: cx + p[0] * R, y: cy + p[1] * R, z: p[2], taper: Math.sin(((i + 0.5) / cr.pts.length) * Math.PI) };
          if (prev && prev.z > 0 && cur.z > 0) segs.push({ a: prev, b: cur, w: cr.w * (0.35 + 0.65 * cur.taper) * Math.min(1, (prev.z + cur.z) * 0.8) });
          prev = cur;
        });
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      for (const s of segs) {
        ctx.lineWidth = s.w * R * 0.035 + 0.8;
        ctx.beginPath();
        ctx.moveTo(s.a.x, s.a.y);
        ctx.lineTo(s.b.x, s.b.y);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'lighter';
      const passes = [[0.06, 0.1 + 0.22 * I, temp(I * 0.6)], [0.022, 0.3 + 0.55 * I, temp(I * 0.85)], [0.008, 0.25 + 0.75 * I, temp(Math.min(1, I + 0.15))]];
      for (const [wk, a, col] of passes) {
        ctx.strokeStyle = rgba(col, a * (I < 0.1 ? 0.6 : 1));
        for (const s of segs) {
          ctx.lineWidth = Math.max(0.6, s.w * R * wk);
          ctx.beginPath();
          ctx.moveTo(s.a.x, s.a.y);
          ctx.lineTo(s.b.x, s.b.y);
          ctx.stroke();
        }
      }

      // shadow side, then the specular highlight and the rim
      ctx.globalCompositeOperation = 'source-over';
      const shade = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.4, cx, cy, R * 1.05);
      shade.addColorStop(0, 'rgba(0,0,0,0)');
      shade.addColorStop(1, 'rgba(0,0,0,0.38)');
      ctx.fillStyle = shade;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      ctx.globalCompositeOperation = 'lighter';
      const spec = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.48, 0, cx - R * 0.4, cy - R * 0.48, R * 0.36);
      spec.addColorStop(0, 'rgba(255,255,255,0.32)');
      spec.addColorStop(0.3, 'rgba(255,255,255,0.08)');
      spec.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = spec;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.ellipse(cx - R * 0.43, cy - R * 0.52, R * 0.075, R * 0.032, -0.75, 0, TAU);
      ctx.fill();
      ctx.restore();
      // rim: cool sky light at the top left, the star's own light bleeding round the bottom right
      ctx.save();
      const rim = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      rim.addColorStop(0, 'rgba(190,205,255,0.45)');
      rim.addColorStop(0.5, 'rgba(255,255,255,0.04)');
      rim.addColorStop(1, rgba(c, 0.25 + 0.6 * I));
      ctx.strokeStyle = rim;
      ctx.lineWidth = Math.max(1, R * 0.025);
      ctx.beginPath();
      ctx.arc(cx, cy, R - ctx.lineWidth / 2, 0, TAU);
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(cx, cy, R * 0.97, cx, cy, R * (1.12 + 0.18 * I));
      halo.addColorStop(0, rgba(c, 0.1 + 0.55 * I));
      halo.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, R * (1.12 + 0.18 * I), 0, TAU);
      ctx.arc(cx, cy, R * 0.97, 0, TAU, true);
      ctx.fill();
      ctx.restore();
    }

    function draw(ctx, cx, cy, R, glow, t, { extra = 0, withBloom = true, withBall = true } = {}) {
      const I = intensity(glow, t);
      if (withBloom) bloom(ctx, cx, cy, R, Math.min(1, I), extra);
      if (withBall) ball(ctx, cx, cy, R, Math.min(1, I), t);
      return I;
    }
    return { draw, temp, intensity };
  })();
  window.KilrOrb = KilrOrb;

  // =====================================================================================================
  // Colour: a VIBGYOR spectrum round the orb.
  // =====================================================================================================
  const HUES = { you: [0, 52], both: [96, 150], ai: [208, 288] };
  const OFFSIDE = { you: 26, both: 128, ai: 236 }; // a node whose owner differs from its trail's
  const TYPE_LABEL = { page: 'Page', trail: 'Trail', session: 'Research session', note: 'Note', skill: 'Skill', topic: 'Topic', entity: 'Entity' };
  const HUB = { trail: 3, session: 2, topic: 1 };
  const bucketOf = (h) => Math.round(((h % 360) + 360) % 360 / 4) % 90;
  const hueOfBucket = (b) => b * 4;
  const whose = (n) => (n.origin === 'you' ? 'Yours' : n.origin === 'both' ? 'Yours and your AI\'s' : n.by ? `${n.by}’s` : 'Your AI\'s');

  const sprites = new Map();
  function nodeSprite(b) {
    let s = sprites.get(b);
    if (s) return s;
    const h = hueOfBucket(b);
    s = document.createElement('canvas');
    s.width = s.height = 64;
    const g = s.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.1, `hsla(${h},100%,82%,1)`);
    gr.addColorStop(0.24, `hsla(${h},100%,62%,0.55)`);
    gr.addColorStop(0.5, `hsla(${h},100%,55%,0.14)`);
    gr.addColorStop(1, `hsla(${h},100%,50%,0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    sprites.set(b, s);
    return s;
  }

  // =====================================================================================================
  // State
  // =====================================================================================================
  const body = document.querySelector('#memView .mv-body');
  const canvas = $('mvCanvas');
  const ctx = canvas.getContext('2d');
  const fx = $('hvFx');
  const fctx = fx.getContext('2d');
  const tip = $('hvTip');
  const orbCanvas = $('hvOrb');
  const octx = orbCanvas.getContext('2d');
  let orbSize = 0;
  const ORB_R = 64;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let nodes = [];
  let edges = [];
  let byId = new Map();
  let groups = [];
  let data = { totals: { you: 0, ai: 0, both: 0, all: 0 }, glow: 0, glowFull: 10000, glowMax: 20000 };
  let view = { x: 0, y: 0, k: 1 };
  let selected = null;
  let hover = null;
  let hoverOrb = false;
  let highlight = null; // Set of ids from a search
  let filter = 'all';
  let visible = false;
  let raf = 0;
  let dirty = true;
  let emerging = false;
  let relaxFrames = 0;
  let glowShown = 0;
  let photons = [];
  let lastPhoton = 0;
  let lastLoad = 0;
  let mode = 'map';
  const stars = (() => {
    const r = rng(7);
    return Array.from({ length: 320 }, () => ({ x: r(), y: r(), s: r() < 0.08 ? 1.4 : r() < 0.4 ? 0.9 : 0.6, a: 0.12 + r() ** 2 * 0.6, d: 0.02 + r() * 0.06 }));
  })();

  const extraGlow = () => {
    const all = data.totals.all || 0;
    if (all <= data.glowFull) return 0;
    return clamp((Math.log1p(all) - Math.log1p(data.glowFull)) / (Math.log1p(data.glowMax) - Math.log1p(data.glowFull)), 0, 1);
  };
  const matches = (n) => filter === 'all' || n.origin === filter || n.origin === 'both';

  // =====================================================================================================
  // Layout: each trail or research session is a hub with its pages round it; hubs sit in a wedge of the
  // spectrum by whose they are, newest nearest the orb (older light has travelled further).
  // =====================================================================================================
  function layout(fresh, old) {
    const adj = new Map(nodes.map((n) => [n.id, []]));
    for (const e of edges) {
      adj.get(e.from).push(e.b);
      adj.get(e.to).push(e.a);
    }
    const gmap = new Map();
    const groupFor = (key, hub, origin, by) => {
      let g = gmap.get(key);
      if (!g) gmap.set(key, (g = { key, hub, origin, by, members: [], at: hub?.at || '' }));
      return g;
    };
    for (const n of nodes) {
      n.hub = !!HUB[n.type];
      if (n.hub) {
        groupFor(n.id, n, n.origin, n.by).members.push(n);
        n.group = n.id;
      }
    }
    for (const n of nodes) {
      if (n.hub) continue;
      let best = null;
      for (const o of adj.get(n.id)) if (o.hub && (!best || HUB[o.type] > HUB[best.type] || (HUB[o.type] === HUB[best.type] && o.weight > best.weight))) best = o;
      const g = best ? gmap.get(best.id) : groupFor(`~${n.origin}|${n.by || ''}`, null, n.origin, n.by);
      g.members.push(n);
      n.group = g.key;
      n.parent = best;
      if (n.at && n.at > g.at) g.at = n.at;
    }
    // A research session or topic with nothing round it would take a slice of the circle all to itself, and a day of
    // many empty sessions (quick questions, test runs) then lines up as a perfect arc. Pool them per app instead, as a
    // cloud like any other group.
    for (const g of [...gmap.values()]) {
      if (g.members.length !== 1 || !g.hub || g.hub.type === 'trail') continue;
      const pool = groupFor(`~lone|${g.origin}|${g.by || ''}`, null, g.origin, g.by);
      pool.members.push(g.hub);
      g.hub.group = pool.key;
      if (g.hub.at && g.hub.at > pool.at) pool.at = g.hub.at;
      gmap.delete(g.key);
    }
    groups = [...gmap.values()];
    const ORDER = { you: 0, both: 1, ai: 2 };
    // Grouped by whose, then by AI app (each app its own band of colour); within that, in a stable shuffle, so
    // neighbouring trails sit at different distances and the whole reads as a burst, not a spiral.
    for (const g of groups) g.h = hash(g.key);
    groups.sort((a, b) => ORDER[a.origin] - ORDER[b.origin] || String(a.by || '').localeCompare(String(b.by || '')) || a.h - b.h);
    const days = [...new Set(groups.map((g) => g.at || ''))].sort().reverse();
    const ageOf = (at) => (days.length > 1 ? days.indexOf(at || '') / (days.length - 1) : 0);
    const N = nodes.length;
    const R_IN = ORB_R * 2.7;
    const BAND = 30 + Math.sqrt(N) * 8;
    const weight = (g) => 1 + Math.sqrt(g.members.length) * 1.2;
    const present = ['you', 'both', 'ai'].filter((o) => groups.some((g) => g.origin === o));
    const sums = Object.fromEntries(present.map((o) => [o, groups.filter((g) => g.origin === o).reduce((s, g) => s + weight(g), 0)]));
    const total = Object.values(sums).reduce((a, b) => a + b, 0) || 1;
    const gap = present.length > 1 ? 0.06 : 0;
    const shares = Object.fromEntries(present.map((o) => [o, present.length > 1 ? Math.max(0.16, sums[o] / total) : 1]));
    const shareSum = Object.values(shares).reduce((a, b) => a + b, 0) || 1;
    let cursor = -Math.PI / 2 + gap / 2;
    for (const o of present) {
      const arc = (shares[o] / shareSum) * (TAU - gap * present.length);
      const arcStart = cursor;
      const list = groups.filter((g) => g.origin === o);
      for (const g of list) {
        g.span = (weight(g) / sums[o]) * arc;
        g.angle = cursor + g.span / 2;
        cursor += g.span;
        const t = list.length === 1 ? 0.5 : (g.angle - arcStart) / arc;
        const [h0, h1] = HUES[o];
        g.hue = h0 + t * (h1 - h0);
        g.radius = R_IN + ageOf(g.at) * BAND;
      }
      cursor = arcStart + arc + gap;
    }
    for (const g of groups) {
      const m = g.members.length;
      const spread = 18 + Math.sqrt(m) * 15;
      g.members.forEach((n) => {
        const r = rng(hash(n.id));
        n.hue = n.origin === g.origin ? g.hue : OFFSIDE[n.origin];
        n.bucket = bucketOf(n.hue);
        n.r = n.type === 'trail' ? 5 + Math.min(5, Math.sqrt(m) * 0.8) : n.type === 'session' ? 5 : n.type === 'topic' ? 4.2 : n.type === 'page' ? 2 + Math.min(2.2, (n.weight || 1) * 0.35) : 3.2;
        let a;
        let rad;
        if (n === g.hub) {
          a = g.angle;
          rad = g.radius;
        } else {
          a = g.angle + (r() - 0.5) * g.span * 0.9;
          rad = g.radius + (g.hub ? 18 : 0) + r() ** 0.7 * spread;
        }
        n.ax = Math.cos(a) * rad;
        n.ay = Math.sin(a) * rad;
        const prev = old.get(n.id);
        if (prev && !fresh) {
          n.x = prev.x;
          n.y = prev.y;
          n.born = prev.born;
          n.ax = prev.ax;
          n.ay = prev.ay;
        } else {
          n.x = n.ax;
          n.y = n.ay;
          n.born = null;
        }
      });
    }
    relax(70);
  }

  // Position-based relaxation: pull to the anchor, push apart neighbours (spatial grid), keep clear of the orb.
  function relax(iters, pull = 0.08) {
    const cell = 18;
    const keyOf = (x, y) => ((Math.floor(x / cell) + 32768) << 16) | (Math.floor(y / cell) + 32768);
    for (let it = 0; it < iters; it++) {
      const grid = new Map();
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const k = keyOf(n.x, n.y);
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        const cx = Math.floor(a.x / cell);
        const cy = Math.floor(a.y / cell);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const list = grid.get(((cx + dx + 32768) << 16) | (cy + dy + 32768));
            if (!list) continue;
            for (const j of list) {
              if (j <= i) continue;
              const b = nodes[j];
              let ddx = b.x - a.x;
              let ddy = b.y - a.y;
              const want = a.r + b.r + 3;
              const d2 = ddx * ddx + ddy * ddy;
              if (d2 >= want * want) continue;
              let d = Math.sqrt(d2);
              if (d < 0.01) {
                ddx = (hash(a.id + b.id) % 7) - 3 || 1;
                ddy = 1;
                d = Math.hypot(ddx, ddy);
              }
              const push = ((want - d) / d) * 0.5;
              const wa = a.hub ? 0.2 : 1;
              const wb = b.hub ? 0.2 : 1;
              if (a !== dragging) {
                a.x -= ddx * push * wa;
                a.y -= ddy * push * wa;
              }
              if (b !== dragging) {
                b.x += ddx * push * wb;
                b.y += ddy * push * wb;
              }
            }
          }
        }
      }
      const keep = ORB_R + 30;
      for (const n of nodes) {
        if (n === dragging) continue;
        n.x += (n.ax - n.x) * pull;
        n.y += (n.ay - n.y) * pull;
        const d = Math.hypot(n.x, n.y);
        if (d < keep) {
          const f = keep / (d || 1);
          n.x = d ? n.x * f : keep;
          n.y *= d ? f : 1;
        }
      }
    }
  }

  // =====================================================================================================
  // Loading
  // =====================================================================================================
  async function load(fresh = false) {
    let g;
    try {
      g = await skillerr.invoke('history-graph');
    } catch {
      g = { nodes: [], edges: [], totals: { you: 0, ai: 0, both: 0, all: 0 }, glow: 0, glowFull: 10000, glowMax: 20000 };
    }
    lastLoad = Date.now();
    const old = new Map(nodes.map((n) => [n.id, n]));
    const same = !fresh && g.nodes.length === nodes.length && g.nodes.every((n) => old.has(n.id)) && g.edges.length === edges.length;
    data = g;
    if (!highlight) renderStats(); // (a search's "12 found" stays until it's cleared)
    renderLegend();
    if (same) return;
    nodes = g.nodes.map((n) => ({ ...n }));
    byId = new Map(nodes.map((n) => [n.id, n]));
    edges = g.edges.filter((e) => byId.has(e.from) && byId.has(e.to)).map((e) => ({ ...e, a: byId.get(e.from), b: byId.get(e.to) }));
    for (const n of nodes) n.deg = 0;
    for (const e of edges) {
      e.a.deg++;
      e.b.deg++;
    }
    layout(fresh, old);
    renderLegend();
    if (fresh || !old.size) fitView();
    // New light comes out of the orb: everything on a fresh open, only what's new otherwise.
    const now = performance.now();
    const born = nodes.filter((n) => n.born == null);
    if (still()) {
      for (const n of born) n.born = -1e9;
    } else {
      const maxD = Math.max(1, ...born.map((n) => Math.hypot(n.ax, n.ay)));
      for (const n of born) {
        const r = rng(hash(n.id))();
        n.born = now + 150 + (Math.hypot(n.ax, n.ay) / maxD) * (born.length > 40 ? 1500 : 700) + r * 450 - (n.hub ? 250 : 0);
      }
      if (fresh) glowShown = 0;
      emerging = born.length > 0;
    }
    if (selected && !byId.has(selected.id)) selected = null;
    else if (selected) selected = byId.get(selected.id);
    $('mvEmpty').hidden = nodes.length > 0;
    renderSide();
    invalidate();
    drawKilrIcon();
  }

  function fitView() {
    let ext = ORB_R * 2.4;
    for (const n of nodes) ext = Math.max(ext, Math.hypot(n.ax, n.ay) + 30);
    const avail = Math.min(W, H - 120) / 2;
    const k = clamp(avail / ext, 0.18, nodes.length ? 1.25 : 1.35);
    view = { x: 0, y: nodes.length ? 0 : -0.04 * H / k, k };
  }

  function renderStats() {
    const t = data.totals;
    const parts = [`<b>${fmt(t.all)}</b> ${t.all === 1 ? 'thing' : 'things'} looked into`];
    if (t.all) parts.push(`<span class="hv-you">${fmt(t.you + t.both)} yours</span>`, `<span class="hv-ai">${fmt(t.ai + t.both)} your AIs'</span>`);
    if (t.both) parts.push(`<span class="hv-both">${fmt(t.both)} both</span>`);
    if (data.nodes && data.nodes.length < t.all) parts.push(`showing the ${fmt(data.nodes.length)} most connected`);
    $('mvStats').innerHTML = parts.join(' · ');
  }

  function renderLegend() {
    $('mvLegend').innerHTML = `<span class="hv-sw"><i class="hv-grad you"></i>Yours</span><span class="hv-sw"><i class="hv-grad both"></i>Both of you</span><span class="hv-sw"><i class="hv-grad ai"></i>Your AIs'</span>
      ${data.nodes?.length ? '<span class="lg-sep"></span><span class="muted" title="Bright points are trails and research sessions, with their pages round them. The further from the Orb, the longer ago.">Further out is older</span>' : ''}`;
    const t = data.totals.all || 0;
    const pct = clamp(data.glow || 0, 0, 1) * 100;
    const extra = extraGlow();
    $('hvGlow').innerHTML = `<span class="hv-glow-l">The Orb's glow</span><span class="hv-meter" title="Glow grows with everything you and your AIs look into, on a log scale. Full at about ${fmt(data.glowFull)} pages: a typical person's last three months of browsing."><i style="width:${pct.toFixed(1)}%"></i>${extra ? `<b style="width:${(extra * 100).toFixed(1)}%"></b>` : ''}</span><span class="hv-glow-n">${t >= data.glowFull ? `${fmt(t)}: past a typical three months` : `${fmt(t)} of ~${fmt(data.glowFull)}`}</span>`;
  }

  function drawKilrIcon() {
    const c = $('hvKilrIcon');
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    KilrOrb.draw(g, c.width / 2, c.height / 2, c.width * 0.36, Math.max(0.35, data.glow || 0), 1.2, { withBloom: true });
  }

  // =====================================================================================================
  // Drawing. Two canvases: the graph (redrawn only when something moves) and, on top, the orb with its
  // bloom and the light travelling out along the rays (every frame while the page is showing).
  // =====================================================================================================
  function fit() {
    const r = body.getBoundingClientRect();
    if (!r.width || !r.height) return;
    W = r.width;
    H = r.height;
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    for (const c of [canvas, fx]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    orbSize = 0;
    invalidate();
  }
  const sx = (x) => W / 2 + (x + view.x) * view.k;
  const sy = (y) => H / 2 + (y + view.y) * view.k;
  const toWorld = (px, py) => ({ x: (px - W / 2) / view.k - view.x, y: (py - H / 2) / view.k - view.y });
  // Kilr stays a presence even zoomed far out (but never grows over the first ring of trails).
  const orbScreen = () => ({ x: sx(0), y: sy(0), r: Math.max(ORB_R * view.k, Math.min(46, ORB_R * 2.7 * view.k * 0.6)) });
  const easeOut = (p) => 1 - Math.pow(1 - p, 4);

  // Where each node is drawn this frame (on its way out of the orb while emerging).
  function place(now) {
    let out = 0;
    let busy = false;
    for (const n of nodes) {
      const p = n.born == null ? 0 : clamp((now - n.born) / 900, 0, 1);
      if (p < 1) busy = true;
      if (p > 0.5) out++;
      const e = easeOut(p);
      n.p = p;
      n.px = sx(n.x * e);
      n.py = sy(n.y * e);
    }
    emerging = busy;
    return nodes.length ? out / nodes.length : 1;
  }

  function invalidate() {
    dirty = true;
    wake();
  }
  function wake() {
    if (!raf && visible && mode === 'map') raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    raf = 0;
    if (!visible || mode !== 'map' || document.hidden || !W) return;
    if (relaxFrames > 0) {
      relax(2, 0.05);
      relaxFrames--;
      dirty = true;
    }
    if (dirty || emerging) {
      const out = place(now);
      drawGraph(now);
      dirty = false;
      target = (data.glow || 0) * Math.pow(out, 0.8);
    }
    glowShown += (target - glowShown) * (still() ? 1 : 0.04);
    drawFx(now);
    if (!still() || emerging || relaxFrames > 0 || dirty) raf = requestAnimationFrame(frame);
  }
  let target = 0;

  const litOf = () => {
    const focus = selected ? new Set([selected.id, ...edges.filter((e) => e.a === selected || e.b === selected).flatMap((e) => [e.a.id, e.b.id])]) : null;
    return (n) => matches(n) && (highlight ? highlight.has(n.id) : focus ? focus.has(n.id) : true);
  };

  function drawGraph() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // stars, with a touch of parallax
    ctx.fillStyle = '#fff';
    for (const s of stars) {
      const x = (((s.x * W + view.x * view.k * s.d) % W) + W) % W;
      const y = (((s.y * H + view.y * view.k * s.d) % H) + H) % H;
      ctx.globalAlpha = s.a;
      ctx.fillRect(x, y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    if (!nodes.length) return;
    const lit = litOf();
    const o = orbScreen();
    const zoom = clamp(view.k, 0.35, 2.2);
    let far = o.r * 2;
    for (const n of nodes) {
      n.lit = lit(n);
      far = Math.max(far, Math.hypot(n.px - o.x, n.py - o.y));
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    // 1. Rays: a thin line of light from the orb to every node, brightest near the orb.
    const tiers = new Map(); // key: bucket|tier
    for (const n of nodes) {
      if (n.p <= 0) continue;
      const tier = !n.lit ? 0 : n.hub ? 2 : 1;
      const key = n.bucket * 4 + tier;
      let list = tiers.get(key);
      if (!list) tiers.set(key, (list = []));
      list.push(n);
    }
    const dimAll = !!(highlight || selected);
    const pages = nodes.length;
    const baseA = clamp(0.5 / Math.sqrt(Math.max(1, pages / 40)), 0.07, 0.42);
    for (const [key, list] of tiers) {
      const b = Math.floor(key / 4);
      const tier = key % 4;
      const h = hueOfBucket(b);
      const a = tier === 0 ? baseA * (dimAll ? 0.12 : 0.05) : tier === 2 ? Math.min(0.75, baseA * 2.4) : baseA;
      const g = ctx.createRadialGradient(o.x, o.y, o.r * 0.9, o.x, o.y, far);
      g.addColorStop(0, `hsla(${h},100%,82%,${a})`);
      g.addColorStop(0.3, `hsla(${h},100%,66%,${a * 0.55})`);
      g.addColorStop(1, `hsla(${h},100%,60%,${a * 0.22})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = tier === 2 ? 1.1 : 0.7;
      ctx.beginPath();
      for (const n of list) {
        const dx = n.px - o.x;
        const dy = n.py - o.y;
        const d = Math.hypot(dx, dy);
        if (d < o.r) continue;
        ctx.moveTo(o.x + (dx / d) * o.r * 0.92, o.y + (dy / d) * o.r * 0.92);
        ctx.lineTo(n.px, n.py);
      }
      ctx.stroke();
    }

    // 2. Links between nodes: trail to its pages, pages read together, sessions to topics.
    const links = new Map();
    for (const e of edges) {
      if (e.a.p <= 0.6 || e.b.p <= 0.6) continue;
      const on = e.a.lit && e.b.lit;
      const key = e.b.bucket * 2 + (on ? 1 : 0);
      let list = links.get(key);
      if (!list) links.set(key, (list = []));
      list.push(e);
    }
    for (const [key, list] of links) {
      const h = hueOfBucket(Math.floor(key / 2));
      const on = key % 2;
      ctx.strokeStyle = `hsla(${h},100%,70%,${on ? (selected ? 0.5 : 0.2) : 0.03})`;
      ctx.lineWidth = on && selected ? 1 : 0.6;
      ctx.beginPath();
      for (const e of list) {
        ctx.moveTo(e.a.px, e.a.py);
        ctx.lineTo(e.b.px, e.b.py);
      }
      ctx.stroke();
    }

    // 3. Nodes: points of light (a sprite per colour), bigger and hotter while they fly out.
    for (const n of nodes) {
      if (n.p <= 0) continue;
      const heat = 1 + (n.heat || 0) * 0.8;
      let s = n.r * zoom * 4.2 * heat * (1 + (1 - n.p) * 1.6);
      if (n === selected || (highlight && highlight.has(n.id))) s *= 1.5;
      ctx.globalAlpha = n.lit ? 1 : 0.13;
      ctx.drawImage(nodeSprite(n.bucket), n.px - s, n.py - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // 4. Selection ring.
    if (selected && selected.p > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(selected.px, selected.py, selected.r * zoom * 1.6 + 5, 0, TAU);
      ctx.stroke();
    }

    // 5. Labels: hubs (biggest first), then pages when zoomed in, without overlapping each other.
    const placed = [];
    const room = (x, y, w, h) => {
      for (const r of placed) if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) return false;
      if (Math.hypot(x + w / 2 - o.x, y + h / 2 - o.y) < o.r * 1.15) return false;
      placed.push({ x, y, w, h });
      return true;
    };
    const cand = nodes.filter((n) => n.p >= 1 && n.lit && (n === selected || (highlight && highlight.has(n.id)) || n.hub || view.k > 1.5)
      && n.px > -50 && n.px < W + 50 && n.py > -20 && n.py < H + 20);
    cand.sort((a, b) => (b === selected) - (a === selected) || (highlight ? highlight.has(b.id) - highlight.has(a.id) : 0) || (HUB[b.type] || 0) - (HUB[a.type] || 0) || b.deg - a.deg);
    const maxLabels = view.k > 1.5 ? 90 : view.k > 0.8 ? 30 : 14;
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 6;
    let count = 0;
    for (const n of cand) {
      if (count >= maxLabels) break;
      const big = n.hub || n === selected;
      ctx.font = `${big ? 600 : 400} ${big ? 12 : 11}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      const text = trunc(n.type === 'topic' ? String(n.label).split(' > ').pop() : n.label, big ? 34 : 40);
      const w = ctx.measureText(text).width;
      // put labels on the outward side of their node, so they read away from the orb
      const right = n.px >= o.x;
      const off = n.r * zoom + 7;
      const x = right ? n.px + off : n.px - off - w;
      if (!room(x - 2, n.py - 8, w + 4, 16) && n !== selected) continue;
      ctx.fillStyle = `hsla(${n.hue},100%,${big ? 88 : 80}%,${big ? 0.95 : 0.8})`;
      ctx.fillText(text, x, n.py);
      count++;
    }
    ctx.shadowBlur = 0;
  }

  function drawFx(now) {
    const t = now / 1000;
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.clearRect(0, 0, W, H);
    const o = orbScreen();
    const extra = extraGlow() * clamp(glowShown / Math.max(0.01, data.glow || 1), 0, 1);
    // Light travelling out along the rays: more of it the brighter Kilr burns.
    if (!still() && nodes.length) {
      const rate = 3 + 40 * glowShown;
      if (now - lastPhoton > 1000 / rate && photons.length < 90) {
        lastPhoton = now;
        const pool = nodes.filter((n) => n.p >= 1 && n.lit);
        if (pool.length) {
          const n = pool[Math.floor(Math.random() * pool.length)];
          photons.push({ n, t0: now, dur: 900 + Math.random() * 900 });
        }
      }
      fctx.globalCompositeOperation = 'lighter';
      photons = photons.filter((ph) => now - ph.t0 < ph.dur && byId.get(ph.n.id) === ph.n);
      for (const ph of photons) {
        const p = (now - ph.t0) / ph.dur;
        const dx = ph.n.px - o.x;
        const dy = ph.n.py - o.y;
        const d = Math.hypot(dx, dy) || 1;
        const start = o.r * 0.95;
        const pos = start + (d - start) * (p * p);
        const x = o.x + (dx / d) * pos;
        const y = o.y + (dy / d) * pos;
        const tail = Math.min(pos - start, 26 + 30 * p);
        const g = fctx.createLinearGradient(x - (dx / d) * tail, y - (dy / d) * tail, x, y);
        g.addColorStop(0, `hsla(${ph.n.hue},100%,70%,0)`);
        g.addColorStop(1, `hsla(${ph.n.hue},100%,85%,${0.85 * (1 - p * 0.6)})`);
        fctx.strokeStyle = g;
        fctx.lineWidth = 1.3;
        fctx.beginPath();
        fctx.moveTo(x - (dx / d) * tail, y - (dy / d) * tail);
        fctx.lineTo(x, y);
        fctx.stroke();
        const s = 4 + 3 * (1 - p);
        fctx.drawImage(nodeSprite(ph.n.bucket), x - s, y - s, s * 2, s * 2);
      }
      fctx.globalCompositeOperation = 'source-over';
    }
    KilrOrb.draw(fctx, o.x, o.y, o.r, glowShown, t, { extra, withBall: false });
    // The ball on its own small canvas, blended normally, so the metal stays solid in front of its own light.
    const size = Math.ceil(o.r * 2.7);
    if (size !== orbSize) {
      orbSize = size;
      orbCanvas.width = orbCanvas.height = Math.round(size * dpr);
      orbCanvas.style.width = orbCanvas.style.height = `${size}px`;
    }
    orbCanvas.style.transform = `translate(${(o.x - size / 2).toFixed(1)}px, ${(o.y - size / 2).toFixed(1)}px)`;
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, size, size);
    KilrOrb.draw(octx, size / 2, size / 2, o.r, glowShown, t, { withBloom: false });
    if (hoverOrb) {
      fctx.strokeStyle = 'rgba(255,255,255,0.28)';
      fctx.setLineDash([2, 5]);
      fctx.lineWidth = 1;
      fctx.beginPath();
      fctx.arc(o.x, o.y, o.r * 1.35, 0, TAU);
      fctx.stroke();
      fctx.setLineDash([]);
    }
    if (hover && hover !== selected && hover.p >= 1) {
      fctx.strokeStyle = `hsla(${hover.hue},100%,80%,0.9)`;
      fctx.lineWidth = 1.2;
      fctx.beginPath();
      fctx.arc(hover.px, hover.py, hover.r * clamp(view.k, 0.35, 2.2) * 1.6 + 4, 0, TAU);
      fctx.stroke();
    }
  }

  // =====================================================================================================
  // Details panel
  // =====================================================================================================
  function renderSide() {
    const side = $('mvSide');
    side.hidden = !selected;
    if (!selected) return;
    const n = selected;
    const col = `hsl(${n.hue},100%,66%)`;
    const links = edges.filter((e) => e.a === n || e.b === n).map((e) => ({ e, other: e.a === n ? e.b : e.a }));
    let host = '';
    try {
      host = n.url ? new URL(n.url).hostname.replace(/^www\./, '') : '';
    } catch {}
    const trail = n.type === 'trail' ? n : n.parent?.type === 'trail' ? n.parent : null;
    side.innerHTML = `<button type="button" class="mv-close" title="Close">${icon('x', 14)}</button>
      <div class="mv-kind"><i style="background:${col};box-shadow:0 0 8px ${col}"></i>${TYPE_LABEL[n.type] || 'Page'} · ${esc(whose(n))}</div>
      <h3>${esc(n.label)}</h3>
      <div class="muted small">${[host && esc(host), n.at && `Last seen ${esc(n.at)}`, trail && trail !== n && `in “${esc(trunc(trail.label, 40))}”`].filter(Boolean).join(' · ')}</div>
      <div class="mv-acts"></div>
      <div class="mv-links-h">${links.length} connection${links.length === 1 ? '' : 's'}</div>
      <ul class="mv-links">${links.slice(0, 40).map((l, i) => `<li data-i="${i}"><i style="background:hsl(${l.other.hue},100%,66%)"></i><span>${esc(trunc(l.other.label, 44))}</span><em>${esc(String(l.e.type).replace(/_/g, ' '))}${l.e.source === 'inferred' ? ' · inferred' : ''}</em></li>`).join('')}</ul>`;
    side.querySelectorAll('.mv-links li').forEach((li) => (li.onclick = () => select(links[+li.dataset.i].other, true)));
    side.querySelector('.mv-close').onclick = () => select(null);
    const acts = side.querySelector('.mv-acts');
    const add = (label, cls, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn sm ' + cls;
      b.innerHTML = label;
      b.onclick = () => fn(b);
      acts.appendChild(b);
      return b;
    };
    if (n.type === 'trail') add(`${icon('play', 12)}Continue`, 'primary', () => skillerr.invoke('trails-continue', n.trailId));
    if (n.url) add(`${icon('globe', 12)}Open page`, 'ghost', () => skillerr.send('open-url', n.url));
    add(`${icon('trash', 12)}Forget`, 'ghost', async (b) => {
      if (b.dataset.armed !== '1') {
        b.dataset.armed = '1';
        b.innerHTML = `${icon('trash', 12)}Click again to forget`;
        setTimeout(() => {
          if (!b.isConnected) return;
          b.dataset.armed = '';
          b.innerHTML = `${icon('trash', 12)}Forget`;
        }, 3000);
        return;
      }
      if (n.type === 'trail') await skillerr.invoke('trails-forget', n.trailId);
      else {
        await skillerr.invoke('mem-forget-node', n.id).catch(() => {});
        if (trail && n.url) await skillerr.invoke('trails-remove-page', { id: trail.trailId, url: n.url }).catch(() => {});
      }
      selected = null;
      load();
    });
  }

  function select(n, center) {
    selected = n;
    highlight = null;
    if (center && n) view = { ...view, x: -n.x, y: -n.y };
    renderSide();
    invalidate();
  }

  // =====================================================================================================
  // Interaction
  // =====================================================================================================
  let dragging = null;
  let panning = null;
  let moved = false;
  let downOrb = false;
  const hit = (px, py) => {
    let best = null;
    let bd = 12;
    for (const n of nodes) {
      if (n.p < 1 || !matches(n)) continue;
      const d = Math.hypot(n.px - px, n.py - py) - n.r * clamp(view.k, 0.35, 2.2);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  };
  const onOrb = (px, py) => {
    const o = orbScreen();
    return Math.hypot(px - o.x, py - o.y) < o.r * 1.08;
  };
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener('mousedown', (e) => {
    const p = local(e);
    moved = false;
    downOrb = onOrb(p.x, p.y);
    const n = downOrb ? null : hit(p.x, p.y);
    if (n) dragging = n;
    else panning = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging && !panning) return;
    if (Math.abs(e.movementX) + Math.abs(e.movementY) > 0) moved = true;
    if (dragging) {
      const p = local(e);
      const w = toWorld(p.x, p.y);
      const dx = w.x - dragging.x;
      const dy = w.y - dragging.y;
      dragging.x = dragging.ax = w.x;
      dragging.y = dragging.ay = w.y;
      // a trail or session brings its pages with it
      if (dragging.hub) {
        const g = groups.find((x) => x.key === dragging.group);
        for (const m of g?.members || []) {
          if (m === dragging) continue;
          m.x += dx;
          m.y += dy;
          m.ax += dx;
          m.ay += dy;
        }
      }
      relaxFrames = 20;
      invalidate();
    } else {
      view.x = panning.vx + (e.clientX - panning.x) / view.k;
      view.y = panning.vy + (e.clientY - panning.y) / view.k;
      invalidate();
    }
  });
  window.addEventListener('mouseup', () => {
    if (!dragging && !panning) return;
    if (dragging && !moved) select(dragging);
    else if (panning && !moved) {
      if (downOrb) window.kilrPanel?.toggle();
      else select(null);
    }
    dragging = null;
    panning = null;
  });
  canvas.addEventListener('mousemove', (e) => {
    if (dragging || panning) return;
    const p = local(e);
    const orb = onOrb(p.x, p.y);
    const n = orb ? null : hit(p.x, p.y);
    if (n !== hover || orb !== hoverOrb) {
      hover = n;
      hoverOrb = orb;
      canvas.style.cursor = n || orb ? 'pointer' : '';
      wake();
    }
    if (n) {
      tip.hidden = false;
      tip.innerHTML = `<b>${esc(trunc(n.label, 70))}</b><span><i style="background:hsl(${n.hue},100%,66%)"></i>${TYPE_LABEL[n.type] || 'Page'} · ${esc(whose(n))}${n.at ? ` · ${esc(n.at)}` : ''}</span>`;
    } else if (orb) {
      tip.hidden = false;
      tip.innerHTML = `<b>Skillerr Orb</b><span>Skillerr's own small AI, on this computer. Click to see what it's doing.</span>`;
    } else tip.hidden = true;
    if (!tip.hidden) {
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.min(W - tw - 8, p.x + 14)}px`;
      tip.style.top = `${Math.min(H - tip.offsetHeight - 8, p.y + 16)}px`;
    }
  });
  canvas.addEventListener('mouseleave', () => {
    tip.hidden = true;
    if (hover || hoverOrb) {
      hover = null;
      hoverOrb = false;
      wake();
    }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    const before = toWorld(p.x, p.y);
    view.k = clamp(view.k * Math.exp(-e.deltaY * 0.0015), 0.12, 5);
    const after = toWorld(p.x, p.y);
    view.x += after.x - before.x;
    view.y += after.y - before.y;
    tip.hidden = true;
    invalidate();
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => {
    const p = local(e);
    if (hit(p.x, p.y) || onOrb(p.x, p.y)) return;
    fitView();
    invalidate();
  });

  document.querySelectorAll('#hvFilter button').forEach((b) => (b.onclick = () => {
    filter = b.dataset.f;
    document.querySelectorAll('#hvFilter button').forEach((x) => x.classList.toggle('on', x === b));
    if (selected && !matches(selected)) select(null);
    invalidate();
  }));
  $('hvKilrBtn').onclick = () => {
    if (mode !== 'map') setMode('map');
    window.kilrPanel?.toggle();
  };

  $('mvSearch').onsubmit = async (e) => {
    e.preventDefault();
    const q = $('mvQuery').value.trim();
    if (mode !== 'map') {
      await setMode('map');
      $('mvQuery').value = q;
    }
    if (!q) {
      highlight = null;
      renderStats();
      return invalidate();
    }
    let results = [];
    try {
      results = await skillerr.invoke('mem-recall', q);
    } catch {}
    const ql = q.toLowerCase();
    const hits = [];
    for (const r of results || []) if (byId.has(r.id)) hits.push(byId.get(r.id));
    for (const n of nodes) if (!hits.includes(n) && (String(n.label).toLowerCase().includes(ql) || (n.url && n.url.toLowerCase().includes(ql)))) hits.push(n);
    highlight = new Set();
    for (const n of hits) {
      highlight.add(n.id);
      if (hits.length <= 30) for (const ed of edges) if (ed.a === n || ed.b === n) highlight.add(ed.a === n ? ed.b.id : ed.a.id);
    }
    const top = hits.find(matches);
    if (top) {
      selected = top;
      view = { ...view, x: -top.x, y: -top.y };
      renderSide();
    }
    $('mvStats').innerHTML = hits.length ? `<b>${fmt(hits.length)}</b> found for “${esc(trunc(q, 40))}” · <button type="button" class="link-btn" id="hvClearSearch">Show everything</button>`
      : `Nothing found for “${esc(trunc(q, 40))}” · <button type="button" class="link-btn" id="hvClearSearch">Show everything</button>`;
    $('hvClearSearch').onclick = clearSearch;
    invalidate();
  };
  function clearSearch() {
    $('mvQuery').value = '';
    highlight = null;
    select(null);
    renderStats();
  }
  $('mvQuery').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') clearSearch();
  });

  // Hidden (another tab, another mode): stop drawing entirely.
  new MutationObserver(() => {
    if ($('memView').hidden) {
      visible = false;
      tip.hidden = true;
      window.kilrPanel?.close();
    }
  }).observe($('memView'), { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) invalidate();
  });
  reducedMotion.addEventListener?.('change', () => invalidate());
  new ResizeObserver(fit).observe(body);

  // ---------- Folders: the research taxonomy as a tree ----------
  let tree = [];
  let openFolder = null;
  const expanded = new Set();
  const FICON = { session: '◎', note: '✎', skill: '✦', page: '↗' };

  function setMode(m) {
    mode = m;
    document.querySelectorAll('#mvMode button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    $('memView').classList.toggle('hv-map', m === 'map');
    document.querySelector('.mv-body').hidden = m !== 'map';
    $('mvBottom').hidden = m !== 'map';
    $('hvFilter').hidden = m !== 'map';
    $('mvFolders').hidden = m !== 'folders';
    if (m === 'folders') {
      window.kilrPanel?.close();
      loadFolders();
    } else {
      // Back to the map: start clean, not stuck on an old search highlight or selection.
      highlight = null;
      selected = null;
      $('mvQuery').value = '';
      renderSide();
      fit();
      return load(true);
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
    const sk = mk(`${icon('sparkle', 12)}Make it a skill`, 'ghost', async () => {
      const r = await skillerr.invoke('mem-folder-skill', f.id);
      sk.innerHTML = r.ok ? `${icon('check', 12)}Skill “${esc(r.name)}” saved` : esc(r.message);
      sk.title = r.ok ? `${r.file}\nAny AI that reads skills can use it; shared with Claude Code if that's on.` : '';
      sk.disabled = !!r.ok;
    });
    sk.title = 'Save this research as a skill (SKILL.md) that any AI can load';
    mk(`${icon('eye', 12)}Show on map`, 'ghost', async () => {
      await setMode('map');
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

  skillerr.on('memory-search', async (q) => {
    if (mode !== 'map') await setMode('map');
    else await load();
    $('mvQuery').value = q;
    $('mvSearch').requestSubmit();
  });
  // The tab strip calls show() whenever tabs change while History is the current tab: open it fresh once, then
  // only refresh now and then (new pages shoot out of the orb as they arrive).
  window.memoryView = {
    show() {
      if (mode === 'folders') {
        if (!visible) loadFolders();
        visible = true;
        return;
      }
      if (!visible) {
        visible = true;
        highlight = null;
        selected = null;
        $('mvQuery').value = '';
        renderSide();
        fit();
        load(true);
      } else if (Date.now() - lastLoad > 4000) load();
      wake();
    },
    // for the Kilr panel: how bright Kilr burns right now
    glow: () => glowShown,
    totals: () => data.totals,
  };
})();
