# Trails

A trail is one journey on the web: "Kyoto ryokan near Gion", "Standing desk", "Japan visa". The pages opened for it,
mostly in one sitting. Journeys left unfinished are what become the thirty open tabs nobody closes; Trails keeps them
instead, so every launch starts clean and any journey can be picked back up.

A trail knows its pages, the searches that started it, where the user stopped, what they left unfinished, how far
through it they are, and which of its tabs were still open when they last quit.

## In short

- **Learns on its own.** Every page the user visits is filed into a journey. Nothing to set up, no folders to make.
- **Never touches the tabs you're working in.** No tucking, no regrouping, no moving tabs while you browse.
- **A clean start every time.** When Skillerr quits, the tabs still open wait in their trails. The next launch starts
  with one new tab, and the waiting journeys sit on the shelf between reload and the address bar. (Trails settings →
  Start with a clean tab strip; off, they reopen at launch.)
- **Continue** brings a journey's waiting tabs back up to the tab strip (asleep, so twenty tabs cost nothing until
  clicked), scrolled to where the user was. From the shelf, the start page or the Trails page.
- **Closed means done.** A page whose tab the user closed never comes back with its trail.
- **Notices unfinished work:** a form typed into but never sent, an article read partway, a cart not checked out, a
  long video watched partway. And **how far through** each journey the user is.
- **AI apps** see trails only after the user allows it once per app (`my_trails`, `continue_trail`).
- **Private.** Stored on this computer only. Never page text, never what was typed.

## How a page is filed

```
user visits a page (not an AI: tabs an AI drives or opened are research memory's)
      │
      ├─ search page (Google, Bing, DuckDuckGo, Brave, YouTube, Amazon, …)?  keep the query as the trail's signal
      ├─ keywords: title (×2), first heading, meta description, URL path, minus the site's own name and generic words
      ▼
score the journeys going on now (active in the last 2 hours), and the trail of the page's own tab or opener:
   words shared with the trail          share of the page's keywords (up to 4) among the trail's top 30 words
   or, with the Orb, closeness in meaning  0.8 × how close the page is to the trail's centre (docs/orb.md), if higher
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
- **One journey, one sitting.** A trail takes pages by topic only while it's going on. Days later, the same topic typed
  afresh is a new journey; the old one carries on only through its own tabs, when the user continues it (that counts
  as coming back: "Back 3 times").
- **Everyday sites:** a site used on 5 of the last 21 days (mail, news, video) is routine. Its pages join a trail only
  when the user gets there from one.
- **Noise:** a one-off page isn't shown as a trail. A trail shows once it has 3 pages, or 2 with a search or a return,
  or something unfinished, or tabs waiting. One-offs are dropped after 3 days.

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

## Tabs waiting in a trail

- When Skillerr quits, each open tab is put away in its trail, with its title, icon and scroll position. Tabs that
  belong to no trail (a routine site on its own) go to **Other tabs**.
- Continued tabs come back **asleep**: they load when clicked, then scroll to where the user was.
- Closing a tab marks its page done: it's no longer among the trail's tabs, and Continue never reopens it. Visiting it
  again brings it back into the journey.
- Sites the user excluded are never kept.

## How far through a journey

Each page counts as done when the user closed it or moved on from it in the same tab; a tab still waiting counts as far
as it was read (scrolled) or watched; a form typed into and not sent, or a cart not checked out, not at all. The share
shows as "62% through" on the shelf, trail cards and the Trails page.

## Moving over from Chrome

Settings → Bring your Chrome data → **Open tabs**, Trails settings → **Bring your open Chrome tabs**, and the first-launch
import bring the tabs open in Chrome now. They're
read from Chrome's session file on this computer (`<profile>/Sessions/Session_*`, the "SNSS" format; `parseSession` in
`src/chrome-import.js`), at each tab's current page, closed tabs left out, with titles from Chrome's history.

All the tabs are grouped at once (`clusterItems`: average-linkage clustering on the Orb's meaning of their titles, without
site names, plus shared keywords; threshold 0.2 and keyword bonus 0.1, chosen on the tuning threads of
`scripts/kilr/eval-trails.js`: precision 0.93, F1 0.62; held-out threads: precision 0.80, F1 0.73). Each group becomes a
trail, joining an existing one when it's about the same thing. They all wait on the shelf, like the tabs of a last
session, so the tab strip stays clean. Nothing is closed in Chrome. (Chrome's history isn't used to make trails: old
visits aren't journeys.)

## Research an AI did

When an AI app (Claude Desktop, Cursor…) uses Skillerr, the tabs it opens for one research task make a trail of their
own, marked **Research by Claude Desktop**, kept apart from the user's own trails:

- **Named from the best source there is:** the AI's own question (its `recall`), else its first web search, else the
  clearest page title (the one closest in meaning to the rest, chosen by the Orb). The tab-strip group uses the same name.
- **Its conclusion** (the AI's `tag_session` summary) shows on the trail's card.
- **Continue it later** from the start page like any trail; pages the user opens from it join it. The user's other
  pages never join it by topic. The Orb learns from it only while "from your AIs' research" is on (Trails settings).
- When Skillerr quits, its tabs wait in its research trail, never in the user's.

## Find anything by meaning

Typing in the address bar (or the start page's box) shows open tabs, waiting tabs and trail pages that match, by words
(where words start) and by the Orb's sense of meaning, above web search. ↑/↓ choose, ↵ opens: it switches to the tab, or
brings a waiting or visited page back, scrolled where the user was. Typing an address skips it. See docs/orb.md.

## The trail shelf

Between reload and the address bar, each journey with tabs waiting is a chip: its tabs' site icons stacked, how many,
and a thin line for how far through it the user is (the 5 most recent, then **+N**). Click one for its tabs, **Continue**
(they all come back up), **Done**, or a single tab to open just that one. The tab strip above stays only for the tabs
being worked in.

## The Trails page

⋮ → Trails, **All trails** on the start page, or an AI's `open_view` with `trails`:

- **Ongoing / Done.** Click a trail for its pages, searches and waiting tabs. **Continue**, **✓ Done** (kept 30 days),
  **⋯ → Rename, Merge into…, Forget**.
- Per page: remove from the trail, or **never learn from this site** (also forgets what was learned from it).
- **Settings:** Learn my trails, Start with a clean tab strip, bring your open Chrome tabs, excluded sites, everyday
  sites, AI apps allowed to see trails, and Forget all trails.

## For AI apps

| Tool | What it does |
|---|---|
| `my_trails` | Lists trails (optionally matching `query`): title, where the user stopped, unfinished work, how far through, searches, waiting tabs. With `trail_id`, one trail's pages. |
| `continue_trail` | Brings a trail's waiting tabs back for the user, like **Continue**. |

The first call from each AI app asks the user in Skillerr ("Test AI wants to see your trails…"). Allowing it is
remembered, and the Trails settings can take it back. The built-in Pilot doesn't ask. Workers started with `dispatch`
don't get these tools.

## Code

| File | Role |
|---|---|
| `src/trails.js` | `Trails`: filing by journey, unfinished work, closed pages, progress, waiting tabs, ranking, the user's controls, pruning. No Electron, fully unit-tested. |
| `src/main.js` | Capture (`trailNavigated`, `trailObserve`, `trailLeave`, closing a tab), the watcher (`TRAIL_WATCH_JS`, isolated world 7701), the quit snapshot and clean start, Continue, IPC, `my_trails` / `continue_trail` and their consent. |
| `src/tools.js` | Tool definitions; `trails` in `open_view`. |
| `src/ui/index.html`, `ui.js`, `ui.css` | The trail shelf and its panel between reload and the address bar, "Pick up where you left off" on the start page, settings and onboarding switches. |
| `src/ui/trailsview.js` | The Trails page. |
| `src/store.js` | Settings: `trails`, `trailsFresh`, `trailsIntroSeen`, `trailsAllowedClients`. |
| `test/trails.test.js` | Filing, journeys and sittings, routine sites, unfinished work, sensitive pages, waiting tabs, closed pages, progress, controls, persistence. |

## Storage and privacy

- One file, `~/.skillerr/browser/trails/trails.json` (`0600`, folder `0700`), written a couple of seconds after a
  change and on quit.
- Per page: URL (without tracking parameters or fragment), title, favicon URL, visit days, scroll position, how far it
  was read, whether it was closed, and the unfinished markers. Per trail: its searches and up to 60 keywords. Never page text or form contents. Pages with
  password or payment fields keep only the visit.
- Limits: 300 trails, 80 pages and 60 waiting tabs each. Trails untouched for 90 days are dropped (unless renamed), and
  done trails after 30.
- **Forget all trails**, **History & Bookmarks → Clear browsing data → Trails**, and uninstalling with data removal
  delete it.
  Excluded sites stay excluded after Forget all.
- Turning off **Learn my trails** stops learning and the quit snapshot. Nothing already kept is sent anywhere.

## Limits

- **Matching by meaning** (the Orb) catches most differently worded pages, but not all: on held-out threads with no tab
  hints, it groups 57% of the pairs that belong together (words alone: 30%), with 95% precision. Merge the rest.
- **Single-page apps** that don't use `<form>` elements don't report unfinished forms.
