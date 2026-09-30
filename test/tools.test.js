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
