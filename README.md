# Skillerr Browser

**The agentic browser.** Your AI does its web research in real tabs you can watch, and everything it finds is kept: in a private research graph, in real topic folders on disk, and as reusable skills.

Skillerr is a desktop browser (macOS, Windows, Linux) built on Electron/Chromium. Any AI can drive it: Claude Desktop, Claude Code, Cursor and other MCP clients connect over a local MCP bridge, and a built-in agent runs local models (Ollama, LM Studio), your own API keys, or Skillerr Pro.

Website: https://skillerr.com

---

## What it does

| Area | Features |
|---|---|
| **Research in the open** | Every page the AI reads opens in a visible tab. Fleet view shows many live tabs side by side. Deep research follows the most relevant links, 1 to 5 hops. `web_search` and `fetch_page` stand in for an AI's own search and fetch, so its flow continues as usual. |
| **Research memory** | A local knowledge graph of sessions, pages, notes, skills, topics and entities. Relationships (co-visits, backlinks, topics) build up as you browse. `recall` brings back related past research. There's an interactive map with an attention glow, plus search. |
| **Research folders** | The topic taxonomy becomes a tree, and real folders in `~/Skillerr/research` with a README index and linked notes. Open a folder, or copy a one-line prompt to hand the research to your AI. |
| **Continuity** | `my_research` and `read_note`. Notes and skills are exposed as MCP resources straight from disk, and learned skills can be mirrored into Claude Code. |
| **Skills** | Standard `SKILL.md` skills. The AI saves procedures it worked out (with the user's approval). Sealed `.skill` packages are verified with the skillerr CLI before install. Built-in skills: demo-recorder and screenshots. |
| **Control and safety** | A plain-English activity log, Pause and Human mode, undo, and approval for payments, passwords, sign-ins and deletions. Robot checks are handed to the user. Connected apps can be switched off individually. |
| **Everyday browser** | Tab groups per research task, tab sleeping to stay light, per-tab zoom, a pop-up blocker, site permission prompts, country-aware Google search, find in page, downloads, a context menu with "Ask Skillerr", history and bookmarks with delete and reset, Chrome import, light and dark themes. |

## Project layout

```
src/
  main.js          Window, tabs, groups, sleeping, control gate (approvals, undo), browser-level tools, IPC
  tools.js         Tool definitions and page-level implementations (shared by MCP and the built-in agent)
  agent.js         Built-in agent (Anthropic SDK, or any OpenAI-compatible endpoint)
  memory.js        Research memory: append-only JSONL graph, recall, taxonomy, heat
  skills.js        Skill loading, learning, install (with skillerr verification), Claude Code sharing
  recorder.js      Tab and window recording, captions, step guides
  connect.js       One-click MCP setup for Claude Desktop, Claude Code and Cursor
  chrome-import.js Chrome bookmarks and history import (local profile only)
  api-server.js    Local control API (127.0.0.1, bearer token; browser-origin requests refused)
  store.js         Settings and session files in ~/.skillerr/browser
  ui/              Browser chrome, pilot panel, start page, memory map and folders, history, HUD, captions
mcp/bridge.js      MCP stdio server that forwards to the running app (and serves notes/skills as resources)
skills/            Built-in skills
scripts/build.mjs  Production bundle (esbuild, minified) into out/, packed into app.asar
site/              skillerr.com: static landing page and Vercel functions (download gate, Pro proxy, sign-in)
demo/              Local fixture pages for testing
```

## Develop

```bash
npm install
npm start                      # run from source
SKILLERR_PROFILE=demo npm start  # separate profile (memory, settings, browser data)
node scripts/eval-recall.js    # recall quality check
```

## Build and release

```bash
npm run dist        # macOS dmg + zip (arm64, x64)
npm run dist:win    # Windows NSIS installer (x64, arm64)
npm run dist:linux  # Linux AppImage (x64, arm64)
npm run dist:all    # everything
```

Builds bundle and minify the app (`scripts/build.mjs`), so no readable source or `node_modules` ship. macOS builds are ad-hoc signed; notarization and Windows signing need a Developer ID and a code-signing certificate. Installers are published to the public releases repository that the website links to.

## Website (`site/`)

A static page plus Vercel functions. Environment variables (set in Vercel, never in code):

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Neon Postgres (download sign-ups) |
| `AI_GATEWAY_API_KEY` | Skillerr Pro model access (server-side only) |
| `SESSION_SECRET` | Signing sign-in sessions |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign in with Google |
| `LS_STORE_ID`, `LS_PRODUCT_ID`, `LS_API_KEY`, `LS_CHECKOUT_URL` | Lemon Squeezy (Pro subscriptions and licences) |

## Data and privacy

Everything the app keeps stays on the user's computer: `~/.skillerr/browser` (settings, research memory, skills), `~/Skillerr/notes` and `~/Skillerr/research`, and recordings and screenshots in the user's Movies and Pictures folders. The app has no telemetry. See `site/privacy.html`.

## License

Proprietary. Copyright © 2026 Bharat Dudeja. All rights reserved. See [LICENSE](LICENSE).
