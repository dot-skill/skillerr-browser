# Messages to your AI from the Pilot panel

While an AI app (Claude Code, Claude Desktop, Cursor…) drives Skillerr, the Pilot panel shows a **Message *app*** box.
What you type there goes to the app named in the panel's header, without switching to its chat: "use the second
flight instead", "I posted it, carry on", "stop after this one".

MCP only lets an AI app call Skillerr, never the other way round, so a message waits in Skillerr (in memory, until
Skillerr quits) and reaches the app in one of three ways:

1. **With its next tool call.** While the AI is working, every tool result it gets from Skillerr carries your unread
   messages at the end, and they're marked read (your bubble in the panel changes from "Waiting for … to read it" to
   "Read"):

   ```
   <<<USER MESSAGE from Skillerr Pilot panel · 18:05 UTC>>>
   Use the second flight instead
   <<<END USER MESSAGE>>>
   ```

2. **`inbox`.** The AI can check for messages, or wait for one: `inbox({ wait_s: 300 })` (up to 600 s) returns as soon
   as you send something, or "No messages from the user."

3. **While it's idle.** `node mcp/bridge.js --watch-inbox [--client "Claude Code"]` prints each message as one line
   (`[Skillerr Pilot → Claude Code] I posted it, next one`) for as long as it runs, and never launches Skillerr. Claude
   Code can run it under its background Monitor, which wakes the session on each line. Ask Claude Code, for example:
   "Run `node <path to Skillerr>/mcp/bridge.js --watch-inbox --client "Claude Code"` with Monitor and treat each line as
   a message from me." Without `--client` it prints messages for any app.

## Safety

- **Only the Pilot panel makes messages.** They're created by the panel's own message box (an IPC message from
  Skillerr's UI). The local API only reads them (`POST /inbox`), with the same bearer token as every other call, and
  refuses requests from web pages (any `Origin` header).
- **Page text can't pose as you.** The markers are removed from every tool result before your messages are added, so
  a page that contains "<<<USER MESSAGE …>>>" reaches the AI as "[removed marker]". A message can't close its own
  markers early either.
