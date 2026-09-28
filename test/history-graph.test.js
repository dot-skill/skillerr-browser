const test = require('node:test');
const assert = require('node:assert');
const { buildHistoryGraph, glowOf, GLOW_FULL } = require('../src/history-graph');

const pageId = (u) => `page:${u}`;

test('history graph: marks whose each node is and joins pages seen by both', () => {
  const memoryGraph = {
    nodes: [
      { id: 'page:https://a.test/', type: 'page', label: 'A', url: 'https://a.test/', heat: 0.5 },
      { id: 'page:https://c.test/', type: 'page', label: 'C', url: 'https://c.test/', importedFrom: 'chrome' },
      { id: 'topic:x', type: 'topic', label: 'x' },
    ],
    edges: [{ from: 'topic:x', to: 'page:https://a.test/', type: 'about' }],
  };
  const trails = [
    { summary: { id: 't1', title: 'Mine', lastAt: Date.now() }, pages: [{ url: 'https://a.test/', title: 'A' }, { url: 'https://b.test/', title: 'B' }] },
    { summary: { id: 't2', title: 'Theirs', by: 'Claude', lastAt: Date.now() }, pages: [{ url: 'https://d.test/', title: 'D' }] },
  ];
  const g = buildHistoryGraph({ memoryGraph, trails, pageId });
  const by = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  assert.equal(by['page:https://a.test/'].origin, 'both');
  assert.equal(by['page:https://b.test/'].origin, 'you');
  assert.equal(by['page:https://c.test/'].origin, 'you');
  assert.equal(by['page:https://d.test/'].origin, 'ai');
  assert.equal(by['trail:t2'].by, 'Claude');
  assert.equal(g.totals.all, g.nodes.length);
  assert.equal(g.totals.both, 1);
  assert.ok(g.edges.some((e) => e.from === 'trail:t1' && e.to === 'page:https://a.test/'));
  assert.ok(g.glow > 0 && g.glow < 1);
});

test('history graph: trims to the most connected nodes and keeps edges consistent', () => {
  const trails = [{ summary: { id: 'big', title: 'Big' }, pages: Array.from({ length: 50 }, (_, i) => ({ url: `https://p${i}.test/` })) }];
  const g = buildHistoryGraph({ memoryGraph: null, trails, pageId, maxNodes: 10 });
  assert.equal(g.nodes.length, 10);
  assert.equal(g.totals.all, 51);
  assert.ok(g.nodes.some((n) => n.id === 'trail:big'));
  const ids = new Set(g.nodes.map((n) => n.id));
  assert.ok(g.edges.every((e) => ids.has(e.from) && ids.has(e.to)));
});

test('history graph: glow grows on a log scale and is full at a typical history', () => {
  assert.equal(glowOf(0), 0);
  assert.ok(glowOf(100) > 0.4);
  assert.equal(glowOf(GLOW_FULL), 1);
  assert.equal(glowOf(GLOW_FULL * 3), 1);
});
