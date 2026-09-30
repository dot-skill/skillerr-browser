// Which local files an AI may attach to a page (upload_file). Only files the user could reasonably mean: never
// anything in Skillerr's own data, SSH or GPG keys, cloud and package-manager credentials, keychains, password managers
// or browser profiles (cookies and saved passwords). Every upload still needs the user's OK in Skillerr (src/main.js);
// this check runs before that is asked, and again right before the files are handed to the page.

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_FILES = 10;
const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB each: enough for a video post, not a disk image

// Folders under the home folder whose contents are never uploaded.
const HOME_BLOCKED = [
  '.skillerr', // Skillerr's own settings, memory and keys, and the skillerr CLI's trust store
  '.ssh', '.gnupg', '.gpg',
  '.aws', '.azure', '.config/gcloud', '.oci', '.kube', '.docker', '.terraform.d', '.vault-token',
  '.netrc', '.npmrc', '.yarnrc', '.pypirc', '.git-credentials', '.config/git/credentials', '.pgpass', '.my.cnf',
  '.config/gh', '.config/hub', '.cargo/credentials', '.cargo/credentials.toml', '.gem/credentials', '.m2/settings.xml',
  '.password-store', '.local/share/keyrings', '.local/share/kwalletd', '.pki',
  '.config/1Password', '.config/Bitwarden', '.config/KeePassXC',
  // Browser profiles: cookies, saved passwords and sessions.
  '.mozilla', '.config/google-chrome', '.config/chromium', '.config/BraveSoftware', '.config/microsoft-edge', '.config/vivaldi',
  '.config/Skillerr', '.config/skillerr-browser',
  // macOS
  'Library/Keychains', 'Library/Cookies', 'Library/Application Support/Skillerr', 'Library/Application Support/skillerr-browser',
  'Library/Application Support/Google/Chrome', 'Library/Application Support/Chromium', 'Library/Application Support/Firefox',
  'Library/Application Support/BraveSoftware', 'Library/Application Support/Microsoft Edge', 'Library/Application Support/Arc',
  'Library/Application Support/1Password', 'Library/Application Support/Bitwarden', 'Library/Group Containers/2BUA8C4S2C.com.1password',
  'Library/Safari', 'Library/Containers/com.apple.Safari',
  // Windows
  'AppData/Roaming/Microsoft/Credentials', 'AppData/Local/Microsoft/Credentials', 'AppData/Roaming/Microsoft/Protect',
  'AppData/Roaming/Microsoft/Crypto', 'AppData/Roaming/Microsoft/SystemCertificates', 'AppData/Roaming/Microsoft/Vault',
  'AppData/Local/Microsoft/Vault', 'AppData/Roaming/Skillerr', 'AppData/Roaming/skillerr-browser',
  'AppData/Local/Google/Chrome/User Data', 'AppData/Local/Chromium/User Data', 'AppData/Local/Microsoft/Edge/User Data',
  'AppData/Local/BraveSoftware', 'AppData/Roaming/Mozilla', 'AppData/Local/1Password', 'AppData/Roaming/Bitwarden',
];

// System-wide credential stores.
const SYSTEM_BLOCKED = [
  '/etc/shadow', '/etc/gshadow', '/etc/sudoers', '/etc/sudoers.d', '/etc/ssh', '/etc/ssl/private',
  '/Library/Keychains', '/System/Library/Keychains', '/private/var/db', '/var/db/sudo', '/private/etc/master.passwd', '/etc/master.passwd',
  '/proc', '/sys', '/dev',
];

// Files that are keys or secrets wherever they are.
const SECRET_NAMES = [
  /^\.env(\..+)?$/i, /^id_(rsa|dsa|ecdsa|ed25519)(_sk)?(\.pub)?$/i, /\.(pem|key|p12|pfx|jks|keystore|kdbx|kdb|keychain|keychain-db|gpg|asc|ovpn)$/i,
  /^(credentials|\.netrc|_netrc|\.pgpass|\.htpasswd|known_hosts|authorized_keys)$/i, /^(login data|local state|cookies|web data)(-journal)?$/i,
];

// Extra folders main.js adds at start-up (Electron's userData, the store folder), in case they live elsewhere.
let extraBlocked = [];
const configure = ({ blocked = [] } = {}) => (extraBlocked = blocked.filter(Boolean).map((p) => path.resolve(p)));

const caseless = (platform) => platform === 'darwin' || platform === 'win32';

// Is `p` the folder `dir` or inside it?
function inside(p, dir, platform) {
  const norm = (s) => {
    let n = path.resolve(s).replace(/\\/g, '/').replace(/\/+$/, '');
    return caseless(platform) ? n.toLowerCase() : n;
  };
  const a = norm(p);
  const b = norm(dir);
  return a === b || a.startsWith(b + '/');
}

// A folder as given and where it really is: a link's target resolves to the real path (on macOS /var is really
// /private/var, and a home folder can be a link), so blocked folders are matched both ways.
function bothWays(dir) {
  try {
    const real = fs.realpathSync.native(dir);
    return real === dir ? [dir] : [dir, real];
  } catch {
    return [dir];
  }
}

// Why `real` (a resolved absolute path) may not be uploaded, or null if it may.
function blockedReason(real, { home = os.homedir(), platform = process.platform } = {}) {
  const homes = bothWays(path.resolve(home));
  const inAny = (dirs) => dirs.some((d) => bothWays(d).some((x) => inside(real, x, platform)));
  if (homes.some((h) => HOME_BLOCKED.some((d) => inside(real, path.join(h, ...d.split('/')), platform)))) return 'it is in a folder that holds keys, passwords or Skillerr\'s own data';
  if (inAny(SYSTEM_BLOCKED)) return 'it is a system file';
  if (inAny(extraBlocked)) return 'it is part of Skillerr\'s own data';
  if (/^[a-z]:[\\/]windows[\\/](system32|syswow64)[\\/]config([\\/]|$)/i.test(real)) return 'it is a system file';
  if (SECRET_NAMES.some((re) => re.test(path.basename(real)))) return 'it looks like a key, password or credentials file';
  return null;
}

// Check the paths an AI asked to upload. Returns [{ path (the real file), name, size }] or throws an Error saying
// which path was refused and why. `home`/`platform` are for tests.
function checkPaths(paths, opts = {}) {
  const home = opts.home || os.homedir();
  const platform = opts.platform || process.platform;
  if (!Array.isArray(paths) || !paths.length) throw new Error('Give the file to attach as paths: ["/full/path/to/file"].');
  if (paths.length > MAX_FILES) throw new Error(`Attach at most ${MAX_FILES} files at a time.`);
  const out = [];
  for (const raw of paths) {
    const given = String(raw ?? '').trim();
    if (!given || given.includes('\0')) throw new Error('One of the paths is empty.');
    const expanded = given === '~' || /^~[\\/]/.test(given) ? path.join(home, given.slice(1)) : given;
    if (!path.isAbsolute(expanded)) throw new Error(`“${given}” is not a full path. Give the full path to the file, e.g. ${path.join(home, 'Pictures', 'photo.png')}.`);
    const resolved = path.resolve(expanded);
    // Check the path as given and where it really leads, so a link can't smuggle out a key.
    let why = blockedReason(resolved, { home, platform });
    let real = resolved;
    if (!why) {
      try {
        real = fs.realpathSync.native(resolved);
      } catch {
        throw new Error(`There is no file at ${given}.`);
      }
      why = blockedReason(real, { home, platform });
    }
    if (why) throw new Error(`Skillerr won't upload ${given}: ${why}.`);
    const st = fs.statSync(real);
    if (!st.isFile()) throw new Error(`${given} is not a file.`);
    if (st.size > MAX_BYTES) throw new Error(`${given} is larger than 1 GB.`);
    out.push({ path: real, name: path.basename(real), size: st.size });
  }
  return out;
}

// "card-tabs.png", "card-tabs.png and demo.mp4", "a.png, b.png and 3 more"
function namesText(paths) {
  const names = (paths || []).map((p) => String(p).split(/[\\/]/).pop()).filter(Boolean);
  if (names.length <= 2) return names.join(' and ') || 'a file';
  return names.length === 3 ? `${names[0]}, ${names[1]} and ${names[2]}` : `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

module.exports = { checkPaths, blockedReason, namesText, configure, MAX_FILES };
