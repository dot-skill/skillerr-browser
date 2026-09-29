// Builds mcp/preview.html: the live view AI apps show in their chat (MCP Apps). One self-contained file,
// because the host renders it in a sandboxed iframe with no network: view.js is bundled with the ext-apps SDK,
// and src/ui/shared.js is inlined for the same plain-English step labels as Skillerr's own panel.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'mcp', 'preview');

const js = await build({ entryPoints: [path.join(dir, 'view.js')], bundle: true, minify: true, format: 'iife', target: 'es2022',
  platform: 'browser', write: false, legalComments: 'none', logLevel: 'warning' });
// bundle: the Skillerr mark (src/ui/mark.svg) goes in as a data URL, since the view can't load files.
const css = await build({ entryPoints: [path.join(dir, 'view.css')], bundle: true, loader: { '.svg': 'dataurl' }, minify: true, write: false, logLevel: 'warning' });
const shared = await build({ entryPoints: [path.join(root, 'src/ui/shared.js')], minify: true, write: false, logLevel: 'warning' });

const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
const html = fs.readFileSync(path.join(dir, 'view.html'), 'utf8')
  .replace('/*CSS*/', () => css.outputFiles[0].text)
  .replace('/*SHARED*/', () => safe(shared.outputFiles[0].text))
  .replace('/*VIEW*/', () => safe(js.outputFiles[0].text));
fs.writeFileSync(path.join(root, 'mcp', 'preview.html'), html);
console.log(`built mcp/preview.html (${Math.round(html.length / 1024)} KB)`);
