// After packaging, keep only the installers in dist/. The unpacked apps electron-builder leaves behind
// get indexed by macOS and show up in Launchpad and Spotlight as extra copies of Skillerr.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
for (const name of fs.existsSync(dist) ? fs.readdirSync(dist) : []) {
  const dir = path.join(dist, name);
  if (!fs.statSync(dir).isDirectory() || !/^(mac|mac-arm64|mac-universal|.*-unpacked)$/.test(name)) continue;
  if (process.platform === 'darwin') {
    for (const app of fs.readdirSync(dir).filter((f) => f.endsWith('.app'))) {
      try { execFileSync(lsregister, ['-u', path.join(dir, app)]); } catch {}
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
