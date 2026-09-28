#!/usr/bin/env node
// Connect AI apps to Skillerr and, if asked, make Skillerr their browser. Ships inside the app, so it runs
// without Node installed:  ELECTRON_RUN_AS_NODE=1 <Skillerr binary> <app>/mcp/setup.js [options]
//
//   --claude-code --claude-desktop --cursor   which apps (default: every one found on this computer)
//   --prefer        make Skillerr the AI's web browser (Claude Code: turn off its own WebSearch/WebFetch)
//   --undo-prefer   give the AI its own web tools back
//   --dry-run       say what would change, change nothing
const fs = require('fs');
const os = require('os');
const path = require('path');
const connectors = require('../src/connect');

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry-run');
const home = os.homedir();
const say = (s) => process.stdout.write(s + '\n');

// The command every AI app should run: this Skillerr binary, in Node mode, on the bundled bridge.
const entry = { command: process.execPath, args: [path.join(__dirname, 'bridge.js')], env: { ELECTRON_RUN_AS_NODE: '1' } };

const CLAUDE_SETTINGS = path.join(home, '.claude', 'settings.json');
const CLAUDE_MD = path.join(home, '.claude', 'CLAUDE.md');
const BLOCK_START = '<!-- skillerr:start -->';
const BLOCK_END = '<!-- skillerr:end -->';
const BLOCK = `${BLOCK_START}
## Web access: use Skillerr
For anything on the web, use the Skillerr browser (MCP server "skillerr"): \`web_search\` to search, \`fetch_page\` to read a page,
and the other Skillerr tools to browse, compare or dig deeper. Don't use built-in web search or fetch tools. Skillerr shows the
user every page you read, lets them pause you, and keeps the research so it can be recalled later (\`recall\`, \`my_research\`).
${BLOCK_END}
`;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`${file} isn't valid JSON, so it was left alone.`);
  }
}

function write(file, text) {
  if (dry) return say(`  would write ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.skillerr-backup`);
  fs.writeFileSync(file, text);
}

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
  // Claude Code: deny its built-in web tools, and tell it why.
  const settings = readJson(CLAUDE_SETTINGS);
  const deny = new Set(settings.permissions?.deny || []);
  for (const tool of ['WebSearch', 'WebFetch']) on ? deny.add(tool) : deny.delete(tool);
  settings.permissions = { ...(settings.permissions || {}), deny: [...deny] };
  write(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + '\n');

  let md = '';
  try {
    md = fs.readFileSync(CLAUDE_MD, 'utf8');
  } catch {}
  const without = md.replace(new RegExp(`\\n?${BLOCK_START}[\\s\\S]*?${BLOCK_END}\\n?`), '\n').trimEnd();
  write(CLAUDE_MD, (on ? `${without ? without + '\n\n' : ''}${BLOCK}` : `${without}\n`));
  const verb = dry ? 'would be' : on ? 'turned off' : 'restored';
  say(on ? `${dry ? '•' : '✓'} Claude Code: built-in WebSearch/WebFetch ${dry ? 'would be turned off' : verb}; it will browse through Skillerr.`
    : `${dry ? '•' : '✓'} Claude Code: built-in web tools ${dry ? 'would be restored' : verb}.`);
  if (on) {
    say('• Claude Desktop: turn off its own web search (in a chat, open the tools/search menu and switch "Web search" off),');
    say('  so it uses Skillerr for everything on the web. Skillerr\'s instructions already ask it to.');
  }
}

(async () => {
  if (dry) say('(dry run: nothing will change)');
  if (!args.has('--undo-prefer')) await connectAll();
  if (args.has('--prefer')) prefer(true);
  if (args.has('--undo-prefer')) prefer(false);
  say(dry ? 'Done (dry run).' : 'Done. Restart Claude Desktop, and start a new Claude Code session, to pick this up.');
})().catch((err) => {
  say(`Setup failed: ${err.message}`);
  process.exit(1);
});
