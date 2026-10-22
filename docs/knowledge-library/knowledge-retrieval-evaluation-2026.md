---
tags:
  - research
  - technical
  - documentation
aliases:
  - Knowledge Retrieval Evaluation
  - RAG Evaluation
  - Retrieval Findings
cssclasses:
  - research-guide
date: 2026-10-22
type: source
---

# 🔎 Knowledge Retrieval — Measured Findings

> [!info] Purpose
> What the retrieval stack over this knowledge library actually does, measured
> rather than assumed. Produced by `tools/kb-eval.py` against the written
> question set in `kb-eval-questions.json`.
>
> This exists because the 2026 literature says retrieval is the bottleneck and
> the default answer — "add a vector database" — is not what the numbers
> support.

---

## 1. The measurement

**60 written questions**, one per document, each with a quoted answer fact.
The questions were written by the local LLM from one document's text and
paraphrased rather than copied, so the query is not a near-duplicate of the
answer. That matters: a cloze probe derives its query from the answer's own
sentence, which saturates lexical retrieval and hands dense retrieval a bag of
keywords instead of a question.

Retrievers compared, all over the same 1,749 chunks:

| Configuration | What it does |
|---|---|
| `child` | BM25 over small chunks, return small chunks |
| `parent` | BM25 over parent sections, return parent sections |
| `parent_child` | BM25 over small chunks, return their parents |
| `doc` | BM25 over small chunks, return the whole document |
| `dense` | `nomic-embed-text:v1.5` embeddings only, semantic |
| `hybrid` | BM25 + dense, fused with Reciprocal Rank Fusion |
| `hybrid_score` | BM25 + dense, fused by min-max normalised score |
| `hyde` | BM25 over an LLM-written hypothetical answer |

The embedding model is the studio's own `nomic-embed-text:v1.5` (137M,
8192-token context, open weights/code/data), with the task prefixes nomic
requires — `search_document: ` and `search_query: `.

**Read `passage` as a lower bound.** An LLM-written answer fact is a
paraphrase of the source, so a literal string match under-reports: of the 60
facts, 37 (62%) appear verbatim in their source document and 23 (38%) are
paraphrases of it; **none** are unfindable. `doc@5` — the right *document*
retrieved — is the metric with a clean ground truth.

---

## 2. The results

Baseline, k=5, 400-token chunks:

| Configuration | passage | doc@5 | MRR | context |
|---|---|---|---|---|
| `child` (BM25) | 41.7% | 85.0% | 0.764 | 760 tok |
| `parent` | 40.0% | 83.3% | 0.763 | 726 tok |
| `parent_child` | 41.7% | 85.0% | 0.764 | 801 tok |
| `doc` (whole document) | 55.0% | 85.0% | 0.764 | **16,756 tok** |
| `dense` (nomic) | 41.7% | 83.3% | 0.706 | 967 tok |
| **`hybrid` (RRF)** | **48.3%** | **90.0%** | 0.757 | 843 tok |
| `hybrid_score` | 45.0% | 86.7% | 0.780 | 828 tok |

### With the two index-time enrichments

Heading-path prefix (free) and contextual document summaries (one LLM call
per document, cached) both help:

| Configuration | passage | doc@5 | MRR | context |
|---|---|---|---|---|
| `child` (BM25) | 46.7% | 88.3% | 0.812 | 1,547 tok |
| `parent` | 46.7% | 88.3% | 0.821 | 1,527 tok |
| `parent_child` | 46.7% | 88.3% | 0.812 | 1,749 tok |
| `doc` (whole document) | 56.7% | 88.3% | 0.812 | 8,418 tok |
| `dense` (nomic) | 41.7% | 76.7% | 0.705 | 1,612 tok |
| **`hybrid` (RRF)** | **51.7%** | **93.3%** | **0.853** | 1,564 tok |
| `hybrid_score` | 50.0% | 88.3% | 0.840 | 1,589 tok |

Contextual retrieval lifts every configuration except dense: `hybrid` goes
from 90.0% to **93.3%** doc@5 and from MRR 0.757 to **0.853**, for 843 →
1,564 tokens. The cost is the summary prepended to every chunk.

---

## 3. What the numbers say

### Dense alone does not beat lexical on this corpus
`dense` gets doc@5 83.3% against BM25's 85.0%, and a lower MRR. This
matches the literature on documents with precise terminology: lexical
matching catches exact identifiers, metric labels and version numbers that
embeddings dilute (arXiv:2604.01733, Apr 2026). A corpus of technical
articles full of "sm_61", "Pascal", "8 GB" and "T5-XXL" is exactly that
shape. The larger study reaches the same conclusion at 511,959 documents
(arXiv:2607.26497, Jul 2026): dense retrieval stays below BM25.

### Hybrid is the right answer, and the reason is specific
`hybrid` reaches doc@5 **90.0%** against BM25's 85.0% and dense's 83.3%,
and passage 48.3% against 41.7%. The complementarity is real: BM25 catches
the exact terms, dense rescues the paraphrased question. The published
numbers point the same way — hybrid fusion beats both single-stage methods
(arXiv:2604.01733). Where the two retrievers agree, the fused ranking
puts the document first; where they disagree, the fusion breaks the tie by
rank rather than by an incomparable score.

**Rank fusion beats score fusion here.** RRF wins recall (90.0% vs 86.7%
doc@5); score fusion wins MRR slightly (0.780 vs 0.757). RRF stays the
default.

### Parent-child retrieval is not worth it on this corpus
`parent_child` is identical to `child` on every metric and costs 5% more
tokens. The reason is measurable: **the answer passage is present whenever
the right document is retrieved**, so the loss is in retrieval, not in chunk
granularity. Returning the whole document instead of chunks lifts passage
from 41.7% to 55.0% — and costs **16,756 tokens, 22× the chunked
context**. Granularity is not the problem; the ranking is.

### The chunk target is the wrong knob
Sweeping 200, 400, 800 and 1200 tokens gives identical passage recall at
fixed k (40.0% at k=3, 41.7% at k=5 for every target). The chunk count
barely moves (1,997 → 1,702) because most sections are already under 400
tokens. **How many chunks you retrieve is the lever** — k=3 gives 80.0%
doc@5, k=5 gives 85.0%, k=8 gives 88.3%.

### Contextual retrieval is the one augmentation that pays
Prepending an LLM-written summary of the source document to each of its
chunks lifts every configuration except dense. A chunk that says "it
supports 8 GB" becomes matchable to a question about the model it belongs
to, because the summary carries the model. `hybrid` goes 90.0% → **93.3%**
doc@5 and MRR 0.757 → **0.853**. The cost is the summary in every chunk:
843 → 1,564 tokens.

### The remaining gap
The right document is found 93% of the time, but the answer fact is in the
returned context only 52% of the time (and at most ~93% counting
paraphrases). The answer is usually in *another section* of the right
document. Neither more chunks nor bigger chunks nor the whole document
closes it — which is a **reranking** problem, not a chunking or a
retrieval problem. No cross-encoder is installed here, and the literature
is split on whether one helps: a cross-encoder on top of hybrid is the
best single pipeline in one benchmark (Recall@5 0.816 against 0.695) but
*regressed* in another, where BM25's near-misses in the pool biased the
reranker (arXiv:2604.01733; the rag-eval experiment, Apr 2026). It needs
measuring here, not assuming.

---

## 4. Recommended configuration

```bash
# Index: 200-token chunks, heading-path enriched, contextual summaries added
# Retrieve: hybrid (BM25 + nomic dense, RRF), k=8
```

- **Chunk target 200.** Cheaper, and the sweep shows the target barely
  matters — so take the small one.
- **Enrich with the heading path.** Free, and measured: it lifts hybrid
  MRR from 0.757 to 0.797 on its own.
- **Add contextual summaries.** One LLM call per document, cached. Lifts
  hybrid doc@5 from 90.0% to 93.3% and MRR to 0.853, at 2× the context
  tokens. Worth it if the context budget allows; skip it if not — the
  gain is real but not the difference between working and not.
- **Retrieve with hybrid RRF, k=8.** The only lever that moves recall.
- **Do not use parent-child** unless the corpus changes shape.
- **Do not return whole documents** — 22× the tokens for 6 points.

---

## 5. Reproducing

```bash
python tools/kb-eval.py --questions docs/knowledge-library/kb-eval-questions.json --dense
python tools/kb-eval.py --questions docs/knowledge-library/kb-eval-questions.json --enrich --dense
python tools/kb-eval.py --questions docs/knowledge-library/kb-eval-questions.json --sweep
python tools/kb-eval.py --generate-questions     # rewrite the question set
```

`tools/kb-retrieval.py` is the serving side: BM25, the dense index, RRF
fusion, and the chunk enrichments.

---

## 6. Sources

- arXiv:2604.01733 (Apr 2026) — *From BM25 to Corrective RAG: Benchmarking
  Retrieval Strategies for Text-and-Table Documents*. Hybrid + reranking
  dominates; BM25 beats dense on precise terminology; HyDE and CRAG give
  limited benefit; contextual retrieval gives consistent gains.
- arXiv:2607.26497 (Jul 2026) — *BM25 Wins at Scale*. A scale-dependent
  crossover, not an unconditional win; dense stays below BM25; graph RAG
  hits a construction ceiling.
- arXiv:2601.14123 (Jan 2026) — *A Systematic Analysis of Chunking
  Strategies*. The context cliff at ~2,500 tokens; avoid overlap; sentence
  chunking is most cost-effective.
- arXiv:2603.23533 (Mar 2026) — *MDKeyChunker*. Structure-aware chunking
  of headers, code blocks and tables; BM25 over structural chunks is strong.
- SemEval-2026 Task 8 (Jun 2026) — HyDE improves BM25 by 26.7% but dense
  by only 4.0%; hybrid gives complementary signals.
- arXiv:2402.01613 — *Nomic Embed*. The 8192-context embedder used here.
