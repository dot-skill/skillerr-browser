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
  semanticRecall: true, // recall by meaning with a local embedding model, when one is running (src/embed.js)
  embedBaseUrl: '', // OpenAI-compatible embeddings endpoint; default Ollama on this computer
  embedModel: '', // default nomic-embed-text
  deepResearch: false, // follow links from pages being researched
  deepDepth: 3,
  theme: 'system', // 'system' | 'light' | 'dark'
  onboarded: false, // first-launch welcome shown
  searchEngine: 'google', // 'google' (your country's) | 'duckduckgo' | 'bing'
  searchApi: '', // '' (search the results page in a tab) | 'brave' | 'tavily' | 'exa'
  searchApiKey: '',
  sitePermissions: {}, // origin → { permission: 'allow' | 'block' }
  popupsAllowed: {}, // host → true
  sleepTabs: true, // unload tabs nobody is using, to stay light
  kilr: true, // Skillerr's own small AI (src/kilr): trails and recall by meaning, on this computer
  kilrLearn: 'suggest', // retraining on the user's own trails: 'suggest' (ask when due) | 'auto' (when the computer is idle) | 'off'
  kilrLearnEvery: 'weekly', // 'daily' | 'weekly' | 'monthly'
  kilrLearnFromYou: true, // learn from the user's own browsing
  kilrLearnFromAi: true, // learn from research the user's AI apps did in Skillerr
  trailsResearch: true, // keep research an AI app did as a trail of its own ("Research by Claude Desktop")
  kilrLearnedAt: 0,
  kilrSnoozedUntil: 0,
  kilrLastLearn: null, // { at, accepted, report, auto }
  trails: true, // learn the user's ongoing work from their own browsing (src/trails.js)
  trailsTuck: true, // tuck tabs unused for half a day into their trail (the 5 most recent always stay)
  trailsIntroSeen: false,
  trailsAllowedClients: [], // AI apps the user allowed to see their trails
  updateChecks: true, // ask skillerr.com if there's a newer version (sends only the version and platform)
  betaUpdates: false, // also take staging builds (prereleases from the develop branch)
  dismissedNotices: [], // update/notice ids the user closed
};

// Kilr was called Wenlo in staging builds: carry its settings over (wenlo → kilr, wenloLearn → kilrLearn, …).
function renamed(s) {
  for (const k of Object.keys(s)) if (k.startsWith('wenlo') && !(`kilr${k.slice(5)}` in s)) s[`kilr${k.slice(5)}`] = s[k];
  return s;
}

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
  getSettings: () => ({ ...DEFAULTS, ...renamed(readJson(SETTINGS, {})) }),
  saveSettings: (s) => writeJson(SETTINGS, { ...DEFAULTS, ...s }),
  writeSession: (s) => writeJson(SESSION, s),
  readSession: () => readJson(SESSION, null),
  clearSession: () => fs.rmSync(SESSION, { force: true }),
};
