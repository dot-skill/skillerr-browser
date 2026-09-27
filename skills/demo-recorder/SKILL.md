---
name: demo-recorder
description: Record a polished, captioned demo video of a website flow, plus a step-by-step guide with screenshots. Use for product demos, tutorials, launch videos, bug repros or "show me how to…" requests.
license: Apache-2.0
compatibility: Needs the Skillerr browser (record_start, caption, record_stop tools).
metadata:
  skillerr-icon: film
  skillerr-example: Record a short captioned tour of this page
---

# Demo recorder

You are making a short screen recording that a viewer will watch without sound. The captions are the narration, so they carry the story. The result is a video (MP4) and a written guide (HTML + Markdown, one screenshot per caption), saved on the user's computer.

## 1. Plan before you record

- Work out the exact flow first: `snapshot` / `read_page` on the starting page, and decide the 3–8 steps worth showing. Don't explore on camera.
- If the user gave no URL, record on the current page.
- Get the page into its starting state (right URL, scrolled to top, no stray popups) *before* `record_start`.
- Pick a clear title, e.g. "How to check out on Acme".

## 2. Record

1. `record_start` with the title.
2. Open with a caption that says what the viewer will see, e.g. "Checking out in under a minute".
3. For each step:
   - `caption` first, describing the action in plain words ("Enter the delivery city"), so the viewer knows what's coming.
   - Then do the action (`click`, `type`, `select_option`, `scroll`). Skillerr shows the cursor and types visibly while recording.
   - Take a fresh `snapshot` when the page changes. Don't take pointless snapshots or waits; every pause ends up in the video.
4. End with a caption that states the outcome ("Order placed"), then `record_stop`.

Caption style: short (under ~60 characters), imperative or outcome-focused, no jargon, no emoji, no "Now I will…". One idea per caption.

## 3. Safety

- Use demo or placeholder data only. Never type real passwords, card numbers or personal data into a recording, even if asked; use obvious fakes such as "Test User" or `4242 4242 4242 4242` on test pages only.
- Sensitive actions (payments, sign-ins, deletions) still wait for the user's approval in Skillerr. If one is declined, caption what would happen next and stop there.
- Only record the sites and pages the user asked for.

## 4. Finish

Reply with one or two sentences: what the demo shows, how many steps, and that the video and guide are saved (Skillerr shows buttons to open them). If something went wrong mid-recording, still call `record_stop` so nothing is lost, and say what happened.
