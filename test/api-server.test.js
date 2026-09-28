const test = require('node:test');
const assert = require('node:assert');
const { startApiServer } = require('../src/api-server');

test('local control API: token required, web pages refused', async (t) => {
  const calls = [];
  const { server, port, token } = await startApiServer({
    tools: [{ name: 'snapshot' }],
    onHello: (c) => calls.push(['hello', c]),
    onCall: async (c, name, args) => ({ text: `${c}:${name}:${JSON.stringify(args)}` }),
  });
  t.after(() => server.close());
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const auth = { authorization: `Bearer ${token}` };

  assert.strictEqual((await fetch(url('/tools'))).status, 401);
  assert.strictEqual((await fetch(url('/tools'), { headers: { authorization: 'Bearer nope' } })).status, 401);
  assert.strictEqual((await fetch(url('/tools'), { headers: { ...auth, origin: 'https://evil.example' } })).status, 403);
  assert.deepStrictEqual(await (await fetch(url('/tools'), { headers: auth })).json(), { tools: [{ name: 'snapshot' }] });

  const r = await fetch(url('/call'), { method: 'POST', headers: auth, body: JSON.stringify({ client: 'Claude', name: 'navigate', args: { url: 'x' } }) });
  assert.deepStrictEqual(await r.json(), { text: 'Claude:navigate:{"url":"x"}' });
  assert.strictEqual((await fetch(url('/call'), { method: 'POST', headers: auth, body: '{bad' })).status, 400);
  assert.strictEqual((await fetch(url('/nope'), { headers: auth })).status, 404);
  await fetch(url('/hello'), { method: 'POST', headers: auth, body: JSON.stringify({ client: 'Cursor' }) });
  assert.deepStrictEqual(calls, [['hello', 'Cursor']]);
});
