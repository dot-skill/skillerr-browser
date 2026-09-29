---
name: clear-popups
description: Get past cookie banners, newsletter and sign-up modals, app-install nags and other overlays that block a page, the way a careful person would. Use whenever a page is covered by a pop-up, a click lands on an overlay instead of the page, or read_page returns mostly consent or subscription text.
license: Apache-2.0
compatibility: Needs the Skillerr browser (snapshot, click, press_key, read_page tools).
metadata:
  skillerr-icon: shield
  skillerr-example: Close the pop-ups on this page and read it
---

# Clear pop-ups

Pages often hide behind a cookie banner, a newsletter modal or an "open in the app" sheet. Clear them so you can do the
user's task, and choose what the user would choose: the most private option, never agreeing to anything on their
behalf.

## 1. Notice it

- A `snapshot` shows a dialog, a banner fixed to the top or bottom, or buttons like "Accept", "Reject all",
  "Subscribe", "No thanks", "Continue in app".
- `read_page` returns mostly consent, cookie or subscription text instead of the article.
- A `click` on the page does nothing, because an overlay is on top.

## 2. Clear it, in this order

1. **Cookie and consent banners:** choose the option that shares least: "Reject all", "Only necessary", "Necessary
   cookies only", "Decline", "Continue without accepting". If the only choice is "Accept", or "Manage options" leads
   to a list of switches, open the options, leave everything that isn't strictly necessary off, and save. Accept only
   when the user told you to, or there is truly no other way to use the site (then say so).
2. **Newsletter, sign-up and discount modals:** close them: the ×, "No thanks", "Maybe later", "Not now",
   "Continue reading". Never type the user's email, sign up, or start a trial to make one go away.
3. **"Open in the app" and notification prompts:** "Continue in browser", "Not now", "Block". Never install anything,
   and never allow notifications or location.
4. **If there is no visible close button:** `press_key` Escape, then take a new `snapshot`. Still stuck: say what is
   blocking the page rather than clicking around it.

Take a fresh `snapshot` after each step: one banner often opens the next, and the page may move.

## 3. Don't

- Don't get around paywalls, logins, age gates or captchas. Tell the user and let them decide. A captcha or login is
  theirs to do: suggest **Take over**.
- Don't click ads or anything that opens a new site.
- Pop-up windows (a new window a site tries to open) are blocked by Skillerr unless the user just clicked. If a sign-in
  or payment really needs one, ask the user to click **Allow** on the pop-up notice in the address bar.

## 4. Say what you did

In one line, e.g. "Rejected non-essential cookies and closed a newsletter pop-up on example.com." The user should always
know what was chosen for them.
