# Ask buttons

`ask` lets an AI app put a quick question in Skillerr's Pilot panel, with one button per answer, and wait for the
user's click. It's for steering a workflow the user is doing alongside the AI, e.g. posting a thread one reply at a
time: "Posted it?" → **Done, next** / **Skip this one** / **Stop here**.

```
ask({ text: "Posted reply 2 of 5?", options: ["Done, next", "Skip this one", "Stop here"], timeout_s: 300 })
→ {"choice":"Done, next"}
```

- **text:** the question, in markdown (like `say`).
- **options:** 2 to 5 short, distinct labels (40 characters at most). Put any detail in `text`.
- **timeout_s:** how long to wait, 5 to 600 seconds (default 300).

What comes back:

| Result | When |
|---|---|
| `{"choice":"<label>"}` | The user clicked that button. |
| `{"choice":null,"status":"no answer yet"}` | Nobody clicked in time. Not an error: ask again later. |
| `{"choice":null,"status":"superseded"}` | The same AI app asked something newer, which replaced this question. |
| `{"choice":null,"status":"paused"}` | The user paused the AI. |
| `{"choice":null,"status":"closed"}` | Skillerr is quitting. |

In the panel, the question appears in the AI's session card, as a step. After a click the buttons are disabled and the
chosen one stays highlighted, so the card keeps the history, and the step reads "Asked: Posted reply 2 of 5? → Done,
next". The Claude Desktop [live view](live-view.md) shows a pending question as "Question for you" with **Review in
Skillerr**.

Some MCP clients stop waiting for a tool call before 5 minutes. While `ask` waits, the bridge sends a progress
notification every 15 seconds when the client asked for progress, which keeps clients that honour it waiting. If a
client gives up anyway, the question stays in the panel until it's answered, superseded or times out; the AI can simply
ask again.

## Ask buttons are not approvals

Ask buttons steer the workflow only. They never grant an approval:

- Payments, passwords, sign-ins, deletions, uploads (`upload_file`), new skills (`save_skill`) and, in manual mode,
  every action still wait for **Allow** in the "Needs your OK" prompt, whatever the user clicked in an ask.
- `ask` returns before Skillerr's approval gate and never reaches it. Asks and approvals are kept apart (separate
  messages from the panel, separate waiting lists), and a click can only return one of the labels the AI offered.
- Option labels are untrusted display text: they're escaped, never rendered as HTML.

**Why ask cards look different rather than approval-like labels being refused.** An AI could offer "Approve", "Allow"
or "Pay" as a label, and the obvious fix is a blocklist of such words. It isn't used, because a blocklist is easy to
step around ("Go ahead", "Yes, do it", another language) and gets in the way of honest questions ("Approve the draft
wording?"). The label also can't do any harm: clicking it approves nothing. The real risk is a person mistaking an ask
for an approval, or getting used to clicking through one. So an ask card never looks like one: it's a dashed violet
card with a question-mark icon, neutral buttons and the line "Your answer only steers *AI*. It never approves
anything: approvals always ask “Needs your OK”", while approvals stay amber, with a raised-hand icon, **Needs your
OK**, and green **Allow** / **Deny**. The tool description also tells AIs never to offer approval words as options.

Try it: open [`demo/ask-demo.html`](../demo/ask-demo.html) in Skillerr and ask your AI to "post" the three replies on
it one at a time, asking you with `ask` after each one.
