const test = require('node:test');
const assert = require('node:assert');
const { TOOLS, toUrl, setSearchTemplate } = require('../src/tools');

test('tool definitions are unique and well-formed', () => {
  const names = TOOLS.map((t) => t.name);
  assert.strictEqual(new Set(names).size, names.length);
  for (const t of TOOLS) {
    assert.match(t.name, /^[a-z_]+$/);
    assert.ok(t.description.length > 10, t.name);
    assert.strictEqual(t.input_schema.type, 'object', t.name);
    for (const r of t.input_schema.required || []) assert.ok(r in t.input_schema.properties, `${t.name}.${r}`);
  }
  for (const n of ['snapshot', 'navigate', 'web_search', 'fetch_page', 'recall', 'save_note']) assert.ok(names.includes(n), n);
});

test('toUrl: URLs, hosts, localhost and searches', () => {
  setSearchTemplate('https://search.example/?q=%s');
  assert.strictEqual(toUrl('https://a.example/x'), 'https://a.example/x');
  assert.strictEqual(toUrl('example.com/path'), 'https://example.com/path');
  assert.strictEqual(toUrl('localhost:3000'), 'http://localhost:3000');
  assert.strictEqual(toUrl('best ramen'), 'https://search.example/?q=best%20ramen');
  assert.strictEqual(toUrl('about:blank'), 'about:blank');
});

test("an AI's searches land on plain web results, without the engine's AI overview", () => {
  const { webResultsUrl, aiUrl } = require('../src/tools');
  assert.strictEqual(webResultsUrl('https://www.google.co.in/search?q=a%20b'), 'https://www.google.co.in/search?q=a+b&udm=14');
  assert.strictEqual(webResultsUrl('https://duckduckgo.com/?q=x'), 'https://noai.duckduckgo.com/?q=x');
  assert.strictEqual(webResultsUrl('https://www.google.com/search?q=x&tbm=isch'), 'https://www.google.com/search?q=x&tbm=isch', 'image search is left alone');
  assert.strictEqual(webResultsUrl('https://www.google.com/search?q=x&udm=2'), 'https://www.google.com/search?q=x&udm=2');
  assert.strictEqual(webResultsUrl('https://example.com/search?q=x'), 'https://example.com/search?q=x');
  assert.strictEqual(webResultsUrl('not a url'), 'not a url');
  setSearchTemplate('https://www.google.com/search?q=%s');
  assert.strictEqual(aiUrl('largest dinosaur'), 'https://www.google.com/search?q=largest+dinosaur&udm=14');
  assert.strictEqual(aiUrl('https://en.wikipedia.org/wiki/Dinosaur'), 'https://en.wikipedia.org/wiki/Dinosaur');
});

test('type: values for time, date, colour and slider inputs, in the form each takes', () => {
  const { inputValue } = require('../src/tools');
  assert.strictEqual(inputValue('time', '19:15'), '19:15');
  assert.strictEqual(inputValue('time', '7:15 PM'), '19:15');
  assert.strictEqual(inputValue('time', '7:15pm'), '19:15');
  assert.strictEqual(inputValue('time', '12 a.m.'), '00:00');
  assert.strictEqual(inputValue('time', '12:30 PM'), '12:30');
  assert.strictEqual(inputValue('time', '9:05'), '09:05');
  assert.strictEqual(inputValue('time', '19:15:30'), '19:15:30');
  for (const bad of ['25:00', '7', '13:00 PM', 'quarter past', '']) assert.strictEqual(inputValue('time', bad), null, bad);
  assert.strictEqual(inputValue('date', '2026-10-06'), '2026-10-06');
  assert.strictEqual(inputValue('date', '2026/10/6'), '2026-10-06');
  for (const bad of ['2026-02-30', '06/10/2026', 'next Tuesday']) assert.strictEqual(inputValue('date', bad), null, bad);
  assert.strictEqual(inputValue('datetime-local', '2026-10-06 7:15 PM'), '2026-10-06T19:15');
  assert.strictEqual(inputValue('datetime-local', '2026-10-06T19:15'), '2026-10-06T19:15');
  assert.strictEqual(inputValue('datetime-local', '2026-10-06'), null);
  assert.strictEqual(inputValue('month', '2026-1'), '2026-01');
  assert.strictEqual(inputValue('month', '2026-13'), null);
  assert.strictEqual(inputValue('week', '2026-W41'), '2026-W41');
  assert.strictEqual(inputValue('week', '2026 w7'), '2026-W07');
  assert.strictEqual(inputValue('color', '#F60'), '#ff6600');
  assert.strictEqual(inputValue('color', 'FF6600'), '#ff6600');
  assert.strictEqual(inputValue('color', 'orange'), null);
  assert.strictEqual(inputValue('range', ' 7 '), '7');
  assert.strictEqual(inputValue('range', 'loud'), null);
});

// A page with a text field (email), a time input and whatever the test says has focus. Page scripts run in a vm.
function fakePage() {
  const vm = require('node:vm');
  class Event { constructor(type) { this.type = type; } }
  class HTMLInputElement {}
  Object.defineProperty(HTMLInputElement.prototype, 'value', { get() { return this._v; }, set(v) { this.sets.push(v); this._v = this.type === 'time' && !/^\d\d:\d\d$/.test(v) ? '' : v; } });
  class HTMLSelectElement {}
  const doc = { activeElement: null };
  const make = (id, type) => {
    const el = Object.assign(Object.create(HTMLInputElement.prototype), {
      id, tagName: 'INPUT', type, _v: '', sets: [], events: [], parentNode: doc, validationMessage: '',
      focus() {}, select() {}, dispatchEvent(e) { el.events.push(e.type); },
      scrollIntoView() {}, getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 20 }),
    });
    return el;
  };
  const els = { 3: make(3, 'email'), 11: make(11, 'time') };
  doc.activeElement = els[3]; // the field typed into before
  doc.querySelectorAll = (sel) => { const m = /data-skillerr-id="(\d+)"/.exec(sel); return m ? [els[m[1]]].filter(Boolean) : []; };
  const ctx = vm.createContext({ document: doc, Event, HTMLInputElement, HTMLSelectElement, innerWidth: 1000, innerHeight: 800 });
  const frame = { executeJavaScript: async (js) => vm.runInContext(js, ctx) };
  const typed = [];
  const wc = { mainFrame: frame, executeJavaScript: frame.executeJavaScript, insertText: async (t) => typed.push(t), sendInputEvent() {}, getZoomFactor: () => 1,
    isLoading: () => false, getURL: () => 'https://httpbin.org/forms/post' };
  const tab = { id: 1, view: { webContents: wc }, skillerrFrames: new Map() };
  const browser = { active: () => tab, get: () => tab, isVisible: () => true };
  return { els, doc, typed, browser };
}

test('type sets a time input through the native value setter, with input and change events, and no keystrokes', async () => {
  const { runTool } = require('../src/tools');
  const p = fakePage();
  const r = await runTool(p.browser, 'type', { id: 11, text: '7:15 PM' });
  assert.match(r.text, /Set \[11\] to "19:15"/);
  assert.deepStrictEqual(p.els[11].sets, ['19:15']);
  assert.deepStrictEqual(p.els[11].events, ['input', 'change']);
  assert.deepStrictEqual(p.typed, [], 'nothing typed through the keyboard');
  assert.strictEqual(p.els[3]._v, '', 'the previous field is untouched');
  await assert.rejects(runTool(p.browser, 'type', { id: 11, text: 'quarter past' }), /isn't a time value.*Nothing was typed/);
});

test('type never sends keystrokes when focus is on another element than the target', async () => {
  const { runTool } = require('../src/tools');
  const p = fakePage();
  p.els[11].type = 'text'; // a text field that won't take focus: focus stays on the email field
  await assert.rejects(runTool(p.browser, 'type', { id: 11, text: '19:15' }), /nothing was typed/);
  assert.deepStrictEqual(p.typed, []);
  p.els[11].focus = () => (p.doc.activeElement = p.els[11]);
  await runTool(p.browser, 'type', { id: 11, text: '19:15' });
  assert.deepStrictEqual(p.typed, ['19:15'], 'typed once focus is really there');
});

// A tab for read_tabs. `loading`: still loading (Electron would hold an isolated-world script until it stops).
function fakeReadTab(id, { loading = false, text = `text of tab ${id}`, fail = null } = {}) {
  const calls = [];
  const page = () => (fail ? Promise.reject(new Error(fail)) : Promise.resolve({ text, hidden: '' }));
  const wc = {
    getURL: () => `https://example.com/${id}`, getTitle: () => `Tab ${id}`, isLoadingMainFrame: () => loading,
    executeJavaScriptInIsolatedWorld: () => (calls.push('world'), loading ? new Promise(() => {}) : page()),
    debugger: {
      attached: false,
      isAttached() { return this.attached; }, attach() { this.attached = true; }, detach() { this.attached = false; },
      async sendCommand(method) {
        calls.push(method);
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'F' } } };
        if (method === 'Page.createIsolatedWorld') return { executionContextId: 7 };
        return { result: { value: await page() } };
      },
    },
  };
  return { id, view: { webContents: wc }, calls };
}

test('read_tabs wakes each tab before reading it, and reads tabs that are still loading', async () => {
  const { runTool } = require('../src/tools');
  const tabs = [fakeReadTab(2), fakeReadTab(3, { loading: true })];
  const order = [];
  const browser = {
    listTabs: () => tabs, get: (id) => tabs.find((t) => t.id === id),
    awake: async (t) => { order.push(`wake ${t.id}`); t.calls.push('awake'); },
  };
  const r = await runTool(browser, 'read_tabs', { tab_ids: [2, 3] });
  assert.match(r.text, /text of tab 2/);
  assert.match(r.text, /text of tab 3/, 'a loading tab is read at once, not after it stops loading');
  assert.deepStrictEqual(tabs[0].calls, ['awake', 'world']);
  assert.deepStrictEqual(tabs[1].calls, ['awake', 'Page.getFrameTree', 'Page.createIsolatedWorld', 'Runtime.evaluate'], 'still isolated from the page');
  assert.strictEqual(tabs[1].view.webContents.debugger.attached, false, 'debugger detached again');
});

test("read_tabs returns every tab it could read, and each other tab's own error", async () => {
  const { runTool } = require('../src/tools');
  const tabs = [fakeReadTab(2), fakeReadTab(3, { fail: 'The page did not respond in time.' }), fakeReadTab(4), fakeReadTab(5)];
  const browser = {
    listTabs: () => tabs, get: (id) => tabs.find((t) => t.id === id),
    awake: async (t) => { if (t.id === 4) throw new Error('Tab went away'); },
  };
  const r = await runTool(browser, 'read_tabs', { tab_ids: [2, 3, 4, 5, 9] });
  assert.match(r.text, /## tab 2: Tab 2[\s\S]*text of tab 2/);
  assert.match(r.text, /## tab 3: Tab 3 — https:\/\/example.com\/3\n\(could not read: The page did not respond in time.\)/);
  assert.match(r.text, /## tab 4\n\(could not read: Tab went away\)/);
  assert.match(r.text, /## tab 5: Tab 5[\s\S]*text of tab 5/);
  assert.match(r.text, /## tab 9\n\(no such tab\)/);
});

test('an AI waking or using a tab lifts its throttling and keeps it from sleeping again before the read', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n'); // Windows checks out CRLF
  const awake = main.slice(main.indexOf('  awake: async (t) => {'), main.indexOf('  isVisible: (t) =>'));
  assert.match(awake, /await wake\(t\)[\s\S]*touchTab\(t\)/);
  const touch = main.slice(main.indexOf('function touchTab(tab) {'), main.indexOf('function touchTab(tab) {') + 600);
  assert.match(touch, /tab\.aiUntil = Date\.now\(\)/);
  assert.match(touch, /setBackgroundThrottling\(false\)/);
});
