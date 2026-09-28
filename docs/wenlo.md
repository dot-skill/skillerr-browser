# Wenlo

Wenlo is Skillerr's own small AI. (The name is coined, from *wend*: to find your way along a path, as it does along
your trails.) It's built into the browser, runs on the user's computer, and knows their work by
meaning: which trail a page belongs to, which trails a search is about, where they were with something. There's
nothing to install and nothing to download, and nothing leaves the computer.

## In short

- **Tiny and fast.** One 7.9 MB file. It loads in about 30 ms, uses about 22 MB of memory, and embeds a page title in
  about 26 µs: some 39,000 texts a second on one core, in plain JavaScript with no native code.
- **No text generation.** Wenlo embeds and then *chooses*. What it says is built from the facts of the user's own
  trails, so it can't make things up.
- **Built from an open model, by us.** Distilled from `all-MiniLM-L6-v2` (Apache-2.0) with a closed-form fit that runs
  on a laptop CPU in minutes (below). The whole pipeline is in `scripts/wenlo/`.
- **Replaces Ollama for recall by meaning.** Recall matches past research by meaning out of the box. An
  OpenAI-compatible endpoint (`embedBaseUrl`) still takes over when set.

## What it does

| Where | What Wenlo does |
|---|---|
| **Trails: filing pages** | A page joins a trail by meaning as well as by shared words. "hotels in japan for october" joins a trail of "cheap flights to tokyo". |
| **Trails: search** | The Trails page search box is "Ask Wenlo": "plane tickets to Japan" finds the Tokyo flights trail. |
| **Start page** | One line above the trail cards: the latest trail, where you stopped and what's unfinished, with **Continue**. |
| **Ask** | "Where was I with the office chair?" answers from that trail's facts. "Where was I?" alone means the latest trail. |
| **Recall by meaning** | `recall` and the research memory search match by meaning with Wenlo's vectors, kept in memory (re-making them is faster than reading them). |
| **AI apps** | `my_trails` with a `query` finds trails by meaning. |

Settings → Trails → **Wenlo** turns it off. Trails then match by shared words, and recall by words (or an endpoint if set).

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

Wenlo's cosines are calibrated on held-back data (`src/wenlo/calibration.js`): sentence pairs people scored (STS-B dev)
for recall, and pages against the centre of real threads of work for Trails.

## How good it is

**Sentence similarity** (Spearman × 100 against human scores; test sets never used for fitting):

| | Size | STS-B | SICK |
|---|---|---|---|
| Teacher, all-MiniLM-L6-v2 | 90 MB, transformer | 82.0 | 77.1 |
| **Wenlo (shipped)** | **7.9 MB, table** | **72.3** | **62.9** |
| Token vectors only (model2vec-style, same teacher) | 7.9 MB | 52.6 | 59.3 |
| Word overlap (Skillerr before Wenlo) | none | 65.3 | 55.7 |

**Trails** (`scripts/wenlo/eval-trails.js`): realistic threads of work (searches and page titles, worded differently),
replayed shuffled over three days with no tab or opener hints, the hardest case. Thresholds were set on the tuning set;
the held-out threads were only used to score.

| Held-out threads | Words only | With Wenlo |
|---|---|---|
| Precision (pages grouped together that belong together) | 0.81 | **0.95** |
| Recall (pages that belong together, grouped) | 0.30 | **0.57** |
| F1 | 0.43 | **0.71** |

In everyday browsing most pages also come with a tab or an opener, which Trails already uses, so this is a floor.

## Limits

- **Wenlo knows what its teacher knew.** Rare words split into pieces the teacher never learned well: the teacher
  itself scores "ryokan near Gion" against "where to stay in Kyoto" at 0.28. A stronger teacher would lift Wenlo at the
  same size and speed. The pipeline takes any teacher; the strong small embedding models are on Hugging Face, which can
  run in CI.
- **Training texts.** Only texts whose licences allow shipping what's learned were used. A reference fit on
  research-only corpora (Brown, Reuters, SICK) scored 76.3 / 68.1, so broader modern text would help.
- **Naming trails.** Choosing a name from a trail's own phrases produced fragments ("You Buy", "Laptop for most"), worse
  than the current rule (first search, or first page title). Trails keep that rule; naming needs a small text generator.
- **English.** The vocabulary is English (uncased). Other languages fall back to word matching in practice.

## Code

| File | Role |
|---|---|
| `src/wenlo/tokenizer.js` | WordPiece (BERT uncased), matching Hugging Face's on 5,765 test texts |
| `src/wenlo/embed.js` | Loads the table, embeds texts, cosine and centroid |
| `src/wenlo/index.js` | `Wenlo`: page–trail affinity, ranking trails for a question, answers from a trail's facts |
| `src/wenlo/calibration.js` | Where Wenlo's cosines fall |
| `src/embed.js` | Recall by meaning: Wenlo built in, or an endpoint |
| `src/trails.js` | Uses Wenlo (`meaning`) when given, words otherwise |
| `assets/wenlo/` | The model (`wenlo-embed.bin`, `vocab.txt`) and its provenance |
| `scripts/wenlo/` | Building, calibrating, benchmarking and evaluating it |
| `test/wenlo.test.js` | Tokenizer, model, meaning, answers, Trails grouping on held-out threads, recall |
