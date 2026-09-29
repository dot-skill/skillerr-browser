# Kilr

Kilr is Skillerr's own small AI. (The name is the letters k-i-l-r of s*kil*le*r*r: the intelligence inside Skillerr.) It's built into the browser, runs on the user's computer, and knows their work by
meaning: which trail a page belongs to, which trails a search is about, where they were with something. There's
nothing to install and nothing to download, and nothing leaves the computer.

## In short

- **Tiny and fast.** One 7.9 MB file. It loads in about 30 ms, uses about 22 MB of memory, and embeds a page title in
  about 26 µs: some 39,000 texts a second on one core, in plain JavaScript with no native code.
- **No text generation.** Kilr embeds and then *chooses*. What it says is built from the facts of the user's own
  trails, so it can't make things up.
- **Built from an open model, by us.** Distilled from `all-MiniLM-L6-v2` (Apache-2.0) with a closed-form fit that runs
  on a laptop CPU in minutes (below). The whole pipeline is in `scripts/kilr/`.
- **Replaces Ollama for recall by meaning.** Recall matches past research by meaning out of the box. An
  OpenAI-compatible endpoint (`embedBaseUrl`) still takes over when set.

## What it does

| Where | What Kilr does |
|---|---|
| **Tabs sort themselves** | Open tabs of the same trail show as one named group in the tab strip, and a tab that joins a trail moves next to its trail's other tabs. Click folds a group, **Focus** folds the other trails, **×** puts the trail's tabs away. |
| **Find anything by meaning** | Type what you remember in the address bar ("newborn feeding", "train from tokyo to kyoto"): open tabs, tucked tabs and trail pages appear above web search. ↵ switches to the tab, or brings a tucked or visited page back where you were. |
| **Suggests skills** | When you (or your AIs) keep doing the same kind of task, like choosing what to buy, Kilr offers to save how you do it as a skill your AI can follow. Below. |
| **Learns your words, and your AI's** | Weekly (by default it asks first), Kilr retrains on your trails and your AIs' research so your jargon joins the right trail. Below. |
| **Trails: filing pages** | A page joins a trail by meaning as well as by shared words. "hotels in japan for october" joins a trail of "cheap flights to tokyo". |
| **Trails: search** | The Trails page search box is "Ask Kilr": "plane tickets to Japan" finds the Tokyo flights trail. |
| **Start page** | One line above the trail cards: the latest trail, where you stopped and what's unfinished, with **Continue**. |
| **Ask** | "Where was I with the office chair?" answers from that trail's facts. "Where was I?" alone means the latest trail. |
| **Recall by meaning** | `recall` and the research memory search match by meaning with Kilr's vectors, kept in memory (re-making them is faster than reading them). |
| **AI apps** | `my_trails` with a `query` finds trails by meaning. |

Settings → Trails → **Kilr** turns it off. Trails then match by shared words, and recall by words (or an endpoint if set).

## The History page

History (⌘Y) shows everything the user and their AI apps looked into as one map, with Kilr at the centre
(`src/ui/memoryview.js`, data from `src/history-graph.js`).

- **The orb is Kilr:** a metal ball full of micro-holes and a few cracks, lit from inside like a dying star. With
  nothing in History it is a cold ball with faint red embers.
- **Glow is how much there is.** It grows on a log scale with everything in History, so the first hundred pages
  already light it up. It reaches full brightness at about 10,000 pages, roughly a typical person's last three
  months of browsing (Chrome keeps 90 days). Past that, up to 20,000, corona flares grow round it. The meter at the
  bottom right shows where the user is.
- **Every node comes out of it as a ray of light.** Trails and research sessions are the bright hubs, with their
  pages round them. The further out a node is, the longer ago it was seen. When the page opens, the nodes shoot out
  along their rays and the orb brightens as they arrive. Light keeps travelling out along the rays, more of it the
  brighter Kilr burns.
- **Colour is whose it is, on a VIBGYOR spectrum round the orb:** the user's own pages on the warm side (red,
  orange, yellow), their AIs' on the cool side (blue, indigo, violet, with each AI app in its own band), and pages
  both of them looked at in green. **All / Yours / Your AIs'** filters them, and the search box finds things by
  meaning (recall) or by words.
- **Click the orb** (or **Kilr** at the top) for Kilr's own panel: what it is, what it is doing right now (a live
  log), its size on disk, the memory it is using, how fast it is, that it runs only on this computer's processor with
  no internet, what it has learned and from whose pages, **Learn now**, and the skills it suggests from research
  that keeps coming back.
- With reduced motion on, the orb glows steadily and nothing animates.

## How it works

A text's embedding is the average of its word pieces' vectors, looked up in a table. No neural network runs.

The table is made by **distilling** a transformer (the *teacher*, `all-MiniLM-L6-v2`, 22M parameters, 90 MB):

1. The teacher embeds every word piece on its own. Reduced to 256 numbers with PCA, those are the starting vectors `E₀`.
2. The teacher embeds about 200,000 texts (sentences, page-like titles and short phrases).
3. **Closed-form fit.** Find the table `E` that makes the average of each text's pieces land on the teacher's embedding
   of that text, staying close to `E₀` for rare pieces:

   `minimise ‖A·E − Y‖² + λ‖E − E₀‖²`   (`A` averages each text's pieces, `Y` holds the teacher's embeddings)

   That's linear least squares, solved exactly with preconditioned conjugate gradients on the sparse normal equations:
   minutes on a CPU, no GPU and no training loop. The fit also learns how much each piece should count ("the" next to
   nothing, "visa" a lot), which other methods set with a hand-made weighting or a gradient-trained model.
4. Packed as int8 with a scale per row. That loses nothing measurable.

Kilr's cosines are calibrated on held-back data (`src/kilr/calibration.js`): sentence pairs people scored (STS-B dev)
for recall, and pages against the centre of real threads of work for Trails.

## Learning from your trails and your AI's research

Pages kept in one trail belong together: the ones you clicked through, opened from each other or merged by hand, and
the ones your AI app read for one research task ("Research by Claude Desktop"). So Kilr moves the vectors of the word
pieces in those pages toward the rest of each trail. It learns from **your browsing** and **your AIs' research**; each
can be switched off in Trails → Settings, and every result says how much came from each ("from 312 of yours and 140
from your AIs' research"). It's the same kind of closed-form least
squares as its distillation (`src/kilr/train.js`):

`minimise Σᵢ ‖ mean(E + Δ)[pieces of item i] − yᵢ ‖² + λ‖Δ‖²`,  `yᵢ` = the centre of the rest of item i's trail

- **No teacher, no GPU:** plain JavaScript, conjugate gradients on all 256 dimensions at once, under a second for a
  week of browsing.
- **Only topic words move:** word pieces used in at most max(2, 20%) of your trails. Common words stay put, so
  unrelated pages aren't pulled into your topics.
- **It proves itself first:** a quarter of each trail is held back. The new vectors are kept only if they file
  held-back items at least as well as now, and either file more of them right or tell trails apart more clearly
  (margin +0.02). Otherwise nothing changes. Training always starts from the shipped model.
- **Private and light:** runs in a worker thread capped at 192 MB; your trail texts live only there and are gone when
  it ends. The result is a small file (`~/.skillerr/browser/kilr/personal.bin`, 264 bytes per word piece learned: tens of KB for a busy week).
  **Forget what Kilr learned** deletes it. Recall re-makes its vectors when it changes.
- **When:** `kilrLearn` = `suggest` (default: a card on the start page when due) | `auto` (when the computer has
  been idle 2 minutes) | `off`; `kilrLearnEvery` = `daily` | `weekly` (default) | `monthly`. Due means that period
  has passed and there are 20+ new pages. Trails → Settings has all of it, plus **Learn now**.

Measured on the Trails threads (`scripts/kilr/eval-trails.js`, trained on the tuning threads):

| | Your topics (learned) | Other topics (not learned) |
|---|---|---|
| Before | F1 0.53 (precision 0.99, recall 0.36) | F1 0.71 (precision 0.95) |
| After learning | **F1 0.95** (precision 0.94, recall 0.97) | F1 0.71 (precision 0.95), unchanged |

On a week of jargon-heavy browsing (`scripts/kilr/eval-personal.js`: ryokan, tokio, bassinet, Gateron, VTI), the
following week's new pages that Trails joins by meaning go from 60% to 95%, with no wrong joins.

## Skills Kilr suggests

Skillerr already keeps what the user and their AIs browse (trails, research memory). Kilr turns habits in it into
skills: when the same kind of task shows up in 3 or more trails on 2 or more days, the start page offers to save how
it's done as a standard skill (`SKILL.md`) that any AI connected to Skillerr (Claude Desktop, Cursor, Claude Code…) can
use with `use_skill`, or that the built-in Pilot uses.

```
Kilr noticed a habit: how you choose what to buy. You did this 4 times on 4 days, each time with rtings.com,
reddit.com, amazon.com. Save it as a skill, so your AI does it your way next time?     [Save skill] [See skill] [Not now]
```

The skill says, from what was observed:

1. how the user searches, as patterns ("best … 2026", "… review reddit"), in the order they're typed;
2. the sites they rely on, in the order they use them ("usually first", "usually near the end");
3. how many pages they usually look at before deciding;
4. a closing step for that kind of task (for buying: compare two or three finalists in a table);
5. to check `my_trails` first, in case they've started on it already.

- **No language model writes it, and nothing leaves the computer.** The kinds of task (buy, fix, learn, trip, recipe,
  job, place to live) are fixed word lists; the searches and sites are counted from trails; the wording is a template.
  Kilr's part is the trails themselves, which it files by meaning.
- **Works with manual browsing and with AI apps.** It reads the user's own trails and their AIs' research trails, as
  chosen under what Kilr learns from (Trails settings). The skill says who did the research.
- **Not now** puts a suggestion off until the habit has doubled. A saved skill is offered as an update after two more
  trails. A skill of the same name the user made themselves is never overwritten.
- **Turn it off:** Trails settings → Suggest skills from what you keep doing.
- **What it doesn't do (yet):** notice the same *subject* coming back weeks apart. Kilr's closeness between whole
  trails wasn't reliable enough for that (related trails scored as low as unrelated ones), and a wrong suggestion is
  worse than none.

## Light enough for 4 GB

Kilr is about 22 MB of memory, computes nothing on the graphics card, and only works when a page is filed or a
search is typed (microseconds each). Learning is a short burst in a capped worker thread. Tidy and tucked tabs keep
the number of loaded pages down, and sleeping tabs unload the rest; those matter far more on a 4 GB machine than
Kilr does.

## How good it is

**Sentence similarity** (Spearman × 100 against human scores; test sets never used for fitting):

| | Size | STS-B | SICK |
|---|---|---|---|
| Teacher, all-MiniLM-L6-v2 | 90 MB, transformer | 82.0 | 77.1 |
| **Kilr (shipped)** | **7.9 MB, table** | **72.3** | **62.9** |
| Token vectors only (model2vec-style, same teacher) | 7.9 MB | 52.6 | 59.3 |
| Word overlap (Skillerr before Kilr) | none | 65.3 | 55.7 |

**Trails** (`scripts/kilr/eval-trails.js`): realistic threads of work (searches and page titles, worded differently),
replayed shuffled over three days with no tab or opener hints, the hardest case. Thresholds were set on the tuning set;
the held-out threads were only used to score.

| Held-out threads | Words only | With Kilr |
|---|---|---|
| Precision (pages grouped together that belong together) | 0.81 | **0.95** |
| Recall (pages that belong together, grouped) | 0.30 | **0.57** |
| F1 | 0.43 | **0.71** |

In everyday browsing most pages also come with a tab or an opener, which Trails already uses, so this is a floor.

## Limits

- **Kilr knows what its teacher knew.** Rare words split into pieces the teacher never learned well: the teacher
  itself scores "ryokan near Gion" against "where to stay in Kyoto" at 0.28. A stronger teacher would lift Kilr at the
  same size and speed. The pipeline takes any teacher; the strong small embedding models are on Hugging Face, which can
  run in CI.
- **Training texts.** Only texts whose licences allow shipping what's learned were used. A reference fit on
  research-only corpora (Brown, Reuters, SICK) scored 76.3 / 68.1, so broader modern text would help.
- **Naming trails.** Choosing a name from a trail's own phrases produced fragments ("You Buy", "Laptop for most"), worse
  than the current rule (first search, or first page title). Trails keep that rule; naming needs a small text generator.
- **English.** The vocabulary is English (uncased). Other languages fall back to word matching in practice.

## Where this stands

Done, on `develop`:

- The model: distilled table, tokenizer, calibration, runtime (`src/kilr/`), build pipeline (`scripts/kilr/`).
- Trails matching and search by meaning; the start-page line; "Ask Kilr"; recall by meaning without Ollama.
- Weekly learning from the user's trails, with the proof-before-keep check, worker thread, schedule and settings.
- Tabs sort themselves into trail groups; find anything by meaning from the address bar; Tidy closes duplicates.
- Skills suggested from habits in trails (yours and your AIs'), saved as standard skills.

Next, in order of value:

1. **A stronger teacher, distilled in CI.** Better base vectors lift everything at the same size and speed. The
   pipeline takes any teacher; the strong small embedding models are on Hugging Face (reachable from GitHub Actions).
2. **Learn from more than titles.** Research memory's keywords for pages the AI read, and the user's own
   corrections (moving a page between trails, merging) as extra-strong signals.
3. **Kilr in the .skill protocol.** Export a trail as a signed .skill file; `my_trails` answers with one.
4. **Naming trails** needs a small text generator. Phrase-picking was tried and read worse than the current rule.

## Code

| File | Role |
|---|---|
| `src/kilr/tokenizer.js` | WordPiece (BERT uncased), matching Hugging Face's on 5,765 test texts |
| `src/kilr/embed.js` | Loads the table, embeds texts, cosine and centroid |
| `src/kilr/index.js` | `Kilr`: page–trail affinity, ranking trails for a question, answers from a trail's facts |
| `src/kilr/calibration.js` | Where Kilr's cosines fall |
| `src/kilr/suggest.js` | Skills from habits in trails: kinds of task, search patterns, sites in order, the SKILL.md |
| `src/kilr/train.js`, `train-worker.js` | Learning from the user's trails; runs in a worker thread |
| `src/embed.js` | Recall by meaning: Kilr built in, or an endpoint |
| `src/trails.js` | Uses Kilr (`meaning`) when given, words otherwise |
| `src/history-graph.js`, `src/ui/memoryview.js` | The History page: one graph of memory and trails, drawn as light coming out of Kilr |
| `src/ui/kilrview.js` | Kilr's panel on the History page (status from `kilr-status`, polled every 2 s while open) |
| `assets/kilr/` | The model (`kilr-embed.bin`, `vocab.txt`) and its provenance |
| `scripts/kilr/` | Building, calibrating, benchmarking and evaluating it |
| `test/kilr-suggest.test.js` | Suggested skills from simulated browsing |
| `test/kilr.test.js` | Tokenizer, model, meaning, answers, Trails grouping on held-out threads, recall, learning, the worker |
| `scripts/kilr/eval-trails.js`, `eval-personal.js`, `personal-data.js` | How well Kilr groups threads of work, and what learning adds |
