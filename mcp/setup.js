#!/usr/bin/env node
// Connect AI apps to Skillerr and, if asked, make Skillerr their browser. Ships inside the app, so it runs
// without Node installed:  ELECTRON_RUN_AS_NODE=1 <Skillerr binary> <app>/mcp/setup.js [options]
//
//   --claude-code --claude-desktop --cursor   which apps (default: every one found on this computer)
//   --prefer        make Skillerr the AI's web browser (Claude Code: turn off its own WebSearch/WebFetch)
//   --undo-prefer   give the AI its own web tools back
//   --uninstall     disconnect every AI app and undo --prefer (the uninstallers run this); --purge also deletes
//                   Skillerr's settings, research memory and skills (~/.skillerr/browser). Notes in ~/Skillerr stay.
//   --dry-run       say what would change, change nothing
const fs = require('fs');
const path = require('path');
const connectors = require('../src/connect');

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry-run');
const say = (s) => process.stdout.write(s + '\n');

// The command every AI app should run: this Skillerr binary, in Node mode, on the bundled bridge.
const entry = { command: process.execPath, args: [path.join(__dirname, 'bridge.js')], env: { ELECTRON_RUN_AS_NODE: '1' } };

const { setPrefer, isPreferred } = require('../src/prefer');
const store = require('../src/store');

async function connectAll() {
  const targets = await connectors.listTargets();
  const wanted = ['claude-code', 'claude-desktop', 'cursor'].filter((id) => args.has(`--${id}`));
  const list = targets.filter((t) => (wanted.length ? wanted.includes(t.id) : t.detected));
  if (!list.length) say('No AI apps found to connect (Claude Code, Claude Desktop, Cursor).');
  for (const t of list) {
    if (!t.detected) {
      say(`✗ ${t.name}: not installed on this computer`);
      continue;
    }
    if (dry) {
      say(`• ${t.name}: would connect to ${entry.command}`);
      continue;
    }
    try {
      say(`✓ ${t.name}: ${await connectors.connect(t.id, entry)}`);
    } catch (err) {
      say(`✗ ${t.name}: ${err.message}`);
    }
  }
  return list;
}

function prefer(on) {
  setPrefer(on, { dry, say });
  if (!dry) connectors.recordPrefer(on);
  const verb = dry ? 'would be' : on ? 'turned off' : 'restored';
  say(on ? `${dry ? '•' : '✓'} Claude Code: built-in WebSearch/WebFetch ${dry ? 'would be turned off' : verb}; it will browse through Skillerr.`
    : `${dry ? '•' : '✓'} Claude Code: built-in web tools ${dry ? 'would be restored' : verb}.`);
  if (on) {
    say('• Claude Desktop: turn off its own web search (in a chat, open the tools/search menu and switch "Web search" off),');
    say('  so it uses Skillerr for everything on the web. Skillerr\'s instructions already ask it to.');
  }
}

// Everything Skillerr added to other apps, removed: MCP entries in every app, and --prefer.
async function uninstall() {
  for (const id of await connectors.withEntries()) {
    if (dry) {
      say(`• ${id}: would disconnect`);
      continue;
    }
    try {
      say(`✓ ${id}: ${await connectors.disconnect(id)}`);
    } catch (err) {
      say(`✗ ${id}: ${err.message}`);
    }
  }
  if (isPreferred()) prefer(false);
  if (args.has('--purge')) {
    if (dry) say(`• would delete ${store.DIR}`);
    else {
      fs.rmSync(store.DIR, { recursive: true, force: true });
      say(`✓ Deleted ${store.DIR}`);
    }
  }
}

(async () => {
  if (dry) say('(dry run: nothing will change)');
  if (args.has('--uninstall')) {
    await uninstall();
    say(dry ? 'Done (dry run).' : 'Skillerr is disconnected from your AI apps. Restart Claude Desktop and Cursor to finish.');
    return;
  }
  if (!args.has('--undo-prefer')) await connectAll();
  if (args.has('--prefer')) prefer(true);
  if (args.has('--undo-prefer')) prefer(false);
  say(dry ? 'Done (dry run).' : 'Done. Restart Claude Desktop, and start a new Claude Code session, to pick this up.');
})().catch((err) => {
  say(`Setup failed: ${err.message}`);
  process.exit(1);
});
