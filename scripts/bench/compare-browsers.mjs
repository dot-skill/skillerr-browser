// Compare Skillerr with other Chromium browsers (Chrome, Comet, Dia, Brave, Edge…) on one machine:
// Speedometer 3.1 (runs × median) and memory with five heavy pages open. Every browser gets a fresh throwaway profile.
//
//   npm i --no-save playwright-core
//   node scripts/bench/compare-browsers.mjs                  # every browser found in /Applications (macOS)
//   node scripts/bench/compare-browsers.mjs --runs 5 --only Chrome,Skillerr
//   BROWSERS='{"Chrome":"/path/to/chrome"}' node scripts/bench/compare-browsers.mjs
//
// Close the browsers first, plug in power, and leave the machine alone while it runs (about 5 minutes per run).
// Browsers that refuse a DevTools port (--remote-debugging-port) are reported as skipped.
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const RUNS = Number(opt('--runs', 3));
const ONLY = opt('--only', '').split(',').filter(Boolean);
const SPEEDOMETER = opt('--url', 'https://browserbench.org/Speedometer3.1/');
const PAGES = ['newssite/news-next/dist/index.html', 'newssite/news-nuxt/dist/index.html', 'editors/dist/index.html', 'charts/dist/index.html',
  'react-stockcharts/build/index.html'].map((p) => new URL(`resources/${p}`, SPEEDOMETER).href);

const MAC = {
  Chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  Comet: '/Applications/Comet.app/Contents/MacOS/Comet',
  Dia: '/Applications/Dia.app/Contents/MacOS/Dia',
  Brave: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  Edge: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  Skillerr: '/Applications/Skillerr.app/Contents/MacOS/Skillerr',
};
const browsers = Object.entries(process.env.BROWSERS ? JSON.parse(process.env.BROWSERS) : MAC)
  .map(([name, cmd]) => [name, [].concat(cmd)]) // a path, or [path, ...extra args] (e.g. an unpacked Electron app)
  .filter(([name, cmd]) => fs.existsSync(cmd[0]) && (!ONLY.length || ONLY.includes(name)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

// Memory of a process tree (RSS, MB). PSS isn't available on macOS; RSS overcounts shared pages the same way for everyone.
function treeRssMb(pid) {
  const rows = execSync('ps -axo pid=,ppid=,rss=').toString().trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map();
  for (const [p, pp] of rows) kids.set(pp, [...(kids.get(pp) || []), p]);
  const rss = new Map(rows.map(([p, , r]) => [p, r]));
  let total = 0;
  const stack = [pid];
  while (stack.length) {
    const p = stack.pop();
    total += rss.get(p) || 0;
    stack.push(...(kids.get(p) || []));
  }
  return Math.round(total / 1024);
}

// Skillerr runs as a separate profile (SKILLERR_PROFILE=bench) and is driven through its own local API, like an AI would.
const SK_DIR = path.join(os.homedir(), '.skillerr', 'browser-bench');
async function skillerrCall(name, args) {
  const s = JSON.parse(fs.readFileSync(path.join(SK_DIR, 'session.json'), 'utf8'));
  const r = await fetch(`http://127.0.0.1:${s.port}/call`, { method: 'POST', headers: { authorization: `Bearer ${s.token}` }, body: JSON.stringify({ client: 'Benchmark', name, args }) });
  return r.json();
}

async function launch(name, cmd, port) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `bench-${name}-`));
  const env = { ...process.env };
  if (name === 'Skillerr') {
    fs.rmSync(SK_DIR, { recursive: true, force: true });
    fs.mkdirSync(SK_DIR, { recursive: true });
    fs.writeFileSync(path.join(SK_DIR, 'settings.json'), JSON.stringify({ onboarded: true, updateChecks: false }));
    env.SKILLERR_PROFILE = 'bench';
  }
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'];
  const proc = spawn(cmd[0], [...cmd.slice(1), ...args], { env, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      if (name === 'Skillerr') while (!fs.existsSync(path.join(SK_DIR, 'session.json'))) await sleep(200);
      return { b, proc, profile };
    } catch {
      await sleep(200);
    }
  }
  proc.kill();
  throw new Error('no DevTools port');
}

async function open(name, b, url) {
  if (name === 'Skillerr') {
    await skillerrCall('new_tab', { url });
    return null;
  }
  const ctx = b.contexts()[0] || (await b.newContext());
  const p = await ctx.newPage();
  await p.goto(url).catch(() => {});
  return p;
}

async function speedometer(name, b) {
  const url = `${SPEEDOMETER}?startAutomatically=true&t=${Date.now()}`;
  let p = await (name === 'Skillerr' ? skillerrCall('navigate', { url }).then(() => null) : open(name, b, url));
  for (let i = 0; !p && i < 50; i++) {
    p = b.contexts().flatMap((c) => c.pages()).find((x) => x.url().startsWith(url.split('#')[0]));
    if (!p) await sleep(200);
  }
  await p.waitForFunction(() => /\d/.test(document.getElementById('result-number')?.textContent || '') && document.body.dataset.benchmarkState !== 'running',
    null, { timeout: 30 * 60 * 1000, polling: 2000 });
  return Number(await p.evaluate(() => document.getElementById('result-number').textContent));
}

const results = [];
let port = 9400;
for (const [name, bin] of browsers) {
  process.stdout.write(`${name}: `);
  try {
    const scores = [];
    for (let i = 0; i < RUNS; i++) {
      const { b, proc } = await launch(name, bin, port++);
      await sleep(3000);
      scores.push(await speedometer(name, b));
      process.stdout.write(`${scores.at(-1)} `);
      await b.close().catch(() => {});
      proc.kill();
      await sleep(3000);
    }
    const { b, proc } = await launch(name, bin, port++);
    await sleep(8000);
    const idle = treeRssMb(proc.pid);
    for (const u of PAGES) await open(name, b, u);
    await sleep(15000);
    const loaded = treeRssMb(proc.pid);
    await b.close().catch(() => {});
    proc.kill();
    results.push({ name, speedometer: median(scores), runs: scores, idleMb: idle, fivePagesMb: loaded });
    console.log(`→ median ${median(scores)}, ${idle} MB idle, ${loaded} MB with 5 pages`);
  } catch (err) {
    console.log(`skipped (${err.message})`);
    results.push({ name, skipped: err.message });
  }
  await sleep(3000);
}

console.log('\n| Browser | Speedometer 3.1 (median) | Runs | Memory idle | Memory, 5 pages |\n|---|---|---|---|---|');
for (const r of results) {
  console.log(r.skipped ? `| ${r.name} | skipped: ${r.skipped} | | | |` : `| ${r.name} | ${r.speedometer} | ${r.runs.join(', ')} | ${r.idleMb} MB | ${r.fivePagesMb} MB |`);
}
console.log(`\n${os.cpus()[0].model}, ${Math.round(os.totalmem() / 2 ** 30)} GB, ${os.platform()} ${os.release()}, ${new Date().toISOString().slice(0, 10)}`);
