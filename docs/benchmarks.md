# Benchmarks

Skillerr compared with **Chrome for Testing 152**, running the same Chromium version (152), so the numbers show what
Skillerr adds on top of the engine. Measured 28 September 2026.

**Setup:** Linux x64, 4 vCPUs, 15 GB RAM, no GPU (software rendering), 1440×920 window, a fresh profile for every run,
one browser at a time, 3 runs each. Absolute scores are low without a GPU; the comparison is what matters.

## Results

| | Chrome 152 | Skillerr (Chromium 152) | |
|---|---|---|---|
| **Speedometer 3.1** | median **16.0** (16.0, 15.6, 16.0) | median **16.3** (15.6, 16.3, 16.7) | Same, within run-to-run noise |
| **Memory, idle** | 497–504 MB, 12 processes | **385–386 MB**, 9 processes | **~23% lower** |
| **Memory, 5 heavy pages** | 610–619 MB, 15 processes | **564–566 MB**, 14 processes | **~8% lower** |
| **Ready for an AI to connect** | — | **216 ms** after launch | |

- **Speedometer 3.1** ran 10 iterations per run, in a normal Skillerr tab opened the way an AI opens one, with the side
  panel showing.
- **Memory** is PSS summed over every process of the browser (PSS splits shared pages fairly, unlike RSS). The five heavy
  pages are Speedometer's own workloads. For Skillerr, "idle" includes its own interface: the side panel, the AI status
  bar and the caption layer.

## What the numbers mean

- **Page speed is Chromium's.** Speedometer, JetStream and MotionMark measure the engine, so any Chromium browser on the
  same version scores the same within noise. Skillerr adds no overhead to pages.
- **Memory is where Skillerr differs.** It starts fewer background processes than Chrome, and it puts tabs nobody is
  using to sleep after a few minutes, which these runs didn't reach.

## Startup

With the production build, median of 5 warm starts. "Large profile" is 17,400 pages and 300 research sessions (about what
a Chrome history import produces).

| Step | Empty profile | Large profile |
|---|---|---|
| Electron ready | 145 ms | 142 ms |
| Ready for an AI to connect | 216 ms | 213 ms |
| Browser interface ready | 328 ms | 291 ms |
| First tab open | 374 ms | 378 ms |

Research memory loads in the background after the first tab, so a large research history doesn't slow startup. Set
`SKILLERR_TRACE_STARTUP=1` to print each startup step.
