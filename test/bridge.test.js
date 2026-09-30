// The MCP bridge offers the live view only to AI apps that support MCP Apps, and never launches Skillerr to list tools.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const BRIDGE = path.join(__dirname, '..', 'mcp', 'bridge.js');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'skillerr-bridge-')); // no session.json: Skillerr is "closed"

async function connect(capabilities) {
  const client = new Client({ name: 'claude-ai', version: '1.0.0' }, { capabilities });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [BRIDGE], env: { ...process.env, HOME, USERPROFILE: HOME }, stderr: 'ignore' }));
  return client;
}

test('hosts with MCP Apps get the live view', async (t) => {
  const client = await connect({ extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } });
  t.after(() => client.close());
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((x) => [x.name, x]));
  assert.strictEqual(byName.fetch_page._meta.ui.resourceUri, 'ui://skillerr/live-view.html');
  assert.strictEqual(byName.fetch_page._meta['ui/resourceUri'], 'ui://skillerr/live-view.html');
  assert.ok(!byName.snapshot._meta, 'only tools that start browsing carry the view');
  assert.deepStrictEqual(byName.skillerr_preview_frame._meta.ui.visibility, ['app']);
  const res = await client.readResource({ uri: 'ui://skillerr/live-view.html' });
  assert.strictEqual(res.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.match(res.contents[0].text, /^<!doctype html>/i);
  const { resources } = await client.listResources();
  assert.ok(resources.some((r) => r.uri === 'ui://skillerr/live-view.html'));
  // The view's poll never launches a closed Skillerr.
  const frame = await client.callTool({ name: 'skillerr_preview_frame', arguments: { viewId: 'v', createdAt: 1 } });
  assert.deepStrictEqual(frame.structuredContent, { offline: true });
  // Nor does opening the Audit list.
  assert.deepStrictEqual(byName.skillerr_preview_audit._meta.ui.visibility, ['app']);
  const audit = await client.callTool({ name: 'skillerr_preview_audit', arguments: {} });
  assert.deepStrictEqual(audit.structuredContent, { offline: true });
});

test('ask is offered with its schema, and never carries the live view', async (t) => {
  const client = await connect({ extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } });
  t.after(() => client.close());
  const ask = (await client.listTools()).tools.find((x) => x.name === 'ask');
  assert.ok(ask);
  assert.deepStrictEqual(ask.inputSchema.required, ['text', 'options']);
  assert.strictEqual(ask.inputSchema.properties.text.type, 'string');
  assert.deepStrictEqual([ask.inputSchema.properties.options.minItems, ask.inputSchema.properties.options.maxItems], [2, 5]);
  assert.strictEqual(ask.inputSchema.properties.timeout_s.maximum, 600);
  assert.match(ask.description, /never grant approval/);
  assert.ok(!ask._meta);
});

test('other hosts see plain tools only', async (t) => {
  const client = await connect({});
  t.after(() => client.close());
  const { tools } = await client.listTools();
  assert.ok(!tools.some((x) => x.name.startsWith('skillerr_preview_')));
  assert.ok(!tools.some((x) => x._meta));
  const { resources } = await client.listResources();
  assert.ok(!resources.some((r) => r.uri.startsWith('ui://')));
});

// A stand-in Skillerr that asks and gets a click: the bridge waits for the answer and hands back the chosen label.
test('ask waits for the click and returns the choice', async (t) => {
  const { startApiServer } = require('../src/api-server');
  const { Asks } = require('../src/ask');
  const asks = new Asks();
  const { server, port, token } = await startApiServer({
    tools: [], onHello: () => {},
    onCall: async (_c, name, args) => {
      setTimeout(() => asks.answer(1, args.options[0]), 300); // the user clicks "Done, next"
      return { text: JSON.stringify(await asks.open(1, 'Claude Desktop', args.options, 5000)) };
    },
  });
  t.after(() => server.close());
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skillerr-bridge-'));
  fs.mkdirSync(path.join(home, '.skillerr', 'browser'), { recursive: true });
  fs.writeFileSync(path.join(home, '.skillerr', 'browser', 'session.json'), JSON.stringify({ port, token }));
  const client = new Client({ name: 'claude-ai', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [BRIDGE], env: { ...process.env, HOME: home, USERPROFILE: home }, stderr: 'ignore' }));
  t.after(() => client.close());
  const r = await client.callTool({ name: 'ask', arguments: { text: 'Posted it?', options: ['Done, next', 'Skip'] } });
  assert.deepStrictEqual(JSON.parse(r.content[0].text), { choice: 'Done, next' });
});
