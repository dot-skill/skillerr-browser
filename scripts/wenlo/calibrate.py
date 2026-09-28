# Where Wenlo's cosines fall for pairs people call unrelated vs the same, on STS-B dev (not the test set):
# LOW = 75th percentile of unrelated pairs (gold <= 1); HIGH = median of pairs rated "roughly equivalent, details
# differ" (gold 3-4): Wenlo judges "same topic", not "same sentence".
# Usage: python3 calibrate.py wenlo-E-clean.npy   → prints LOW and HIGH for src/wenlo/calibration.js
import sys, csv, numpy as np, tokenizers
E = np.load(sys.argv[1]).astype(np.float32)
tok = tokenizers.Tokenizer.from_file('pk/mini/package/tokenizer.json'); tok.no_padding(); tok.no_truncation()
def emb(t):
    ids = tok.encode(t).ids[1:-1]
    v = E[ids].mean(0) if ids else np.zeros(E.shape[1]); n = np.linalg.norm(v)
    return v / n if n else v
pairs = [(r[0], r[1], float(r[2])) for r in csv.reader(open('stsb-dev.csv'))]
cos = np.array([float(emb(a) @ emb(b)) for a, b, _ in pairs]); gold = np.array([g for *_, g in pairs])
for lo, hi in [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5.1)]:
    m = (gold >= lo) & (gold < hi)
    print(f'gold {lo}-{hi}: n={m.sum():4d}  cosine p25 {np.percentile(cos[m],25):.2f}  median {np.median(cos[m]):.2f}  p75 {np.percentile(cos[m],75):.2f}')
low = np.percentile(cos[gold <= 1], 75); high = np.median(cos[(gold >= 3) & (gold < 4)])
print(f'LOW {low:.2f}  HIGH {high:.2f}')
