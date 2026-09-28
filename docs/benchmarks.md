# Benchmarks: Skillerr vs Chrome (and how to compare Comet and Dia)

Measured on 28 Sep 2026. Skillerr on Electron 44.4.5 (Chromium 152.0.7977.130) against **Chrome for Testing
152.0.7977.85**, the same engine version, so the comparison isolates what Skillerr adds on top of Chromium.

## Results

Linux x64, 4 vCPUs, 15 GB RAM, no GPU (Xvfb, software rendering), 1440×920 window, fresh profile for every run, one
browser at a time. Absolute scores are low because there's no GPU and few cores; what matters is the gap between the
two.

| | Chrome 152 | Skillerr (Chromium 152) | Difference |
|---|---|---|---|
| **Speedometer 3.1** (3 runs) | 16.0, 15.6, 16.0 · **median 16.0** | 15.6, 16.3, 16.7 · **median 16.3** | Same, within run-to-run noise (±3%) |
| **Memory, idle** (PSS, 3 runs) | 497–504 MB, 12 processes | 385–386 MB, 9 processes | **Skillerr ~23% lower** |
| **Memory, 5 heavy pages** (PSS, 3 runs) | 610–619 MB, 15 processes | 564–566 MB, 14 processes | **Skillerr ~8% lower** |
| **Startup** | 255–341 ms to DevTools ready | 613–615 ms until its API was ready; **now 216 ms** (see [Startup](#startup)) | Measured before the startup work; not the same finish line |

How it was run:

- **Speedometer:** version 3.1 (release branch), served locally, `?startAutomatically=true`, 10 iterations per run.
  Skillerr ran it in a normal tab, opened with its own `navigate` tool the way an AI would, with the side panel showing.
  The score was read over DevTools.
- **Memory:** PSS summed over every process of the browser. PSS splits shared pages fairly, unlike RSS. The five heavy
  pages are Speedometer's own workloads (Next.js and Nuxt news sites, a code editor, charts, stock charts). For Skillerr,
  "idle" includes its own UI: the side panel, the AI status bar and the caption layer.
- `scripts/bench/compare-browsers.mjs` repeats the Speedometer and memory runs
  on any machine (below).

### What the numbers mean

- **Page speed is Chromium's.** Speedometer, JetStream and MotionMark measure the engine (V8, Blink, the renderer). Any
  Chromium browser on the same Chromium version scores the same within noise: Chrome, Comet, Dia, Brave, Edge, Arc and
  Skillerr alike. Skillerr adds no overhead to pages.
- **Memory is where Skillerr differs.** Chrome for Testing starts more background services (a spare renderer, component
  extensions, more utility processes). Everyday Chrome with sync and extensions can use more. Skillerr also sleeps
  tabs nobody is using after 4 minutes, which this test didn't reach.
- **Startup** was the one place Skillerr was behind. It has since been reworked; see [Startup](#startup) below.

### Found while benchmarking

Speedometer never started in Skillerr the first time. It asks for a screen wake lock and waits for the answer. Chrome
grants that silently; Skillerr showed an Allow/Block prompt, and the page waited forever. That's worse when an AI is
driving and nobody is watching. Fixed: harmless permissions (wake lock, fullscreen, clipboard write…) are granted
without asking, as Chrome does.

## Comet and Dia

Both are macOS and Windows apps, so they couldn't run in this Linux sandbox, and there are no public numbers here that
could be verified. Both are Chromium-based, so their page-speed scores follow their Chromium version, like everyone
else's. To measure all of them on one Mac:

```bash
npm i --no-save playwright-core
node scripts/bench/compare-browsers.mjs            # Chrome, Comet, Dia, Brave, Edge, Skillerr, if installed
node scripts/bench/compare-browsers.mjs --runs 5 --only Chrome,Comet,Dia,Skillerr
```

It gives each browser a fresh profile, runs Speedometer 3.1 from browserbench.org N times, then measures memory (RSS of
the process tree) idle and with five heavy pages, and prints a table. Browsers that refuse a DevTools port show as
skipped. Close the browsers first, plug in power and leave the machine alone. It takes about 5 minutes per run.

Benchmarks that would really separate these browsers measure the AI, not the engine:

- **Task success** on a fixed task set (a subset of Online-Mind2Web or WebVoyager), with the same model driving each.
- **Tokens and wall time per task:** how much page text the AI has to read, how many steps it takes, how long it waits.
- **Safety:** prompt-injection pages (like `demo/safety-demo.html`); did anything sensitive happen without the user?

Skillerr works with any MCP model, which makes an apples-to-apples agent benchmark possible (Claude driving Skillerr
vs Claude with Playwright MCP vs Browserbase). Comet and Dia each ship their own assistant, so for them it measures the
whole product.

## Getting to the top

**The engine (Speedometer, JetStream).** No Chromium browser can beat another on the same Chromium version by much, so:

1. **Stay current.** Take each Electron release (and its Chromium) within days. A browser a Chromium version behind
   loses these benchmarks, and security fixes too.
2. **Add nothing to pages.** Skillerr injects one tiny script per page (the passkey watcher) and runs everything else
   only when an AI asks. Keep it that way.

**Memory and startup, where Skillerr can lead:**

3. ~~Create the status bar and caption layers lazily~~ and ~~load research memory after the window~~. **Done**, see
   [Startup](#startup).
4. **Bundle the UI scripts.** Load them as one bundle instead of four files. Small gain expected: the UI is ready about
   80 ms after its window, and most of that is the renderer process starting.
5. **Sleep tabs sooner** under memory pressure, and discard fleet tiles as soon as the AI is done with them.

**The benchmarks that matter for an AI browser, where Skillerr can win outright:**

6. **Fewer tokens per page.** Tighten `snapshot` and `read_page` output (skip boilerplate, collapse repeated items), and
   publish tokens-per-task against Playwright MCP and built-in web tools.
7. **Parallel by default.** `open_tabs` and `dispatch` already run tabs concurrently. Measure and publish wall time on
   multi-site tasks, where one-tab agents are slow.
8. **Recall saves work.** Measure how many steps `recall` saves on repeat research. No other browser keeps research
   memory across AIs.

## Startup

Measured with `SKILLERR_TRACE_STARTUP=1`, which prints each start-up step to stderr. Production bundle, same Linux box,
median of 5 warm starts after one cold start. "Heavy" is a profile with 17,400 pages and 300 research sessions (20 MB of
memory logs), about what a Chrome history import produces.

| Step | Before, empty | After, empty | Before, heavy | After, heavy |
|---|---|---|---|---|
| Electron ready (`app ready`) | 172 ms | **145 ms** | 317 ms | **142 ms** |
| Local API ready: AI apps can connect | 498 ms | **216 ms** | 626 ms | **213 ms** |
| Browser UI interactive | 319 ms | 328 ms (same, within noise) | 455 ms | **291 ms** |
| First tab open | ~400 ms | **374 ms** | ~530 ms | **378 ms** |
| Renderer processes at start | 4 (UI, status bar, captions, tab) | 3 (captions only when recording) | | |

What changed (`src/main.js`, `src/memory.js`, `src/embed.js`, `src/boot.js`):

1. **Research memory loads lazily.** Before, the whole graph was read and parsed before Electron was even ready (+135 ms
   on the heavy profile, blocking everything). Now it loads on first use, or in the background 250 ms after the first
   tab. A write before the first read loads the graph first, so nothing is lost (tested). The embedding vectors work
   the same way.
2. **The local API starts as soon as the window exists**, instead of after every view has loaded. AI calls that arrive
   early wait on a "ready" signal and then run normally. AI apps can connect about 280 ms sooner, 400 ms sooner on a
   heavy profile.
3. **The first tab opens right after the UI.** The AI status bar loads afterwards without blocking; when it's loaded it's
   sent the current status and any approvals already waiting.
4. **The caption layer is only created on the first caption** of a recording: one fewer renderer process for everyone
   who doesn't record.
5. **V8 compile cache.** `src/boot.js` turns on Node's on-disk code cache before loading the 720 KB main bundle. After
   the first start, "main.js running" drops from about 94 ms to about 67 ms, Electron's own floor on this box.

Tried and dropped: starting the UI page before creating the native window, so the two overlap. On 4 cores the renderer
and window creation competed, and UI-interactive got slower and noisier (335–343 ms).

The floor: a bare Electron app with an empty main script reaches "main running" at about 65 ms and "app ready" at about
120 ms here. Skillerr is now within about 25 ms of that before its window, and the rest is creating the window (about
55 ms, native) and the UI's renderer process.

## Why pick Skillerr over Chrome

| | Chrome | Skillerr |
|---|---|---|
| **Which AI** | Google's assistant built in, or one extension at a time | Any AI over MCP (Claude Desktop, Claude Code, Cursor, local models), several at once |
| **Watching the AI** | Depends on the extension | Every page opens in a visible tab; fleet view for parallel work; live view inside Claude Desktop |
| **Safety** | Up to each extension | Built into the browser: payments, passwords, sign-ins and deletions wait for you; robot checks go to you; Pause, Take over, Undo |
| **Memory of research** | History only | A local research graph, recall by meaning, topic folders and notes on disk, learned skills, shared across AIs |
| **Privacy** | Account sync and Google services | Everything local, no telemetry |
| **Page speed** | Chromium | The same Chromium: measured the same |
| **Memory use** | Measured 615 MB with 5 heavy pages | Measured 565 MB with 5 heavy pages, plus sleeping tabs |

**Where Chrome is still better:** extensions (Chrome Web Store), sync across devices, iCloud Keychain passkeys on Mac
(see [passkeys.md](passkeys.md)), and security patches the day they ship (Skillerr follows Electron's releases).

**Comet and Dia** are the closest in spirit: AI browsers built on Chromium. The difference is that each is built around
its own assistant (Perplexity's, and The Browser Company's), while Skillerr is built for the AI you already use, keeps
the research on your machine, and lets you watch and stop any AI mid-task.
