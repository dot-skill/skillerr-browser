# Set up Skillerr for your user (instructions for AI agents)

Skillerr is a desktop browser (macOS, Windows, Linux) that AI agents use for the web. Every page you read opens in a tab the
user can watch and pause, and your research is kept (a research graph, topic folders and notes) so it can be picked up later.
It connects over MCP (server name `skillerr`). It's free.

Follow these steps when the user asks you to install or set up Skillerr.

## 1. Ask before you change anything

Tell the user, in one short message, what you're about to do and get a yes:

1. Download and install Skillerr from skillerr.com (about 130 MB).
2. Connect it to their AI apps (Claude Code, Claude Desktop, Cursor: whichever are installed).
3. **Optional, ask separately:** make Skillerr their AI's browser. For Claude Code this turns off its built-in
   `WebSearch` and `WebFetch` tools (in `~/.claude/settings.json`) and adds a short note to `~/.claude/CLAUDE.md`,
   so all web access goes through Skillerr. It can be undone at any time.

## 2. Install and connect

Run the line for their system. Add `--prefer` only if they said yes to step 1.3.

**macOS or Linux**

```sh
curl -fsSL https://skillerr.com/install.sh | sh
curl -fsSL https://skillerr.com/install.sh | sh -s -- --prefer
```

**Windows (PowerShell)**

```powershell
irm https://skillerr.com/install.ps1 | iex
& ([scriptblock]::Create((irm https://skillerr.com/install.ps1))) --prefer
```

To preview without changing anything, add `--dry-run`. The installer downloads the right build for the machine, installs it
(macOS: `/Applications/Skillerr.app`; Linux: `~/.local/share/skillerr`, command `skillerr`; Windows: per-user install),
opens it, and connects the AI apps it finds. Config files are backed up (`*.skillerr-backup`) before they're changed.

## 3. Finish

- **Claude Code:** the connection applies to new sessions. Tell the user to start a new session (or restart this one).
- **Claude Desktop:** tell the user to quit and reopen it, and, if they chose `--prefer`, to switch off Claude Desktop's own
  web search (tools/search menu in a chat), so it uses Skillerr for the web.
- **Verify:** `claude mcp list` should show `skillerr`. In a new session, a web question should open a Skillerr tab.

## 4. Using Skillerr for the web (once connected)

- `web_search` for searching and `fetch_page` to read a page. Results come straight back to you, as with any tool.
- If the user pastes a line like `Here's my screen from Skillerr (capture 3f9a, …)`, call `view_capture` with that id to see what they see (or open the file path in it, if you can read local files).
- Start research with `recall` to build on what the user already found. When you're done, `save_note` for the answer and
  `tag_session` to file it under topics. `my_research` and `read_note` reopen earlier research.
- The user can pause you from Skillerr. Payments, passwords, sign-ins and deletions wait for their approval, and robot checks
  are theirs to complete. If an action is declined, don't retry it.

## Undo

```sh
# macOS
ELECTRON_RUN_AS_NODE=1 /Applications/Skillerr.app/Contents/MacOS/Skillerr /Applications/Skillerr.app/Contents/Resources/app.asar/mcp/setup.js --undo-prefer
```

This gives Claude Code its own web tools back. To remove Skillerr's connection from one app, use **Disconnect** in Skillerr
(plug icon in the Pilot panel).

To uninstall Skillerr completely (disconnect every AI app, undo `--prefer`, remove the app), use **Uninstall Skillerr…** in
its menu, or:

```sh
curl -fsSL https://skillerr.com/install.sh | sh -s -- --uninstall            # macOS, Linux (--purge also deletes its data)
& ([scriptblock]::Create((irm https://skillerr.com/install.ps1))) --uninstall   # Windows
```
