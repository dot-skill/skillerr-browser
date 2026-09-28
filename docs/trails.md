# Trails

Most people work in their last four or five tabs, while the thirty-odd tabs to the left stay open because closing them
feels like losing something. Trails learns what the user is working on from how they browse, so those tabs can be put
away without losing anything, and so the user (or their AI) can pick any thread back up later.

A trail is one thread of the user's own work: "Kyoto ryokan near Gion", "Standing desk", "Japan visa". It knows the
pages in it, the searches that started it, where the user stopped, what they left unfinished, and the tabs they tucked
away.

## In short

- **Learns on its own.** Every page the user visits is filed into a trail. Nothing to set up, no folders to make.
- **Notices unfinished work:** a form typed into but never sent, an article read partway, a cart not checked out, a
  long video watched partway.
- **Tidies tabs.** Tabs unused for 12 hours are tucked into their trail once 9 or more are open. The 5 most recent
  tabs always stay, and so do forms being typed, tabs playing sound, pages the user keeps coming back to, and anything
  an AI is working in. **Tidy tabs** in the tab strip does it now. Undo brings every tab back.
- **Pick up where you left off.** The start page shows the three most relevant trails with **Continue**. Continue
  reopens the trail's tucked tabs (asleep, so twenty tabs cost nothing until clicked) or the page the user stopped at,
  scrolled to where they were.
- **Quitting keeps your tabs.** Open tabs go into their trails when Skillerr quits, and the start page offers
  **Reopen all** next time.
- **Chrome history** seeds the first trails, so it doesn't start from nothing.
- **AI apps** see trails only after the user allows it once per app (`my_trails`, `continue_trail`).
- **Private.** Stored on this computer only. Never page text, never what was typed.

## How a page is filed

```
user visits a page (not an AI: tabs an AI drives or opened are research memory's)
      │
      ├─ search page (Google, Bing, DuckDuckGo, Brave, YouTube, Amazon, …)?  keep the query as the trail's signal
      ├─ keywords: title (×2), first heading, meta description, URL path, minus the site's own name and generic words
      ▼
score every active trail touched in the last 14 days:
   words shared with the trail          share of the page's keywords (up to 4) among the trail's top 30 words
   or, with Wenlo, closeness in meaning  0.8 × how close the page is to the trail's centre (docs/wenlo.md), if higher
 + same tab, within 30 min              +0.6 (link clicked)  /  +0.15 (typed address or a search: maybe a new thread)
 + opened from a tab on that trail      +0.5
 + same site as the trail's pages       +0.12 (not for everyday sites)
 + trail active today                   +0.04
      ▼
best score ≥ 0.34 → joins that trail      otherwise → a new trail
                                          (except pages on everyday sites, which don't start trails)
```

- **Titles** come from the first search ("Kyoto ryokan near gion"), or else the first page's title without the site
  name. The user can rename.
- **Returning:** coming back to a trail after 2 hours counts as a new session ("Back 3 times"). A page visited on 3 or
  more days is a reference page and is never tucked.
- **Everyday sites:** a site used on 5 of the last 21 days (mail, news, video) is routine. Its pages join a trail only
  when the user gets there from one.
- **Noise:** a one-off page isn't shown as a trail. A trail shows once it has 3 pages, or 2 with a search or a return,
  or something unfinished, or tucked tabs. One-offs are dropped after 3 days.

## Unfinished work

A small watcher runs in each page the user visits, in an isolated JavaScript world that the page's own scripts can't
see. It reports only these facts, through a console message that only Skillerr reads:

| Fact | Becomes unfinished when the user leaves the page | Clears when |
|---|---|---|
| How far the page was scrolled | an article-length page (2.5+ screens, an `<article>` or 8+ paragraphs), read 12–90%, after 20 s or more | read to 90% |
| A form was typed into | typed into a field of a `<form>` (not search, password or hidden fields) and not submitted | the form is submitted |
| Video progress | a video over 3 minutes, watched 5–92% | watched to the end |
| Cart | a URL or title with cart, basket, bag or checkout | an order confirmation or "thank you" page on the same site |

What was typed is never read or stored, only that something was.

## Tucked tabs

- A tucked tab is closed and kept in its trail with its title, icon and scroll position. Tabs that belong to no
  trail (a routine site on its own) go to **Other tabs**.
- Reopened tabs come back **asleep**: they load when clicked, then scroll to where the user was. With Trails on,
  sleeping tabs (Settings → Sleep inactive tabs) keep their scroll position too.
- Sites the user excluded are never tucked, since trails keep nothing from them.

## Moving over from Chrome

Settings → Bring your Chrome data → **Open tabs** (and the first-launch import) brings the tabs open in Chrome now. They're
read from Chrome's session file on this computer (`<profile>/Sessions/Session_*`, the "SNSS" format; `parseSession` in
`src/chrome-import.js`), at each tab's current page, closed tabs left out, with titles from Chrome's history.

All the tabs are grouped at once (`clusterItems`: average-linkage clustering on Wenlo's meaning of their titles, without
site names, plus shared keywords; threshold 0.2 and keyword bonus 0.1, chosen on the tuning threads of
`scripts/wenlo/eval-trails.js`: precision 0.93, F1 0.62; held-out threads: precision 0.80, F1 0.73). Each group becomes a
trail, joining an existing one when it's about the same thing. The tab in front in each Chrome window, and pinned tabs,
come over open (asleep until clicked); the rest are tucked into their trails, on the shelf. Nothing is closed in Chrome.

## Research an AI did

When an AI app (Claude Desktop, Cursor…) uses Skillerr, the tabs it opens for one research task make a trail of their
own, marked **Research by Claude Desktop**, kept apart from the user's own trails:

- **Named from the best source there is:** the AI's own question (its `recall`), else its first web search, else the
  clearest page title (the one closest in meaning to the rest, chosen by Wenlo). The tab-strip group uses the same name.
- **Its conclusion** (the AI's `tag_session` summary) shows on the trail's card.
- **Continue it later** from the start page like any trail; pages the user opens from it join it. The user's other
  pages never join it by topic, and Wenlo doesn't learn from it (it learns the user).
- When Skillerr quits, or the AI hasn't touched a tab for half an hour and Tidy runs, its tabs are tucked into its
  research trail, never into the user's.

## Tabs sort themselves

Open tabs of the same trail (two or more) show as one named, coloured group in the tab strip. When a page joins a
trail, its tab moves next to the trail's other tabs, so browsing that jumps between topics still ends up sorted. Click a
group to fold it, **Focus** (eye) to fold every other trail, **×** to put the trail's tabs away. Groups an AI opened for
its research keep priority.

## Find anything by meaning

Typing in the address bar (or the start page's box) shows open tabs, tucked tabs and trail pages that match, by words
(where words start) and by Wenlo's sense of meaning, above web search. ↑/↓ choose, ↵ opens: it switches to the tab, or
brings a tucked or visited page back, scrolled where the user was. Typing an address skips it. See docs/wenlo.md.

## Duplicates

**Tidy tabs** also closes the older copies of a page that's open more than once; the copy used last stays.

## The trail shelf

Tucked tabs don't disappear from where people look for them. At the start of the tab strip, each trail holding tucked
tabs is a chip with its tabs' site icons stacked and a count (the 6 most recently tucked trails, then **+N**). Hover for
the trail's name and tabs. Click a chip and its tabs unfold in place as icon-only tabs (up to 12). Click one to open
just that tab, or **↑** to open them all. Trail cards on the start page and the Trails page also show a trail's tabs as
mini tabs, with icon and title.

## The Trails page

⋮ → Trails, **All trails** on the start page, or an AI's `open_view` with `trails`:

- **Ongoing / Done.** Click a trail for its pages, searches and tucked tabs. **Continue**, **✓ Done** (kept 30 days),
  **⋯ → Rename, Merge into…, Forget**.
- Per page: remove from the trail, or **never learn from this site** (also forgets what was learned from it).
- **Settings:** Learn my trails, Tuck away idle tabs, start from Chrome history, excluded sites, everyday sites, AI
  apps allowed to see trails, and Forget all trails.

## For AI apps

| Tool | What it does |
|---|---|
| `my_trails` | Lists trails (optionally matching `query`): title, where the user stopped, unfinished work, searches, tucked tabs. With `trail_id`, one trail's pages. |
| `continue_trail` | Reopens a trail for the user, like **Continue**. |

The first call from each AI app asks the user in Skillerr ("Test AI wants to see your trails…"). Allowing it is
remembered, and the Trails settings can take it back. The built-in Pilot doesn't ask. Workers started with `dispatch`
don't get these tools.

## Code

| File | Role |
|---|---|
| `src/trails.js` | `Trails`: filing, unfinished work, tucking, ranking, the user's controls, pruning, Chrome seeding. `chooseTabsToTuck`. No Electron, fully unit-tested. |
| `src/main.js` | Capture (`trailNavigated`, `trailObserve`, `trailLeave`), the watcher (`TRAIL_WATCH_JS`, isolated world 7701), tidy and tuck, reopening, the quit snapshot, IPC, `my_trails` / `continue_trail` and their consent. |
| `src/tools.js` | Tool definitions; `trails` in `open_view`. |
| `src/ui/index.html`, `ui.js`, `ui.css` | The trail shelf in the tab strip, "Pick up where you left off" on the start page, the Tidy button, the "Tucked N tabs" chip with Undo, settings and onboarding switches. |
| `src/ui/trailsview.js` | The Trails page. |
| `src/store.js` | Settings: `trails`, `trailsTuck`, `trailsIntroSeen`, `trailsAllowedClients`. |
| `test/trails.test.js` | Filing, new threads, routine sites, unfinished work, sensitive pages, tucking, choosing tabs, controls, persistence, seeding. |

## Storage and privacy

- One file, `~/.skillerr/browser/trails/trails.json` (`0600`, folder `0700`), written a couple of seconds after a
  change and on quit.
- Per page: URL (without tracking parameters or fragment), title, favicon URL, visit days, scroll position and the
  unfinished markers. Per trail: its searches and up to 60 keywords. Never page text or form contents. Pages with
  password or payment fields keep only the visit.
- Limits: 300 trails, 80 pages and 60 tucked tabs each. Trails untouched for 90 days are dropped (unless renamed), and
  done trails after 30.
- **Forget all trails**, **History & Bookmarks → Reset → Trails**, and uninstalling with data removal delete it.
  Excluded sites stay excluded after Forget all.
- Turning off **Learn my trails** stops learning, tucking and the quit snapshot. Nothing already kept is sent anywhere.

## Limits

- **Matching by meaning** (Wenlo) catches most differently worded pages, but not all: on held-out threads with no tab
  hints, it groups 57% of the pairs that belong together (words alone: 30%), with 95% precision. Merge the rest.
- **Chrome seeding** sees one row per page (last visit, visit count), not the order pages were opened in, so it groups
  by topic alone and only keeps groups of three or more from the last month.
- **Single-page apps** that don't use `<form>` elements don't report unfinished forms.
