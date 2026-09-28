# Recall by meaning

`recall` is how an AI connected to Skillerr picks up earlier research: the new task goes in, and the most relevant past
sessions, notes, skills and pages come back, each with the reason it matched. Matching words alone misses a lot: "Where
should I stay in Kyoto?" shares no words with a session about "ryokan near Gion". Recall by meaning closes that gap with
local text embeddings.

## In short

- **What it adds:** a second signal to recall. Besides shared words, recall now counts *closeness in meaning*, measured
  by a local embedding model.
- **Where it runs:** on the user's computer. By default it uses **Scout**, Skillerr's own built-in embeddings
  ([docs/scout.md](scout.md)): nothing to install, microseconds per text, vectors kept in memory only. Setting
  `embedBaseUrl` switches to any OpenAI-compatible `/embeddings` endpoint instead (Ollama with `nomic-embed-text`, LM
  Studio, llama.cpp server, a remote endpoint if the user chooses), and the rest of this page describes that path.
- **What gets embedded:** only what research memory already keeps: titles, goals, summaries, topic and entity names,
  and page keywords. **Never page text**, and nothing for pages with password or payment fields, because memory never
  stores those in the first place.
- **If Scout is off and there's no endpoint:** recall works exactly as before (words only). Nothing breaks and nothing
  is sent anywhere.
- **Setup:** none with Scout. For an endpoint: `ollama pull nomic-embed-text` (about 270 MB) and set `embedBaseUrl`.
- **Scale:** Scout's raw cosines run lower than nomic's, so they're mapped onto the same scale (`scoutScale` in
  `src/embed.js`, from its calibration) and recall's thresholds below hold for both.

## How it works

```
            ┌──────────────── on start, then every 10 min ─────────────────┐
memory graph│  nodes changed since last run → text (label, summary,        │
(nodes.jsonl)  keywords) → POST /v1/embeddings in batches of 32 → vectors │
            └───────────────────────────────┬───────────────────────────────┘
                                            ▼
                             ~/.skillerr/browser/memory/vectors.jsonl

recall("lodging in Kyoto")
  ├─ keyword pass:  IDF-weighted word overlap per node
  ├─ semantic pass: embed the query once, cosine vs every vector,
  │                 keep matches ≥ 0.55, top 30
  ├─ blend:         score = keyword score + max(0, 4 × (similarity − 0.5))
  ├─ graph spread:  matched topics/entities pull in what they're about
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

## Code

| File | Role |
|---|---|
| `src/embed.js` | `Embedder`: config, persistence, batched indexing, similarity search, back-off. |
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

## Limits

- **No reranking.** Similarity is measured against short texts (label + keywords), which is good for recall but coarse
  for fine ranking.
- **Linear scan.** Fast up to tens of thousands of nodes; much larger memories would want an approximate index.
- **One model at a time.** Vectors from another model are ignored until re-embedded.
- **Evaluation.** `scripts/eval-recall.js` measures word matching; the embedding path is covered by tests with a fake
  embeddings server.
