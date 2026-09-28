# Kilr embeddings (kilr-embed-1)

`kilr-embed.bin` and `vocab.txt` are Kilr's model: one 256-number vector (int8, with a scale per row) for each of
the 30,522 word pieces in `vocab.txt`. Built with `scripts/kilr/` (see its README).

- **Distilled from** [`sentence-transformers/all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
  (revision `c9745ed1d9f207416be6d2e6f8de32d1f16199bf`), licensed Apache-2.0. `vocab.txt` is that model's vocabulary.
  These files are a derivative of it and are distributed under the Apache License 2.0.
- **Fitted on texts from:** Project Gutenberg books (public domain, via NLTK), README prose of MIT / ISC / Apache-2.0 /
  BSD npm packages, the Kubernetes website and GitHub docs (CC-BY 4.0: © The Kubernetes Authors; © GitHub, Inc.),
  digital.gov (CC0) and 18F guides (US government, public domain). The texts are only prompts for the teacher model;
  no text is stored in these files.
- **Scored on** STS-B test (Spearman 72.3) and SICK test (62.9); the teacher scores 82.0 and 77.1.
