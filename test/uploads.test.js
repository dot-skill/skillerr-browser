const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const uploads = require('../src/uploads');

// A fake home folder with ordinary files and credential stores.
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-upload-'));
  const put = (rel, body = 'x') => {
    const p = path.join(home, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    return p;
  };
  return { home, put };
}

test('ordinary files the user could mean are allowed, with ~ expanded', () => {
  const { home, put } = makeHome();
  const png = put('Pictures/card-tabs.png', 'png');
  const mp4 = put('Movies/Skillerr/demo.mp4', 'mp4mp4');
  const files = uploads.checkPaths(['~/Pictures/card-tabs.png', mp4], { home, platform: 'linux' });
  assert.deepStrictEqual(files.map((f) => f.name), ['card-tabs.png', 'demo.mp4']);
  assert.strictEqual(files[0].path, fs.realpathSync.native(png));
  assert.strictEqual(files[1].size, 6);
});

test('files in credential folders are refused', () => {
  const { home, put } = makeHome();
  for (const rel of [
    '.skillerr/browser/settings.json', '.skillerr/keys/signing.json', '.ssh/config', '.gnupg/pubring.kbx', '.aws/config',
    '.config/gcloud/application_default_credentials.json', '.kube/config', '.docker/config.json', '.password-store/site.txt',
    '.local/share/keyrings/login.txt', 'Library/Keychains/login.txt', '.config/google-chrome/Default/History',
    'Library/Application Support/Google/Chrome/Default/Preferences', 'AppData/Roaming/Microsoft/Credentials/blob',
  ]) {
    const p = put(rel);
    assert.throws(() => uploads.checkPaths([p], { home, platform: 'linux' }), /won't upload/, rel);
  }
});

test('key and secret files are refused wherever they are', () => {
  const { home, put } = makeHome();
  for (const rel of ['Desktop/id_rsa', 'Desktop/id_ed25519.pub', 'code/app/.env', 'code/app/.env.local', 'Downloads/server.pem',
    'Downloads/cert.p12', 'Documents/vault.kdbx', 'Documents/credentials']) {
    const p = put(rel);
    assert.throws(() => uploads.checkPaths([p], { home, platform: 'linux' }), /won't upload/, rel);
  }
  // Similar names that are just ordinary files stay allowed.
  const ok = put('Documents/environment.png');
  assert.strictEqual(uploads.checkPaths([ok], { home, platform: 'linux' }).length, 1);
});

test('a link can\'t smuggle out a blocked file', { skip: process.platform === 'win32' }, () => {
  const { home, put } = makeHome();
  const key = put('.ssh/id_work', 'secret');
  const link = path.join(home, 'Pictures', 'holiday.png');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(key, link);
  assert.throws(() => uploads.checkPaths([link], { home, platform: 'linux' }), /won't upload/);
  // …nor a path that walks back into one.
  assert.throws(() => uploads.checkPaths([path.join(home, 'Pictures', '..', '.ssh', 'id_work')], { home, platform: 'linux' }), /won't upload/);
});

test('blocked folders match case-insensitively on macOS and Windows', () => {
  const { home } = makeHome();
  assert.ok(uploads.blockedReason(path.join(home, '.SSH', 'config'), { home, platform: 'darwin' }));
  assert.ok(uploads.blockedReason(path.join(home, 'library', 'keychains', 'x'), { home, platform: 'darwin' }));
  assert.strictEqual(uploads.blockedReason(path.join(home, '.SSH', 'config'), { home, platform: 'linux' }), null);
  assert.ok(uploads.blockedReason('C:\\Windows\\System32\\config\\SAM', { home, platform: 'win32' }));
});

test('system credential stores are refused', () => {
  const { home } = makeHome();
  for (const p of ['/etc/shadow', '/etc/ssh/ssh_host_rsa_key', '/Library/Keychains/System.keychain', '/proc/self/environ']) {
    assert.ok(uploads.blockedReason(p, { home, platform: 'linux' }), p);
  }
  assert.strictEqual(uploads.blockedReason(path.join(home, 'Pictures', 'a.png'), { home, platform: 'linux' }), null);
});

test('extra folders from main.js (Skillerr\'s own data) are refused', () => {
  const { home, put } = makeHome();
  const p = put('.config/SomeElectronData/Cookies-extra.bin');
  uploads.configure({ blocked: [path.join(home, '.config', 'SomeElectronData')] });
  try {
    assert.throws(() => uploads.checkPaths([p], { home, platform: 'linux' }), /Skillerr's own data/);
  } finally {
    uploads.configure({ blocked: [] });
  }
});

test('bad input: relative, missing, folders, too many, empty', () => {
  const { home, put } = makeHome();
  put('Pictures/a.png');
  assert.throws(() => uploads.checkPaths([], { home }), /paths/);
  assert.throws(() => uploads.checkPaths('~/Pictures/a.png', { home }), /paths/);
  assert.throws(() => uploads.checkPaths(['Pictures/a.png'], { home }), /not a full path/);
  assert.throws(() => uploads.checkPaths(['~/Pictures/missing.png'], { home }), /no file/);
  assert.throws(() => uploads.checkPaths(['~/Pictures'], { home }), /not a file/);
  assert.throws(() => uploads.checkPaths([''], { home }), /empty/);
  assert.throws(() => uploads.checkPaths(Array(uploads.MAX_FILES + 1).fill('~/Pictures/a.png'), { home }), /at most/);
});

test('file names in plain English', () => {
  assert.strictEqual(uploads.namesText(['/a/card-tabs.png']), 'card-tabs.png');
  assert.strictEqual(uploads.namesText(['/a/x.png', 'C:\\b\\y.mp4']), 'x.png and y.mp4');
  assert.strictEqual(uploads.namesText(['a', 'b', 'c']), 'a, b and c');
  assert.strictEqual(uploads.namesText(['a', 'b', 'c', 'd']), 'a, b and 2 more');
});

test('upload_file is a shared tool that needs a target and paths', () => {
  const { TOOLS } = require('../src/tools');
  const t = TOOLS.find((x) => x.name === 'upload_file');
  assert.ok(t);
  assert.deepStrictEqual(t.input_schema.required, ['paths']);
  for (const k of ['id', 'selector', 'paths', 'tab_id']) assert.ok(k in t.input_schema.properties, k);
});
