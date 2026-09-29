# Kilr embeddings: distil all-MiniLM-L6-v2 into one static vector per WordPiece token.
#   1. token vectors: the teacher's embedding of each vocabulary token alone, reduced with PCA   (E0)
#   2. closed-form fit: find E minimising ||A E - Y||^2 + lam ||E - E0||^2, where A averages each corpus text's
#      tokens and Y is the teacher's (PCA-reduced) embedding of that text. Solved per dimension with conjugate gradients.
import json, sys, time, csv
import numpy as np, scipy.sparse as sp, scipy.sparse.linalg as sla
from scipy.stats import spearmanr
import tokenizers

D0 = 384
V = 30522
tok = tokenizers.Tokenizer.from_file('pk/mini/package/tokenizer.json'); tok.no_padding(); tok.no_truncation()
Tv = np.fromfile('teach-vocab.f32', dtype=np.float32).reshape(V, D0)
import os
SFX = os.environ.get('SFX', '')
Tc = np.fromfile(f'teach-corpus{SFX}.f32', dtype=np.float32).reshape(-1, D0)
ids = json.load(open(f'corpus{SFX}-ids.json'))
Te = np.fromfile('teach-eval.f32', dtype=np.float32).reshape(-1, D0)
evtexts = json.load(open('eval-texts.json'))
evids = [tok.encode(t).ids[1:-1][:126] for t in evtexts]
gold_sts = [float(r[2]) for r in csv.reader(open('stsb-test.csv'))]
gold_sick = [float(l.split('\t')[3]) for i, l in enumerate(open('sick-test.txt')) if i]
nsts = len(gold_sts)

def pool(E, seqs, w=None):
    out = np.zeros((len(seqs), E.shape[1]), dtype=np.float32)
    for i, s in enumerate(seqs):
        if not s: continue
        v = E[s] if w is None else E[s] * w[s][:, None]
        out[i] = v.sum(0) / (len(s) if w is None else max(w[s].sum(), 1e-9))
    n = np.linalg.norm(out, axis=1, keepdims=True); n[n == 0] = 1
    return out / n

def score(X):
    cos = (X[0::2] * X[1::2]).sum(1)
    a = spearmanr(cos[:nsts], gold_sts).correlation
    b = spearmanr(cos[nsts:], gold_sick).correlation
    return a * 100, b * 100

def report(name, X):
    a, b = score(X); print(f'{name:48s} STS-B {a:5.1f}   SICK {b:5.1f}', flush=True); return a, b

report('teacher all-MiniLM-L6-v2 (22M params, 90 MB)', Te)

# Baseline: word overlap, what Trails and research memory use today (tokens() from src/memory.js, roughly).
import re
STOP = set(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'memory.js')).read().split('new Set(`')[1].split('`')[0].split())
def words(t): return set(w[:-1] if len(w) > 4 and w.endswith('s') and not w.endswith('ss') else w for w in re.findall(r'\w{3,}', t.lower()) if w not in STOP)
jac = []
for i in range(0, len(evtexts), 2):
    a, b = words(evtexts[i]), words(evtexts[i + 1]); jac.append(len(a & b) / max(1, len(a | b)))
jac = np.array(jac)
print(f"{'word overlap (Skillerr today)':48s} STS-B {spearmanr(jac[:nsts], gold_sts).correlation*100:5.1f}   SICK {spearmanr(jac[nsts:], gold_sick).correlation*100:5.1f}")

# corpus token frequencies (for the SIF baseline)
freq = np.ones(V)
for s in ids:
    for t in s: freq[t] += 1
p = freq / freq.sum()

results = {}
for d in [int(x) for x in sys.argv[1:]] or [256]:
    mu = Tc.mean(0)
    U, S, Wt = np.linalg.svd(Tc[:60000] - mu, full_matrices=False)  # PCA basis from sentence space
    P = Wt[:d].T.astype(np.float32)                                     # 384 x d
    E0 = (Tv - mu) @ P
    report(f'[d={d}] token vectors only (model2vec-style)', pool(E0, evids))
    sif = 1e-3 / (1e-3 + p)
    report(f'[d={d}] token vectors + SIF weights', pool(E0, evids, sif.astype(np.float32)))
    # closed-form fit
    t0 = time.time()
    rows, cols, vals = [], [], []
    for i, s in enumerate(ids):
        if not s: continue
        for t in s: rows.append(i); cols.append(t); vals.append(1.0 / len(s))
    A = sp.csr_matrix((vals, (rows, cols)), shape=(len(ids), V), dtype=np.float64)
    Y = ((Tc - mu) @ P).astype(np.float64)
    AtA = (A.T @ A).tocsr(); AtY = A.T @ Y
    for lam in [float(x) for x in os.environ.get('LAMS', '0.003,0.01,0.03').split(',')]:
        M = AtA + lam * sp.identity(V, format='csr')
        B = AtY + lam * E0
        E = np.zeros((V, d), dtype=np.float32)
        diag = M.diagonal(); pre = sp.diags(1 / diag)
        for k in range(d):
            x, info = sla.cg(M, B[:, k], x0=E0[:, k].astype(np.float64), M=pre, maxiter=300, rtol=1e-6)
            E[:, k] = x
        a, b = report(f'[d={d}] closed-form fit, lam={lam} ({time.time()-t0:.0f}s)', pool(E, evids))
        results[(d, lam)] = (a + b, E, P, mu)
best = max(results, key=lambda k: results[k][0])
print('best', best)
_, E, P, mu = results[best]
np.save(f'kilr-E{SFX}.npy', E); np.save(f'kilr-P{SFX}.npy', P); np.save(f'kilr-mu{SFX}.npy', mu)
# int8 per-row quantisation check
scale = np.abs(E).max(1, keepdims=True) / 127; scale[scale == 0] = 1
Eq = np.round(E / scale).astype(np.int8)
report(f'[d={best[0]}] fit, int8 ({V*best[0]/1e6:.1f} MB)', pool(Eq.astype(np.float32) * scale, evids))
