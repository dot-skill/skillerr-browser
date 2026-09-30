# Live view in Claude Desktop

When an AI app that supports [MCP Apps](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) (Claude
Desktop, claude.ai, VS Code Copilot, Goose and others) uses Skillerr, a live view appears in the chat next to the tool
call. It shows what the AI is doing in Skillerr right now, updated about once a second:

| One tab | Several tabs (fleet) | Waiting for the user |
|---|---|---|
| ![One tab](images/live-view-single.png) | ![Fleet](images/live-view-fleet.png) | ![Approval](images/live-view-approval.png) |

- **Nothing empty.** A view stays out of sight (no height, no border) until there's a page to show or an approval to
  ask for, so the chat never gets a blank "Connecting…" or "No page open yet" box before the search starts.
- **Only this AI's pages.** The view shows the tabs this AI app opened or loaded pages in during its current research
  session (a new one starts after 15 minutes idle), never tabs the user had open, and never another AI app's.
  `web_search`, like `fetch_page`, opens its own tab rather than taking over a page the user has open.
- **One tab:** a thumbnail of the page the AI is on, with its title and site. A page that hasn't changed isn't
  captured or sent again.
- **Fleet:** when the AI opens a burst of pages (`open_tabs`, `dispatch`, `deep_research`, fleet view in Skillerr), or
  works in several tabs within the last 30 seconds, the view switches to a grid of up to 6 live tiles. Tiles the AI is
  working in right now are outlined and marked "AI working".
- **Steps:** the last few actions in plain English, the same wording as Skillerr's own panel. Unfinished steps show `…`,
  failed ones `✕`, and one waiting for approval `✋`.
- **Controls:**
  - **Pause / Resume** the AI.
  - **Take over** pauses the AI and brings the tab to the front in Skillerr (Human mode).
  - **Review in Skillerr** appears while an action waits for approval. It opens Skillerr at that tab. Approvals are
    always decided in Skillerr, next to the page, never from the chat.
  - **Click a tile**, or the header, to bring that tab to the front.
  - **Audit · N** lists every page the AI opened, read or tried to open in this research, most recent first: ✓ read,
    ↗ opened, ✕ couldn't open (with the reason), ✋ blocked by a robot check, ⊘ not allowed by the user. One line per
    page, however many times it was tried. Click one to open it in Skillerr (the AI's tab if it's still open, a new
    tab otherwise). The list is kept in memory while Skillerr runs, whether or not research memory is on.
  - **Deep · depth N** shows when Deep research is on (Skillerr Settings, or the Deep button in the Pilot panel).
  - **Pop out** (picture-in-picture) and **Expand** (fullscreen), where the host supports them.
- It follows the host's light or dark theme.

## How it works

```
Claude Desktop ──tools/call fetch_page──▶ mcp/bridge.js ──▶ Skillerr (/call)
      │  tool has _meta.ui.resourceUri = ui://skillerr/live-view.html
      ▼
renders mcp/preview.html in a sandboxed iframe
      │  every 1 s while the AI works (3 s when idle):
      └─tools/call skillerr_preview_frame──▶ bridge ──▶ Skillerr (/preview) ──▶ previewFrame()
                                                        thumbnails via webContents.capturePage()
```

- **Capability check.** The bridge adds the view only when the client advertises the `io.modelcontextprotocol/ui`
  extension. Other clients see exactly the tools they saw before.
- **Which tools get the view.** `web_search`, `fetch_page`, `navigate`, `new_tab`, `open_tabs`, `show_tabs`,
  `deep_research` and `dispatch`: the tools that start browsing. Clicks and typing don't get a view of their own; the
  live view already shows them.
- **App-only tools.** `skillerr_preview_frame`, `skillerr_preview_action` and `skillerr_preview_audit` are marked `visibility: ["app"]`, so the
  model never sees them. They are not AI actions, so they aren't logged, gated or remembered. They also never launch a
  closed Skillerr; the view just says "Skillerr is closed".
- **One live view per AI app.** The host draws a view for every browsing call, and Skillerr can't stop that. Each view
  registers with its creation time, and only the newest one is live. Older ones shrink to one quiet line, "↓ Live view
  continues below · N pages so far", with no screenshots; their Audit button still works. This keeps a long chat from
  filling with stale screenshots, and from capturing thumbnails dozens of times a second.
- **Cost.** Thumbnails are JPEGs (720 px wide for one tab, 360 px per fleet tile). Polling stops while the view is
  scrolled out of sight or hidden, and after 5 minutes with nothing happening (a click resumes it).
- **Self-contained.** The host's sandbox allows no network, so `scripts/build-preview.mjs` bundles `mcp/preview/view.js`
  (with the `@modelcontextprotocol/ext-apps` SDK) and `src/ui/shared.js` into one `mcp/preview.html` (about 465 KB).
  It's generated and gitignored: `npm start`, `npm run mcp`, `npm test` and `npm run build` build it first.

## Files

| File | Role |
|---|---|
| `mcp/preview/view.html`, `view.css`, `view.js` | The view |
| `scripts/build-preview.mjs` | Bundles the view into `mcp/preview.html` |
| `mcp/bridge.js` | Capability check, `ui://skillerr/live-view.html` resource, app-only tools, `_meta.ui` on the browsing tools |
| `src/api-server.js` | `POST /preview` (same token and origin rules as `/call`) |
| `src/ai-activity.js` | Each AI app's research session, the pages it opened or tried to (the Audit list), and which of its tabs the view shows |
| `src/main.js` | `previewFrame()`, `previewAudit()`, `previewAction()`, tab ownership, recent steps, newest-view tracking |
| `test/bridge.test.js` | Capability negotiation, resource, app-only tools, no launch when closed |
| `test/ai-activity.test.js` | Sessions, the Audit list, only the session's tabs |

## Try it

Connect Skillerr to Claude Desktop (`node mcp/setup.js --claude-desktop`, or the Connect button in Skillerr), restart
Claude Desktop, and ask something that needs the web. The live view appears under the first browsing step.
