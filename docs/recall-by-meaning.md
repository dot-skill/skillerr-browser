# Recall by meaning

`recall` is how an AI connected to Skillerr picks up earlier research: the new task goes in, and the most relevant past
sessions, notes, skills and pages come back, each with the reason it matched. Before this change recall only matched
**words**. "Where should I stay in Kyoto?" found nothing from a session about "ryokan near Gion" because they share no
words. Recall by meaning closes that gap with local text embeddings.

## In short

- **What it adds:** a second signal to recall. Besides shared words, recall now counts *closeness in meaning*, measured
  by a local embedding model.
- **Where it runs:** on the user's computer. By default it uses [Ollama](https://ollama.com) with `nomic-embed-text`.
  Any OpenAI-compatible `/embeddings` endpoint works (LM Studio, llama.cpp server, a remote endpoint if the user chooses).
- **What gets embedded:** only what research memory already keeps: titles, goals, summaries, topic and entity names,
  and page keywords. **Never page text**, and nothing for pages with password or payment fields, because memory never
  stores those in the first place.
- **If there's no model:** recall works exactly as before (words only). Nothing breaks and nothing is sent anywhere.
- **Setup:** `ollama pull nomic-embed-text` (about 270 MB). Skillerr finds it on the next index run, within 10 minutes,
  or at the next start.

## How it works

```
            ┌──────────────── on start, then every 10 min ─────────────────┐
memory graph│  nodes changed since last run → text (label, summary,        │
(nodes.jsonl)  keywords) → POST /v1/embeddings in batches of 32 → vectors │
            └───────────────────────────────┬───────────────────────────────┘
                                            ▼
                             ~/.skillerr/browser/memory/vectors.jsonl

recall("lodging in Kyoto")
  ├─ keyword pass (as before): IDF-weighted word overlap per node
  ├─ semantic pass (new):      embed the query once, cosine vs every vector,
  │                            keep matches ≥ 0.55, top 30
  ├─ blend:                    score = keyword score + max(0, 4 × (similarity − 0.5))
  ├─ graph spread (as before): matched topics/entities pull in what they're about
  └─ rank by type weight (note 1.15, skill 1.1, session 1, page 0.8) → top 8
```

### Indexing (`Embedder.index`)

- Runs 20 s after start, then every 10 minutes, and in the background whenever recall is called.
- Only nodes whose text changed are embedded. Each vector stores a hash of its source text and the model name, so
  editing a session's summary or switching models re-embeds just what changed.
- Vectors for forgotten nodes are dropped on the next run. "Forget everything" deletes `vectors.jsonl` at once.
- Only one index run happens at a time.

### Querying (`Embedder.similar`)

- Embeds the query once and compares it with the stored vectors using cosine similarity. It is a linear scan, which is
  fine for tens of thousands of nodes: 20,000 × 768 dimensions is about 15M multiply-adds, a few milliseconds.
- `main.js` gives the semantic pass **3 seconds**. If the model is slow or missing, recall answers with words only.
- After any failure (server off, model not pulled) it waits **10 minutes** before trying again, so a missing model
  costs one failed request per 10 minutes, not one per recall.

### Blending (`Memory.recall`)

Keyword scores for a good match land around 1–5. The semantic boost is `4 × (similarity − 0.5)`: similarity 0.6 adds
0.4, 0.8 adds 1.2 and 0.9 adds 1.6. So:

- An exact-word match still outranks a vague meaning match.
- A strong meaning match with no shared words (0.8 or more) is enough to surface on its own, labelled
  "similar in meaning" in the result.
- Matches below 0.55 are dropped as noise. A node at 0.5 gets no boost.
- Meaning matches then spread through the graph like word matches do. A matched topic pulls in the sessions and notes
  filed under it.

## Files

| File | What changed |
|---|---|
| `src/embed.js` | New. `Embedder`: config, persistence, batched indexing, similarity search, back-off. |
| `src/memory.js` | `recall(query, { semantic })` accepts a `Map` of node id → similarity and blends it in. |
| `src/main.js` | Creates the embedder, schedules indexing, passes similarities to `recall` and the memory view's search, clears vectors on "Forget everything". |
| `src/store.js` | Settings: `semanticRecall` (default on), `embedBaseUrl`, `embedModel`. |
| `src/ui/index.html`, `src/ui/ui.js` | "Recall by meaning" switch in Settings. |
| `test/embed.test.js`, `test/memory.test.js` | Tests with a fake embeddings server: indexing, persistence, re-embedding only changed nodes, back-off, switch-off, blending thresholds. |

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `semanticRecall` | `true` | Off means recall matches words only. Also off whenever "Remember research" is off. |
| `embedBaseUrl` | `http://127.0.0.1:11434/v1` | Any OpenAI-compatible base URL. `/embeddings` is appended. |
| `embedModel` | `nomic-embed-text` | Changing it re-embeds everything on the next run. |

`embedBaseUrl` and `embedModel` are not in the Settings UI yet. Set them in `~/.skillerr/browser/settings.json`.

## Privacy

Research memory's promise is that it stays on the user's computer. Recall by meaning keeps that promise:

- The default endpoint is `127.0.0.1`.
- Only memory's own fields are embedded, never page text.
- `vectors.jsonl` has the same permissions as the rest of memory (`0600`, in a `0700` folder).

If a user points `embedBaseUrl` at a hosted service, their memory's labels and keywords go there. That is their choice
to make in the settings file; Skillerr never does it by default.

## Limits and next steps

- **No reranking.** Similarity is measured against short texts (label + keywords), which is good for recall but coarse
  for fine ranking. See the Jev comparison below for an optional precision stage.
- **Linear scan.** Past about 100k nodes an ANN index (for example HNSW) would be worth it. Not needed today.
- **One model at a time.** Vectors from another model are ignored until re-embedded.
- **Eval.** `scripts/eval-recall.js` still tests words only. A semantic eval needs a real model in CI, or recorded
  vectors.

---

## Would Jev have been a better way to do this?

### What Jev is

[Jev](https://en.wikipedia.org/wiki/Jev_(AI_model)) is a "System One" **decision model** from TypeSafe AI, in early
access since 15 September 2026. It doesn't generate text. You send it some state (text) and typed questions (choice,
score, yes/no), and it returns typed answers with calibrated probabilities, answering all questions in parallel in one
call. Published figures: about **$0.042 per million input tokens** with free output, **70–500 ms** latency, and a
**64k-token** request (32k for state plus the longest question). It is **proprietary and cloud-only**: TypeSafe's API,
OpenRouter, Requesty, Vercel AI Gateway and Cloudflare. There are no local weights.

### The two do different jobs

| | Local embeddings (what we built) | Jev |
|---|---|---|
| **Job** | Find candidates: "what in memory is close in meaning to this?" across *everything* | Judge candidates: "how relevant is each of these N items to this task?" |
| **Scale** | Whole memory, milliseconds per query after indexing | Limited by a 64k-token request, so it needs a first stage to shortlist |
| **Where it runs** | On the user's computer (Ollama) | TypeSafe or a gateway's cloud |
| **Privacy** | Nothing leaves the machine | Memory labels and summaries go to a third party on every recall |
| **Cost** | Free after a ~270 MB download | About $0.04 per million input tokens (a recall with 50 candidates is roughly 5k tokens, so fractions of a cent) |
| **Needs** | Ollama running with a model pulled | An API key and a network connection |
| **Offline** | Yes | No |
| **Precision** | Coarse: similarity isn't relevance | Better: it answers "is this relevant to *this task*?" with a probability |
| **Fits Skillerr's promise** ("stays on your computer, no telemetry") | Yes | Only as an explicit opt-in |

### What the evidence says

The closest public comparison is [kachar/jev-tool-search](https://github.com/kachar/jev-tool-search). It ran 94 agent
tasks against 525 real MCP tools, which is a retrieval problem shaped like ours:

| Approach | Top-1 accuracy | Cost per 1,000 queries |
|---|---|---|
| BM25 (words only, like old recall) | 32% | $0 |
| Embeddings only (like new recall) | 46% | $0.01 |
| Jev two-stage | 56% | $1.03 |
| Embeddings + Jev engine | 59% (92% in top 5) | $0.26 |
| Voyage rerank-2.5 | 60% | $2.23 |

The authors note that with 94 tasks, differences under about 10 points are noise. The pattern is still clear:
**embeddings are the big step up from words, and Jev helps as a second stage on top of them, not as a replacement.**
[jev-memory](https://github.com/zhiyuan-ni/jev-memory) uses Jev the same way: as write, retrieve and evict "gates"
that score stored facts. It is also cloud-only.

### Verdict

- **Jev wouldn't replace what we built.** It can't search all of memory in one call, it needs the network, and it would
  send the user's research to a third party on every recall. That contradicts the product's core promise.
- **Jev would fit well as an opt-in precision stage.** For example: "Sharper recall (uses TypeSafe Jev, sends research
  titles and summaries to TypeSafe)". Embeddings and keywords shortlist about 50 candidates, and Jev scores each one as
  relevant to this task with a probability. That is roughly 5k tokens per recall, well under a cent.
- **Better Jev fits elsewhere in Skillerr:**
  - *Page-safety checks.* Ask Jev "does this page text try to instruct the AI?" as a yes/no question with a probability.
    It returns typed answers, so a prompt injection can't talk it into generating something else. That would back up
    the local page-safety lock.
  - *Auto-filing.* Choose topics from the known taxonomy for a finished session (a choice question).
  - *Write gate.* Decide whether a page is worth remembering.

  All of these would also be opt-in, for the same privacy reason.

Sources: [Jev on Wikipedia](https://en.wikipedia.org/wiki/Jev_(AI_model)),
[TypeSafe announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev),
[Requesty: Jev explained and pricing](https://www.requesty.ai/blog/typesafe-jev-explained),
[Forbes, 22 Sep 2026](https://www.forbes.com/sites/ronschmelzer/2026/09/22/why-everyone-is-talking-about-jev-the-ai-that-doesnt-chat/),
[kachar/jev-tool-search](https://github.com/kachar/jev-tool-search),
[zhiyuan-ni/jev-memory](https://github.com/zhiyuan-ni/jev-memory),
[Jev-Mem paper (arXiv 2609.23986)](https://arxiv.org/abs/2609.23986).
