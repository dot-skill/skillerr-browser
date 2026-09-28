# Building Wenlo's embeddings

Wenlo's model is a table: one small vector per word piece of the `all-MiniLM-L6-v2` vocabulary (30,522 pieces × 256
numbers, int8). A text's embedding is the average of its pieces' vectors. This folder rebuilds that table from scratch
on a laptop CPU in well under an hour. No GPU, no training loop.

## How it's made

1. **Teacher.** `all-MiniLM-L6-v2` (Apache-2.0, ONNX) embeds every vocabulary piece on its own, and every text of a
   training corpus (`teach.js`, with `onnxruntime-node`; only needed here, never shipped).
2. **Token vectors.** The pieces' teacher embeddings, reduced from 384 to 256 numbers with PCA (the model2vec idea).
   Averaging these alone scores poorly, because every word counts the same.
3. **Closed-form fit** (`distill.py`). Find the table `E` that makes averaged pieces land on the teacher's embedding
   of each corpus text:

   `minimise ‖A·E − Y‖² + λ‖E − E₀‖²`

   where `A` averages each text's pieces, `Y` holds the teacher's (PCA-reduced) text embeddings, and `E₀` the token
   vectors from step 2 (keeping rare pieces sensible). It's a linear least-squares problem, solved exactly per dimension
   with preconditioned conjugate gradients on the sparse normal equations. The fit learns, among other things, how
   much each piece should count ("the" next to nothing, "ryokan" a lot), which other methods need a hand-set weighting
   or a gradient-trained model for.
4. **Pack** (`export.py`): int8 rows with a float32 scale each, `WNL1` format (see `src/wenlo/embed.js`).
5. **Calibrate** (`calibrate.py`): where cosines of unrelated and near-identical pairs fall, on STS-B dev, for
   `src/wenlo/calibration.js`.

## Training texts

`corpus.py` builds about 135,000 texts from sources whose terms allow shipping what's learned from them:

- Project Gutenberg books (public domain, via NLTK's `gutenberg` corpus)
- README prose of MIT, ISC, Apache-2.0 and BSD npm packages in `node_modules` (modern, technical words)
- word bags drawn from the vocabulary (covers modern words the books lack)
- short spans cut from the sentences (page titles and searches are 2–8 words)

What Wenlo learns comes from the teacher's embedding of each text, so the texts only need to be varied.

## Run it

```bash
mkdir work && cd work
# teacher: all-MiniLM-L6-v2 ONNX + tokenizer.json in pk/mini/package/ (e.g. from Hugging Face, revision c9745ed)
python3 -c "import json;v=sorted(json.load(open('pk/mini/package/tokenizer.json'))['model']['vocab'].items(),key=lambda x:x[1]);open('vocab.txt','w').write('\n'.join(k for k,_ in v))"
curl -sO https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/gutenberg.zip
curl -s -o stsb-test.csv https://raw.githubusercontent.com/PhilipMay/stsb-multi-mt/main/data/stsb-en-test.csv
curl -s -o stsb-dev.csv https://raw.githubusercontent.com/PhilipMay/stsb-multi-mt/main/data/stsb-en-dev.csv
curl -s -o sick-test.txt https://raw.githubusercontent.com/brmson/dataset-sts/master/data/sts/sick2014/SICK_test_annotated.txt
npm i onnxruntime-node --ignore-scripts && pip install numpy scipy tokenizers
python3 ../corpus.py
node ../teach.js vocab && node ../teach.js clean && node ../teach.js eval
SFX=-clean LAMS=0.01,0.03 python3 ../distill.py 256
python3 ../export.py wenlo-E-clean.npy ../../../assets/wenlo/wenlo-embed.bin && cp vocab.txt ../../../assets/wenlo/
python3 ../calibrate.py wenlo-E-clean.npy
node ../bench.js
```

STS-B and SICK test sets are used only to score the result, never to fit it.
