// Skills: packaged workflows any AI driving Skillerr can use — the browser's answer to extensions.
// A skill is a standard Agent Skills folder (SKILL.md with name/description frontmatter), so the
// same folder also works in Claude Code, Cursor and friends. Skillerr reads the instructions; it never
// runs a skill's bundled scripts.
//
// Sealed `.skill` packages (https://github.com/dot-skill/skillerr) are unpacked and checked with the
// skillerr CLI before install, so people see who sealed a skill and whether it was changed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const store = require('./store');

const BUILTIN_DIR = path.join(__dirname, '..', 'skills');
const USER_DIR = path.join(store.DIR, 'skills');
const TRUST_FILE = '.skillerr-trust.json';
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Just enough YAML for SKILL.md frontmatter: scalars, quoted strings, folded/literal blocks, one level of nesting.
function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  const lines = m[1].split(/\r?\n/);
  const unquote = (v) => v.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    const block = [];
    while (i + 1 < lines.length && /^(\s+|$)/.test(lines[i + 1]) && lines[i + 1] !== '') block.push(lines[++i]);
    if (/^[>|][-+]?$/.test(raw.trim())) meta[key] = block.map((l) => l.trim()).join(raw.trim()[0] === '>' ? ' ' : '\n').trim();
    else if (raw.trim() === '' && block.length) {
      meta[key] = {};
      for (const l of block) {
        const sub = l.match(/^\s+([A-Za-z0-9_.-]+):\s*(.*)$/);
        if (sub) meta[key][sub[1]] = unquote(sub[2]);
      }
    } else meta[key] = unquote(raw);
  }
  return { meta, body: src.slice(m[0].length).trim() };
}

function readSkill(dir, source) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  } catch {
    return null;
  }
  const { meta, body } = parseFrontmatter(text);
  const name = String(meta.name || path.basename(dir));
  const skillerr = typeof meta.metadata === 'object' ? meta.metadata : {};
  let trust = null;
  try {
    trust = JSON.parse(fs.readFileSync(path.join(dir, TRUST_FILE), 'utf8'));
  } catch {}
  return {
    name,
    description: String(meta.description || '').trim(),
    icon: skillerr['skillerr-icon'] || 'sparkle',
    example: skillerr['skillerr-example'] || '',
    source, // 'built-in' | 'installed'
    trust: source === 'built-in' ? { state: 'built-in', summary: 'Ships with Skillerr' } : trust || { state: 'unsigned', summary: 'Installed from a folder, no seal' },
    hasScripts: fs.existsSync(path.join(dir, 'scripts')),
    dir,
    body,
  };
}

function list() {
  const seen = new Map();
  for (const [root, source] of [[BUILTIN_DIR, 'built-in'], [USER_DIR, 'installed']]) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {}
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const s = readSkill(path.join(root, e.name), source);
      if (s && !seen.has(s.name)) seen.set(s.name, s);
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const get = (name) => list().find((s) => s.name === String(name || '').replace(/^\//, '').trim()) || null;

// What the panel and the AIs see (no filesystem paths, no body).
const summary = (s) => ({ name: s.name, description: s.description, icon: s.icon, example: s.example, source: s.source, trust: s.trust, hasScripts: s.hasScripts });

// A short catalog for system prompts / tool results.
function catalog() {
  const all = list();
  return all.length ? all.map((s) => `- ${s.name}: ${s.description}`).join('\n') : '(no skills installed)';
}

// ---------- installing ----------

// Apps launched from Finder get a bare PATH; look where npm and Homebrew put global binaries too.
function findSkillerr() {
  const dirs = [...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.npm-global', 'bin')];
  for (const d of dirs) {
    const p = path.join(d, 'skill');
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

function run(bin, args) {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin` };
    delete env.ELECTRON_RUN_AS_NODE;
    execFile(bin, args, { env, timeout: 60000, maxBuffer: 4 << 20 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim(), err }));
  });
}

// skillerr names exactly one of these trust states; never upgrade an unknown one.
function trustFrom(report) {
  for (const state of ['verified_issuer', 'self_reported', 'development', 'untrusted']) if (report.includes(state)) return state;
  return 'unknown';
}
const TRUST_WORDS = {
  verified_issuer: 'Signed by a verified issuer',
  self_reported: 'Sealed, but the author is self-reported',
  development: 'Development seal only, not proof of authorship',
  untrusted: 'Seal did not verify',
  unknown: 'Seal could not be read',
};

// Unpack/check a folder or .skill into a staging dir and describe it. Nothing is installed yet.
async function inspect(file) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'skillerr-skill-'));
  let dir;
  let trust;
  if (fs.statSync(file).isDirectory()) {
    if (!fs.existsSync(path.join(file, 'SKILL.md'))) throw new Error('That folder has no SKILL.md.');
    dir = path.join(staging, path.basename(file));
    fs.cpSync(file, dir, { recursive: true });
    trust = { state: 'unsigned', summary: 'A plain folder, no seal. Only install skills from people you trust.' };
  } else if (file.endsWith('.skill')) {
    const bin = findSkillerr();
    if (!bin) throw new Error('Opening .skill packages needs the skillerr CLI. Install it with: npm i -g skillerr');
    dir = path.join(staging, 'skill');
    const exp = await run(bin, ['export-skill', file, '-o', dir]);
    if (!exp.ok || !fs.existsSync(path.join(dir, 'SKILL.md'))) throw new Error(`skillerr could not unpack it: ${exp.out.slice(0, 400)}`);
    const ver = await run(bin, ['verify-skill', dir, '--attestation', file]);
    const state = trustFrom(ver.out);
    trust = { state, summary: TRUST_WORDS[state], report: ver.out.slice(0, 4000) };
  } else throw new Error('Choose a skill folder (with SKILL.md) or a .skill package.');

  const s = readSkill(dir, 'installed');
  if (!s) throw new Error('Could not read SKILL.md.');
  if (!NAME_RE.test(s.name) || s.name.length > 64) throw new Error(`"${s.name}" is not a valid skill name (lowercase letters, digits and hyphens).`);
  if (!s.description) throw new Error('SKILL.md needs a description.');
  fs.writeFileSync(path.join(dir, TRUST_FILE), JSON.stringify(trust, null, 2));
  return { staging: dir, skill: { ...summary(s), trust }, replaces: !!get(s.name) };
}

function install(stagingDir) {
  if (!stagingDir.startsWith(os.tmpdir()) || !fs.existsSync(path.join(stagingDir, 'SKILL.md'))) throw new Error('Nothing to install.');
  const s = readSkill(stagingDir, 'installed');
  if (list().some((x) => x.name === s.name && x.source === 'built-in')) throw new Error(`"${s.name}" is a built-in skill and can't be replaced.`);
  const dest = path.join(USER_DIR, s.name);
  fs.mkdirSync(USER_DIR, { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(stagingDir, dest, { recursive: true });
  return summary(readSkill(dest, 'installed'));
}

function remove(name) {
  const s = get(name);
  if (!s || s.source !== 'installed') throw new Error('Only installed skills can be removed.');
  fs.rmSync(s.dir, { recursive: true, force: true });
}

// Tool results for list_skills / use_skill.
function listText() {
  return `Skills are step-by-step playbooks for common jobs. Call use_skill with a name to load one, then follow it.\n${catalog()}`;
}
function useText(name) {
  const s = get(name);
  if (!s) throw new Error(`No skill named "${name}". Available:\n${catalog()}`);
  return `# Skill: ${s.name}\n${s.description}\n\nFollow these instructions:\n\n${s.body}`;
}

// ---------- sharing with Claude Code ----------
// Claude Code loads user skills from ~/.claude/skills/<name>/SKILL.md, the same Agent Skills format,
// so skills learned or installed in Skillerr can follow the user into Claude Code.
const CLAUDE_SKILLS = path.join(os.homedir(), '.claude', 'skills');
const SHARED_MARK = '.from-skillerr'; // only ever touch folders we put there

function shareWithClaudeCode() {
  let n = 0;
  for (const s of list()) {
    if (s.source !== 'installed') continue;
    const dest = path.join(CLAUDE_SKILLS, s.name);
    if (fs.existsSync(dest) && !fs.existsSync(path.join(dest, SHARED_MARK))) continue; // the user's own skill of that name wins
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(s.dir, 'SKILL.md'), path.join(dest, 'SKILL.md'));
    fs.writeFileSync(path.join(dest, SHARED_MARK), 'Copied from Skillerr. Skillerr updates this folder; edit the skill in Skillerr instead.\n');
    n++;
  }
  // Skills removed in Skillerr leave Claude Code too.
  try {
    for (const name of fs.readdirSync(CLAUDE_SKILLS)) {
      const dir = path.join(CLAUDE_SKILLS, name);
      if (fs.existsSync(path.join(dir, SHARED_MARK)) && !get(name)) fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {}
  return n;
}

// ---------- learning: an AI turns a procedure it worked out into a skill ----------
// Written as a plain Agent Skills folder in USER_DIR, so it loads like any installed skill
// (and can be copied into Claude Code or Cursor as-is).
const yamlString = (s) => JSON.stringify(String(s)); // JSON strings are valid YAML double-quoted scalars

function learn({ name, description, instructions, topics, by }) {
  const slug = String(name || '').trim().toLowerCase();
  if (!NAME_RE.test(slug) || slug.length > 64) throw new Error('name must be lowercase letters, digits and hyphens, e.g. "ana-flight-search".');
  const desc = String(description || '').replace(/\s+/g, ' ').trim();
  if (desc.length < 20) throw new Error('description must say when to use this skill (which site or task), in one sentence.');
  const body = String(instructions || '').trim();
  if (body.length < 40) throw new Error('instructions are too short to be a reusable procedure. Use save_note for answers.');
  const existing = get(slug);
  if (existing && existing.source === 'built-in') throw new Error(`"${slug}" is a built-in skill. Pick another name.`);
  const dir = path.join(USER_DIR, slug);
  const prev = existing && existing.trust && existing.trust.state === 'learned' ? existing.trust : null;
  const tags = [].concat(topics || []).map((t) => String(t).replace(/[;\n]/g, ' ').trim()).filter(Boolean);
  const md = `---\nname: ${slug}\ndescription: ${yamlString(desc)}\nmetadata:\n  skillerr-icon: ${existing?.icon || 'sparkle'}\n  skillerr-learned: "true"\n` +
    (tags.length ? `  skillerr-topics: ${yamlString(tags.join('; '))}\n` : '') + `---\n\n${body}\n`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), md);
  const when = new Date().toISOString().slice(0, 10);
  const trust = { state: 'learned', summary: `Learned by ${by} on ${prev ? prev.first : when}${prev ? `, updated ${when}` : ''}`, first: prev ? prev.first : when };
  fs.writeFileSync(path.join(dir, TRUST_FILE), JSON.stringify(trust, null, 2));
  return { updated: !!existing, skill: summary(readSkill(dir, 'installed')), file: path.join(dir, 'SKILL.md') };
}

module.exports = { list: () => list().map(summary), get, catalog, inspect, install, remove, learn, listText, useText, shareWithClaudeCode, USER_DIR, CLAUDE_SKILLS };
