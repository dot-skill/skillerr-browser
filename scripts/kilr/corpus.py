# Kilr's training texts, from sources whose licences allow shipping what's learned from them:
#   - Project Gutenberg books (public domain), via NLTK's gutenberg corpus
#   - README prose of MIT / ISC / Apache-2.0 / BSD npm packages in ../../node_modules (modern, technical words)
#   - documentation prose and page titles, cloned into ./open (git clone --depth 1 --sparse):
#       kubernetes/website content/en, github/docs content (CC-BY 4.0);
#       GSA/digitalgov.gov content (CC0), 18F/guides content (US government, public domain)
#   - word bags drawn from the vocabulary (so modern words like hotel, laptop or visa are covered too)
#   - short spans cut from the sentences (page titles and searches are 2-8 words, not sentences)
# The texts only need to be varied: what Kilr learns comes from the teacher's embedding of each one.
# Usage (in a work folder holding gutenberg.zip and vocab.txt): python3 corpus.py  → corpus-clean.txt
import zipfile, re, random, json, os, glob

random.seed(11)
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
sents = []
z = zipfile.ZipFile('gutenberg.zip')
for n in z.namelist():
    if n.endswith('.txt') and 'README' not in n:
        text = z.read(n).decode('utf8', 'ignore').replace('\r', ' ').replace('\n', ' ')
        for s in re.split(r'(?<=[.!?])\s+', text):
            s = re.sub(r'\s+', ' ', s).strip()
            if 4 <= len(s.split()) <= 40:
                sents.append(s)
books = len(sents)

readmes = 0
for pj in glob.glob(os.path.join(ROOT, 'node_modules', '**', 'package.json'), recursive=True):
    try:
        meta = json.load(open(pj))
    except Exception:
        continue
    lic = str(meta.get('license') or '')
    if not re.fullmatch(r'\(?(MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD)( OR [A-Za-z0-9.\-]+)?\)?', lic):
        continue
    d = os.path.dirname(pj)
    for f in os.listdir(d):
        if f.lower().startswith('readme'):
            t = open(os.path.join(d, f), errors='ignore').read()
            t = re.sub(r'```.*?```', ' ', t, flags=re.S)
            t = re.sub(r'`[^`]*`|<[^>]+>|\[([^\]]*)\]\([^)]*\)|https?://\S+|[#*_>|]', lambda m: m.group(1) or ' ', t)
            for s in re.split(r'(?<=[.!?])\s+|\n\s*\n', t):
                s = re.sub(r'\s+', ' ', s).strip()
                if 4 <= len(s.split()) <= 40 and sum(c.isalpha() for c in s) > 0.7 * len(s):
                    sents.append(s)
            readmes += 1

books_and_readmes = list(dict.fromkeys(sents))

# Documentation prose, and page titles (front matter "title:"), which read like the tabs Kilr sees.
docs, doc_titles = [], []
for f in glob.glob(os.path.join('open', '*', '**', '*.md'), recursive=True):
    t = open(f, errors='ignore').read()
    m = re.match(r'^---\n(.*?)\n---\n', t, flags=re.S)
    if m:
        tm = re.search(r'^title:\s*["\']?(.+?)["\']?\s*$', m.group(1), flags=re.M)
        if tm and 2 <= len(tm.group(1).split()) <= 14:
            doc_titles.append(tm.group(1))
        t = t[m.end():]
    t = re.sub(r'```.*?```|\{\{.*?\}\}|\{%.*?%\}|<!--.*?-->', ' ', t, flags=re.S)
    t = re.sub(r'`[^`]*`|<[^>]+>|!?\[([^\]]*)\]\([^)]*\)|https?://\S+|[#*_>|]', lambda m: m.group(1) or ' ', t)
    for s in re.split(r'(?<=[.!?])\s+|\n\s*\n', t):
        s = re.sub(r'\s+', ' ', s).strip()
        if 4 <= len(s.split()) <= 40 and sum(c.isalpha() for c in s) > 0.7 * len(s):
            docs.append(s)
docs = list(dict.fromkeys(docs))
doc_titles = list(dict.fromkeys(doc_titles))
random.shuffle(docs)
random.shuffle(books_and_readmes)
sents = books_and_readmes[:35000] + docs[:120000]
random.shuffle(sents)
vocab = open('vocab.txt').read().split('\n')
words = [w for w in vocab if re.fullmatch(r'[a-z]{3,}', w)]
bags = [' '.join(random.sample(words, random.randint(2, 6))) for _ in range(40000)]
spans = []
for s in sents[:50000]:
    w = s.split()
    if len(w) > 6:
        k = random.randint(2, 7)
        i = random.randint(0, len(w) - k)
        spans.append(' '.join(w[i:i + k]).strip('.,;:"\''))
corpus = sents + doc_titles + bags[:15000] + spans[:20000]
random.shuffle(corpus)
open('corpus-clean.txt', 'w').write('\n'.join(corpus))
print('book sentences', books, 'README sentences', len(books_and_readmes) - books, 'from', readmes, 'READMEs; docs', len(docs), 'doc titles', len(doc_titles), 'total', len(corpus))

# The texts Kilr is scored on (never fitted to): STS-B test and SICK test pairs, in order.
import csv
evtexts = []
for r in csv.reader(open('stsb-test.csv')):
    evtexts += [r[0], r[1]]
for i, line in enumerate(open('sick-test.txt')):
    if i:
        p = line.split('\t')
        evtexts += [p[1], p[2]]
json.dump(evtexts, open('eval-texts.json', 'w'))
