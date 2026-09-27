---
name: screenshots
description: Take and save clean screenshots of web pages or of Skillerr itself (full scrolling pages, the visible view, or the whole window with the research graph and panel). Use for bug reports, docs, launch images, comparing pages, or "screenshot this".
license: Apache-2.0
compatibility: Needs the Skillerr browser (save_screenshot, open_view, scroll tools).
metadata:
  skillerr-icon: camera
  skillerr-example: Take a full-page screenshot of this page
---

# Screenshots

Use `save_screenshot`. Every shot is saved as a PNG in `~/Pictures/Skillerr` (tell the user the file name), and you get the image back to check it.

## Pick the right scope

- **`page`**: what's visible in the tab right now. Best for a specific section: scroll to it first.
- **`full_page`**: the whole scrolling page in one image. Best for landing pages, articles and receipts. Very long pages are cut at 16,000 px.
- **`window`**: all of Skillerr as the user sees it: tabs, the Pilot panel, fleet view, and Skillerr's own screens. To show a Skillerr screen, open it first with `open_view` (`memory`, `folders`, `history`, `settings`, `skills`), wait a moment, then shoot.

## Good screenshots

1. Get the page ready first: dismiss cookie banners and pop-ups (ask the user if a click is sensitive), wait for images to load (`wait` about 1000 ms), and scroll to the part that matters.
2. Name files so they sort and make sense, e.g. `pricing-desktop`, `checkout-step-2`, `graph-travel`.
3. For a comparison, take the same scope for each page, one after another, and name them as a set (`compare-a`, `compare-b`).
4. Look at each image you get back. If something covers the content or it's still loading, fix it and take it again.
5. Never capture passwords, payment details or private messages. If they're on screen, scroll or ask the user first.

Finish by listing the saved files for the user.
