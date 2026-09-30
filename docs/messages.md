# Messages to your AI from the Pilot panel

While an AI drives Skillerr, the Pilot panel shows a **Message *name*** box. What you type there goes to the AI named in
the panel's header, without switching to its chat: "use the second flight instead", "I posted it, carry on", "stop
after this one". If more than one AI is at work, a small picker next to the box chooses which.

## Skillerr's built-in AI

A local model (Ollama, LM Studio) or an API key, running inside Skillerr: the box reads "Message qwen2.5:0.5b" (the
model's name) while it works on a task. Your message goes straight into its loop as a user turn at its next step,
"Message from the user (typed in Skillerr): …", and your bubble changes to "Read". If it has just finished, the message
starts a new task, as if you'd typed it in the box below.

## AI apps over MCP (Claude Desktop, Claude Code, Cursor, Codex and others)

MCP only lets an app call Skillerr, never the other way round, so a message waits in Skillerr (in memory, until Skillerr
quits) and reaches the app:

1. **With its next tool call.** Any tool result it gets from Skillerr starts with your unread messages, in plain words:

   ```
   === Message from the user (typed in Skillerr) ===
   Use the second flight instead
   === End of message ===

   (the tool's own result)
   ```

   First, not after the page text, so small models don't miss it. Your bubble changes to "Read".

2. **`inbox`, listening.** When an app finishes a task it was doing in Skillerr, it doesn't end its turn: it calls
   `inbox({ wait_s: 50 })` (under the 60 s many MCP clients allow a call), acts on any message, and calls again, until
   you say stop or press **Pause** (which ends the wait with "stopped"). Your message can be anything: a new task, a
   change of direction, a correction. The box shows **Listening** only while the app has a wait open. When it isn't
   listening, your bubble says so ("Claude Desktop isn't listening right now; it'll see this next time it uses
   Skillerr"), with **Send to Skillerr's AI instead** when a built-in AI is set up.

3. **Optional, while it's idle:** `node mcp/bridge.js --watch-inbox [--client "Claude Code"]` prints each message as one
   line (`[Skillerr Pilot → Claude Code] I posted it, next one`) for as long as it runs, and never launches Skillerr.
   It's for apps that can watch a background process, like Claude Code's Monitor, which wakes the session on each
   line: "Run `node <path to Skillerr>/mcp/bridge.js --watch-inbox --client "Claude Code"` with Monitor and treat each
   line as a message from me." Without `--client` it prints messages for any app.

## Safety

- **Only the Pilot panel makes messages.** They're created by the panel's own message box (an IPC message from
  Skillerr's UI). The local API only reads them (`POST /inbox`), with the same bearer token as every other call, and
  refuses requests from web pages (any `Origin` header).
- **Page text can't pose as you.** Before your messages are put first, the tool result is cleaned: a line shaped like
  the markers ("=== … message … ===") and the phrase "Message from the user (typed in Skillerr)" become "[removed
  marker]". A message can't carry the markers either.
