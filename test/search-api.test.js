const test = require('node:test');
const assert = require('node:assert');
const { searchApi, resultsPage } = require('../src/search-api');

const reply = (body, ok = true, status = 200) => async (url, init) => ({ ok, status, json: async () => body, url, init });

test('Brave results are normalised', async () => {
  let seen;
  const r = await searchApi({ provider: 'brave', key: 'k', query: 'tokyo hotels', max: 2, fetchImpl: async (url, init) => {
    seen = { url, init };
    return reply({ web: { results: [
      { title: '<strong>Tokyo</strong> hotels', url: 'https://a.example', description: 'Best <b>hotels</b>' },
      { title: 'bad', url: 'javascript:alert(1)', description: '' },
      { title: 'B', url: 'https://b.example', description: '' },
      { title: 'C', url: 'https://c.example', description: '' },
    ] } })();
  } });
  assert.match(seen.url, /count=2/);
  assert.strictEqual(seen.init.headers['x-subscription-token'], 'k');
  assert.deepStrictEqual(r, [{ title: 'Tokyo hotels', url: 'https://a.example', snippet: 'Best hotels' }, { title: 'B', url: 'https://b.example', snippet: '' }]);
});

test('Tavily and Exa', async () => {
  const t = await searchApi({ provider: 'tavily', key: 'k', query: 'q', fetchImpl: reply({ results: [{ title: 'T', url: 'https://t.example', content: 'c' }] }) });
  assert.deepStrictEqual(t, [{ title: 'T', url: 'https://t.example', snippet: 'c' }]);
  const e = await searchApi({ provider: 'exa', key: 'k', query: 'q', fetchImpl: reply({ results: [{ title: '', url: 'https://e.example', summary: 's' }] }) });
  assert.deepStrictEqual(e, [{ title: 'https://e.example', url: 'https://e.example', snippet: 's' }]);
});

test('errors throw so web_search can fall back', async () => {
  await assert.rejects(searchApi({ provider: 'brave', key: 'k', query: 'q', fetchImpl: reply({}, false, 401) }), /401/);
  await assert.rejects(searchApi({ provider: 'brave', key: '', query: 'q' }), /No API key/);
  await assert.rejects(searchApi({ provider: 'nope', key: 'k', query: 'q' }), /Unknown/);
});

test('results page escapes what providers return', () => {
  const html = decodeURIComponent(resultsPage('brave', '<q>', [{ title: '<script>x</script>', url: 'https://a.example/"x', snippet: '&' }]).split(',')[1]);
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('https://a.example/&quot;x'));
});
