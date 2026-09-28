// Tiny JSON persistence in ~/.skillerr/browser — settings plus the session file the MCP bridge reads.
// ~/.skillerr itself belongs to the skillerr CLI (trust store, keys, its own skills records); the browser keeps to its subfolder.
const fs = require('fs');
const os = require('os');
const path = require('path');

// SKILLERR_PROFILE=demo keeps a separate profile (memory, settings, session) for recordings and tests.
const PROFILE = /^[a-z0-9-]+$/.test(process.env.SKILLERR_PROFILE || '') ? process.env.SKILLERR_PROFILE : '';
const DIR = path.join(os.homedir(), '.skillerr', PROFILE ? `browser-${PROFILE}` : 'browser');
const SETTINGS = path.join(DIR, 'settings.json');
const SESSION = path.join(DIR, 'session.json');

const DEFAULTS = {
  provider: 'anthropic', // 'anthropic' | 'openai-compatible'
  model: 'claude-opus-5',
  apiKey: '',
  baseUrl: '',
  requireApproval: false,
  remember: true, // research memory (src/memory.js)
  deepResearch: false, // follow links from pages being researched
  deepDepth: 3,
  theme: 'system', // 'system' | 'light' | 'dark'
  onboarded: false, // first-launch welcome shown
  searchEngine: 'google', // 'google' (your country's) | 'duckduckgo' | 'bing'
  sitePermissions: {}, // origin → { permission: 'allow' | 'block' }
  popupsAllowed: {}, // host → true
  sleepTabs: true, // unload tabs nobody is using, to stay light
  updateChecks: true, // ask skillerr.com if there's a newer version (sends only the version and platform)
  dismissedNotices: [], // update/notice ids the user closed
};

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}

module.exports = {
  PROFILE,
  readJson: (name, fallback) => readJson(path.join(DIR, name), fallback),
  writeJson: (name, data) => writeJson(path.join(DIR, name), data),
  DIR,
  SESSION,
  getSettings: () => ({ ...DEFAULTS, ...readJson(SETTINGS, {}) }),
  saveSettings: (s) => writeJson(SETTINGS, { ...DEFAULTS, ...s }),
  writeSession: (s) => writeJson(SESSION, s),
  readSession: () => readJson(SESSION, null),
  clearSession: () => fs.rmSync(SESSION, { force: true }),
};
