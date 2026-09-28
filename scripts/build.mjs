// Production build: bundle + minify the app into out/ (packed into app.asar by electron-builder).
// Readable source never ships; node_modules isn't needed at runtime because dependencies are bundled.
// Note: this deters casual copying, it is not encryption. Real secrets must stay server-side.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'out');
fs.rmSync(out, { recursive: true, force: true });

const node = { platform: 'node', format: 'cjs', target: 'node22', bundle: true, minify: true, legalComments: 'none',
  external: ['electron', 'node:*'], logLevel: 'warning' };

// Main process and the MCP bridge (each bundles what it uses, including the SDKs).
await build({ ...node, entryPoints: [path.join(root, 'src/main.js')], outfile: path.join(out, 'src/main.js') });
// boot.js stays a separate, unbundled file: it must turn on the compile cache before main.js is compiled.
await build({ entryPoints: [path.join(root, 'src/boot.js')], outfile: path.join(out, 'src/boot.js'), platform: 'node', format: 'cjs', target: 'node22', minify: true, logLevel: 'warning' });
await build({ ...node, entryPoints: [path.join(root, 'src/preload.js')], outfile: path.join(out, 'src/preload.js') });
// Wenlo's personal retraining runs in a worker thread; it loads this file by path (next to main.js, as in src/).
await build({ ...node, entryPoints: [path.join(root, 'src/wenlo/train-worker.js')], outfile: path.join(out, 'src/wenlo/train-worker.js') });
await build({ ...node, entryPoints: [path.join(root, 'mcp/bridge.js')], outfile: path.join(out, 'mcp/bridge.js') });
await build({ ...node, entryPoints: [path.join(root, 'mcp/setup.js')], outfile: path.join(out, 'mcp/setup.js') });

// Live view for AI apps (MCP Apps): one self-contained HTML file next to the bridge.
execFileSync(process.execPath, [path.join(root, 'scripts/build-preview.mjs')], { stdio: 'inherit' });
fs.copyFileSync(path.join(root, 'mcp/preview.html'), path.join(out, 'mcp/preview.html'));

// Browser UI: minify each script (they share globals, so no bundling), copy markup, styles and images.
const ui = path.join(root, 'src/ui');
fs.mkdirSync(path.join(out, 'src/ui'), { recursive: true });
for (const f of fs.readdirSync(ui)) {
  const src = path.join(ui, f);
  const dst = path.join(out, 'src/ui', f);
  if (fs.statSync(src).isDirectory()) fs.cpSync(src, dst, { recursive: true });
  else if (f.endsWith('.js')) await build({ entryPoints: [src], outfile: dst, minify: true, bundle: false, target: 'chrome130', legalComments: 'none', logLevel: 'warning' });
  else if (f.endsWith('.css')) await build({ entryPoints: [src], outfile: dst, minify: true, loader: { '.css': 'css' }, logLevel: 'warning' });
  else fs.copyFileSync(src, dst);
}

for (const dir of ['skills', 'assets']) fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({
  name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, author: pkg.author, main: 'src/boot.js', homepage: pkg.homepage,
  // A Developer ID build can update itself in place on macOS (see autoUpdater in src/main.js).
  skillerrSigned: !!(process.env.CSC_LINK || process.env.CSC_NAME),
  // Touch ID passkeys: must match the keychain-access-groups entitlement (electron-builder.config.cjs).
  ...((process.env.CSC_LINK || process.env.CSC_NAME) && process.env.APPLE_TEAM_ID ? { skillerrKeychainGroup: `${process.env.APPLE_TEAM_ID}.com.skillerr.browser.webauthn` } : {}),
}, null, 2));
console.log('built out/');
