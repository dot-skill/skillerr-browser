// Connections belong to Skillerr's data: leftovers from an earlier install are removed when that data is fresh,
// adopted when it isn't, and setup.js --uninstall removes everything Skillerr added to other apps.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'skillerr-conn-'));
process.env.HOME = process.env.USERPROFILE = HOME; // before connect.js/store.js read it
process.env.APPDATA = path.join(HOME, 'AppData', 'Roaming');
process.env.PATH = '/nonexistent'; // no `claude` CLI: only the file-based apps are exercised
process.env.SHELL = '/bin/false';
const connectors = require('../src/connect');
const store = require('../src/store');
const { isPreferred, setPrefer, CLAUDE_SETTINGS } = require('../src/prefer');

const desktopFile = process.platform === 'darwin' ? path.join(HOME, 'Library/Application Support/Claude/claude_desktop_config.json')
  : process.platform === 'win32' ? path.join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json') : path.join(HOME, '.config/Claude/claude_desktop_config.json');
const cursorFile = path.join(HOME, '.cursor', 'mcp.json');
const entry = { command: process.execPath, args: ['bridge.js'] };
const write = (f, o) => (fs.mkdirSync(path.dirname(f), { recursive: true }), fs.writeFileSync(f, JSON.stringify(o)));
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

function leftovers() {
  fs.rmSync(store.DIR, { recursive: true, force: true });
  write(desktopFile, { mcpServers: { skillerr: entry, other: { command: 'x' } } });
  write(cursorFile, { mcpServers: { skillerr: entry } });
}

test('fresh data: connections from an earlier install are removed, other servers kept', async () => {
  leftovers();
  const removed = await connectors.reconcile({ freshData: true });
  assert.deepStrictEqual(removed.sort(), ['Claude Desktop', 'Cursor']);
  assert.deepStrictEqual(read(desktopFile).mcpServers, { other: { command: 'x' } });
  assert.deepStrictEqual(read(cursorFile).mcpServers, {});
});

test('existing data from before the record: connections are adopted, not removed', async () => {
  leftovers();
  assert.deepStrictEqual(await connectors.reconcile({ freshData: false }), []);
  assert.ok(read(desktopFile).mcpServers.skillerr);
  assert.ok(connectors.readRecord().apps['claude-desktop'] && connectors.readRecord().apps.cursor);
  // …and from then on they're recorded, so even a "fresh" check keeps them.
  assert.deepStrictEqual(await connectors.reconcile({ freshData: true }), []);
});

test('the installer connecting first (record before entry) is never mistaken for a leftover', async () => {
  fs.rmSync(store.DIR, { recursive: true, force: true });
  fs.rmSync(desktopFile, { force: true });
  fs.rmSync(cursorFile, { force: true });
  await connectors.connect('claude-desktop', entry);
  assert.deepStrictEqual(await connectors.reconcile({ freshData: true }), []);
  assert.ok(read(desktopFile).mcpServers.skillerr);
});

test('fresh data: Claude Code web tools switched off by an earlier install are given back', async () => {
  fs.rmSync(store.DIR, { recursive: true, force: true });
  setPrefer(true);
  assert.ok(isPreferred());
  await connectors.reconcile({ freshData: true });
  assert.ok(!isPreferred());
  assert.deepStrictEqual(read(CLAUDE_SETTINGS).permissions.deny, []);
});

test('setup.js --uninstall removes connections and prefer; --purge deletes Skillerr data', () => {
  leftovers();
  setPrefer(true);
  store.writeJson('settings.json', { onboarded: true });
  const env = { ...process.env, HOME, USERPROFILE: HOME };
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'mcp', 'setup.js'), '--uninstall', '--purge'], { env, encoding: 'utf8' });
  assert.match(out, /disconnected from your AI apps/);
  assert.ok(!read(desktopFile).mcpServers.skillerr);
  assert.ok(!read(cursorFile).mcpServers.skillerr);
  assert.ok(!isPreferred());
  assert.ok(!fs.existsSync(store.DIR));
});
