// The built-in AI (a local model through Ollama or LM Studio, or an API key) hears what the user types in the Pilot
// panel at its next step, as a plain user turn: no MCP round trip.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { Agent } = require('../src/agent');

// A stand-in OpenAI-compatible server (what Ollama and LM Studio speak) answering from a script, recording requests.
async function fakeModel(replies) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    seen.push(body.messages);
    const next = replies.shift();
    const message = typeof next === 'function' ? await next(body) : next;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { seen, server, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

const call = (name, args = {}) => ({ role: 'assistant', content: '', tool_calls: [{ id: `c${Math.random()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

test('built-in AI: a message typed mid-task joins the loop at the next step', async (t) => {
  let agent;
  const m = await fakeModel([call('snapshot'), { role: 'assistant', content: 'Switched to the second flight.' }]);
  t.after(() => m.server.close());
  const events = [];
  agent = new Agent({
    getSettings: () => ({ provider: 'openai-compatible', baseUrl: m.baseUrl, model: 'qwen3:4b' }),
    execute: async () => {
      assert.strictEqual(agent.tell('Use the second flight instead'), true); // typed while the snapshot runs
      return { text: 'Page: flights' };
    },
    onEvent: (e) => events.push(e),
  });
  const r = await agent.run('Book the cheapest flight');
  assert.strictEqual(r.answer, 'Switched to the second flight.');
  const second = m.seen[1];
  assert.deepStrictEqual(second.at(-2).role, 'tool');
  assert.deepStrictEqual(second.at(-1), { role: 'user', content: 'Message from the user (typed in Skillerr): Use the second flight instead' });
  assert.ok(events.some((e) => e.type === 'told' && e.count === 1));
  assert.deepStrictEqual(r.left, []);
});

test('built-in AI: a message sent while it writes its answer keeps it going', async (t) => {
  let agent;
  const m = await fakeModel([
    async () => (agent.tell('Also check the return date'), { role: 'assistant', content: 'Here are the flights.' }),
    { role: 'assistant', content: 'The return is on the 12th.' },
  ]);
  t.after(() => m.server.close());
  agent = new Agent({ getSettings: () => ({ provider: 'openai-compatible', baseUrl: m.baseUrl, model: 'qwen3:4b' }), execute: async () => ({ text: '' }), onEvent: () => {} });
  const r = await agent.run('Find flights');
  assert.strictEqual(m.seen.length, 2);
  assert.deepStrictEqual(m.seen[1].at(-1), { role: 'user', content: 'Message from the user (typed in Skillerr): Also check the return date' });
  assert.strictEqual(r.answer, 'The return is on the 12th.');
});

test('built-in AI: when it is idle, tell() says so (the panel starts a new task instead)', () => {
  const agent = new Agent({ getSettings: () => ({}), execute: async () => ({ text: '' }), onEvent: () => {} });
  assert.strictEqual(agent.tell('hello'), false);
});

// main.js routes a panel message to the built-in AI's loop, or starts a task with it when it's idle.
test('the panel message box reaches the built-in AI directly', () => {
  const fs = require('fs');
  const path = require('path');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const h = main.slice(main.indexOf("ipcMain.handle('pilot-message'"), main.indexOf("ipcMain.on('ask-choice'"));
  assert.match(h, /if \(target\.via === 'builtin'\) \{\n\s+if \(agent\.tell\(text\)\)/);
  assert.match(h, /return \{ ok: false, start: true \}/);
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ui.js'), 'utf8');
  assert.match(ui, /if \(r\.start\) return startTask\(text\);/);
});
