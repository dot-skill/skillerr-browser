// "Make Skillerr the AI's web browser": Claude Code's own WebSearch/WebFetch are turned off (~/.claude/settings.json)
// and a short note in ~/.claude/CLAUDE.md tells it why. Used by mcp/setup.js (--prefer / --undo-prefer / --uninstall)
// and by the app when it removes leftovers from an earlier install. Files are backed up (*.skillerr-backup) first.
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = os.homedir();
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

// Is Claude Code currently set up to browse only through Skillerr?
function isPreferred() {
  try {
    return fs.readFileSync(CLAUDE_MD, 'utf8').includes(BLOCK_START);
  } catch {
    return false;
  }
}

// on: true to prefer Skillerr, false to give Claude Code its own web tools back. dry: report only.
function setPrefer(on, { dry = false, say = () => {} } = {}) {
  const write = (file, text) => {
    if (dry) return say(`  would write ${file}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.skillerr-backup`);
    fs.writeFileSync(file, text);
  };
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
  write(CLAUDE_MD, on ? `${without ? without + '\n\n' : ''}${BLOCK}` : `${without}\n`);
}

module.exports = { setPrefer, isPreferred, CLAUDE_SETTINGS, CLAUDE_MD };
