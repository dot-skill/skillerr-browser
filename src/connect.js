// One-click "connect this AI app to Skillerr": writes Skillerr's MCP entry into the app's config.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const home = os.homedir();

function claudeDesktopConfigPath() {
  if (process.platform === 'darwin') return path.join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData/Roaming'), 'Claude', 'claude_desktop_config.json');
  return path.join(home, '.config/Claude/claude_desktop_config.json');
}

const FILE_TARGETS = [
  { id: 'claude-desktop', name: 'Claude Desktop', file: claudeDesktopConfigPath(), done: 'Connected. Restart Claude Desktop to finish.' },
  { id: 'cursor', name: 'Cursor', file: path.join(home, '.cursor', 'mcp.json'), done: 'Connected. Cursor will pick it up automatically.' },
];

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw); // throws on invalid JSON so we never clobber a config we can't read
}

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => execFile(cmd, args, { timeout: 15000, ...opts }, (err, stdout, stderr) => resolve({ err, stdout, stderr })));

function bundledClaudeCli() {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const candidates = [path.join(home, '.claude', 'local', exe)];
  for (const dir of [path.join(home, '.vscode', 'extensions'), path.join(home, '.cursor', 'extensions'), path.join(home, '.windsurf', 'extensions')]) {
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.startsWith('anthropic.claude-code-')).sort().reverse(); // newest first
    } catch {}
    for (const n of names) candidates.push(path.join(dir, n, 'resources', 'native-binary', exe));
  }
  return candidates.find((c) => fs.existsSync(c)) || null;
}

let claudeBin; // cached lookup of the `claude` CLI through the user's login shell
async function findClaudeCli() {
  if (claudeBin !== undefined) return claudeBin;
  if (process.platform === 'win32') {
    const r = await run('where', ['claude']);
    claudeBin = r.err ? null : r.stdout.split(/\r?\n/)[0].trim();
  } else {
    const r = await run(process.env.SHELL || '/bin/zsh', ['-lc', 'command -v claude'], { timeout: 5000 });
    claudeBin = r.err ? null : r.stdout.trim().split('\n').pop() || null;
  }
  // Many people only have the CLI bundled inside the VS Code / Cursor extension.
  if (!claudeBin) claudeBin = bundledClaudeCli();
  return claudeBin;
}

async function listTargets() {
  const out = FILE_TARGETS.map((t) => {
    let connected = false;
    try {
      // Connected only if the saved entry still points at an app that exists (it breaks if Skillerr moved).
      const entry = readJson(t.file).mcpServers?.skillerr;
      connected = !!entry && fs.existsSync(entry.command);
      if (entry && !connected) return { id: t.id, name: t.name, detected: true, connected: false, stale: true };
    } catch {}
    return { id: t.id, name: t.name, detected: fs.existsSync(path.dirname(t.file)), connected };
  });
  let ccConnected = false;
  try {
    ccConnected = !!readJson(path.join(home, '.claude.json')).mcpServers?.skillerr;
  } catch {}
  out.push({ id: 'claude-code', name: 'Claude Code', detected: !!(await findClaudeCli()), connected: ccConnected });
  return out;
}

// Quit and reopen Claude Desktop so it picks up the new connection (it reads its config only at start).
async function restartClaudeDesktop() {
  if (process.platform !== 'darwin') throw new Error('Please restart Claude Desktop yourself.');
  await run('osascript', ['-e', 'tell application "Claude" to quit']);
  await new Promise((r) => setTimeout(r, 2500));
  const r = await run('open', ['-a', 'Claude']);
  if (r.err) throw new Error('Couldn’t reopen Claude Desktop. Open it yourself.');
  return 'Claude Desktop restarted. Ask it to “use Skillerr to…”.';
}

async function connect(id, entry) {
  const target = FILE_TARGETS.find((t) => t.id === id);
  if (target) {
    let config;
    try {
      config = readJson(target.file);
    } catch {
      throw new Error(`${target.name}'s config file isn't valid JSON, so Skillerr left it alone. Fix it or add Skillerr manually.`);
    }
    fs.mkdirSync(path.dirname(target.file), { recursive: true });
    if (fs.existsSync(target.file)) fs.copyFileSync(target.file, target.file + '.skillerr-backup');
    config.mcpServers = { ...(config.mcpServers || {}), skillerr: entry };
    fs.writeFileSync(target.file, JSON.stringify(config, null, 2));
    return target.done;
  }
  if (id === 'claude-code') {
    const bin = await findClaudeCli();
    if (!bin) throw new Error('Claude Code CLI not found.');
    const r = await run(bin, ['mcp', 'add', 'skillerr', '--scope', 'user', '-e', 'ELECTRON_RUN_AS_NODE=1', '--', entry.command, ...entry.args]);
    if (r.err && !/already exists/i.test(r.stderr + r.stdout)) throw new Error((r.stderr || r.err.message).trim().slice(0, 300));
    return 'Connected. New Claude Code sessions can use Skillerr.';
  }
  throw new Error(`Unknown app: ${id}`);
}

// Free local models the built-in agent can use with zero setup.
async function detectLocalModels() {
  const get = async (url) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(800) });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };
  const [ollama, lmstudio] = await Promise.all([get('http://localhost:11434/api/tags'), get('http://localhost:1234/v1/models')]);
  const found = [];
  for (const m of ollama?.models || []) found.push({ source: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: m.name });
  for (const m of lmstudio?.data || []) found.push({ source: 'LM Studio', baseUrl: 'http://localhost:1234/v1', model: m.id });
  return found;
}

// Remove Skillerr from an app's MCP config.
async function disconnect(id) {
  const target = FILE_TARGETS.find((t) => t.id === id);
  if (target) {
    const config = readJson(target.file);
    if (!config.mcpServers) return `${target.name} wasn't connected.`;
    fs.copyFileSync(target.file, target.file + '.skillerr-backup');
    delete config.mcpServers.skillerr;
    fs.writeFileSync(target.file, JSON.stringify(config, null, 2));
    return `Disconnected. Restart ${target.name} to finish.`;
  }
  if (id === 'claude-code') {
    const bin = await findClaudeCli();
    if (!bin) throw new Error('Claude Code CLI not found.');
    await run(bin, ['mcp', 'remove', 'skillerr', '--scope', 'user']);
    return 'Disconnected. New Claude Code sessions won\'t see Skillerr.';
  }
  throw new Error(`Unknown app: ${id}`);
}

module.exports = { listTargets, connect, disconnect, restartClaudeDesktop, detectLocalModels };
