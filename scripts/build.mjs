// Production build: bundle + minify the app into out/ (packed into app.asar by electron-builder).
// Readable source never ships; node_modules isn't needed at runtime because dependencies are bundled.
// Note: this deters casual copying, it is not encryption. Real secrets must stay server-side.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'out');
fs.rmSync(out, { recursive: true, force: true });

const node = { platform: 'node', format: 'cjs', target: 'node22', bundle: true, minify: true, legalComments: 'none',
  external: ['electron', 'node:*'], logLevel: 'warning' };

// Main process and the MCP bridge (each bundles what it uses, including the SDKs).
await build({ ...node, entryPoints: [path.join(root, 'src/main.js')], outfile: path.join(out, 'src/main.js') });
await build({ ...node, entryPoints: [path.join(root, 'src/preload.js')], outfile: path.join(out, 'src/preload.js') });
await build({ ...node, entryPoints: [path.join(root, 'mcp/bridge.js')], outfile: path.join(out, 'mcp/bridge.js') });

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
  name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, author: pkg.author, main: 'src/main.js', homepage: pkg.homepage,
}, null, 2));
console.log('built out/');
