---
tags:
  - research
  - documentation
  - knowledge-library
aliases:
  - External Book Sources
  - EPUB Sources for Agents
cssclasses:
  - technical-guide
date: 2026-11-06
type: reference
---

# External Book Sources for Agent Work — What Applies Here

**Origin.** A 2026-11-06 survey (via Grok) of free EPUB sources to "feed
into LLMs to enhance project work" — Project Gutenberg, Standard Ebooks,
DOAB/OAPEN, OpenStax, Syncfusion, and the free AI/ML book lists — checked
against this repo. Most of it does not apply here, for structural reasons
worth recording once so they are not re-litigated per suggestion:

1. **Agents here lack project state, not general knowledge.** The
   measured bottlenecks are exact paths, values, and task state (see the
   starter-pack and consistency work). No external book supplies those.
2. **Public-domain classics are already in the models' training data.**
   RAG-feeding Gutenberg back to a model re-serves known material at
   retrieval cost. Fine for personal reading (Standard Ebooks is the
   quality pick), useless as an agent upgrade.
3. **Bulk ingestion dilutes the retrieval corpus.** `/api/retrieval`
   searches this project's docs. Generic textbook chunks compete with
   project-specific docs for the same top-k slots and lower precision.
   The corpus stays project material.

## The license rule (this repo is public)

"Free to read" is not "free to ingest." Anything extracted from an
external book that gets committed here is redistribution. Standing rule:
**only public-domain or CC-BY / CC-BY-SA material may be committed, and
the per-title license is checked on the title's own page at download
time.** Verified 2026-11-06:

| Title | License | What that permits here |
|---|---|---|
| *Think DSP* — Downey (Green Tea Press) | CC BY-NC 3.0 | Distill with attribution for personal/project use. **NC boundary:** derived material must not be commercialized. |
| *The Scientist and Engineer's Guide to DSP* — Smith | © author; full text free to read at dspguide.com | Read-only reference. Nothing committed but our own notes. |
| *Dive into Deep Learning* (d2l.ai) | Book CC BY-SA 4.0; code modified MIT | Genuinely open — but low fit: it teaches training models, which this studio rarely does. |
| *Deep Learning* — Goodfellow et al. (MIT Press) | CC BY-NC-ND (author-hosted edition) | Read online only. **ND = no derivatives** — a converted/ingested corpus is exactly what it forbids. |
| Murphy, *Probabilistic Machine Learning*; Hastie et al., *Elements of Statistical Learning* | Publisher ©; author-posted free PDFs | Read-only reference. |

## What actually earns a place

The pattern is **distill, don't dump** — the same one used for the
Remotion skills reference: one source, read for a specific gap, written
up as one knowledge doc in this library's own terms. Current candidates,
held until the gap is real:

- **Think DSP** — Python-first DSP (spectra, filters, convolution) that
  maps directly onto `audio-analysis` work. Distill when an analysis
  question outgrows the current docs.
- **DSP Guide (Smith)** — the practical companion to the same shelf;
  read online at need, cite in the distilled doc.

## Extraction recipe (proven on this machine)

If a permitted book is ever ingested, the pipeline is the one already
used to build the library EPUB archive, run in reverse:

```bash
pandoc book.epub -t gfm -o book.md        # EPUB -> markdown
# chunk on headings (## / ###), keep doc/section/token metadata per chunk
```

Calibre's `ebook-convert` is the fallback for malformed EPUBs. Source
quality decides extraction quality: prefer a born-digital EPUB over a
scan-derived one (Standard Ebooks over raw Gutenberg when both exist).

## Explicitly not doing

- No bulk Gutenberg/Standard Ebooks ingestion into `/api/retrieval`.
- No link-farm lists (awesome-*, freecomputerbooks) as sources of truth —
  they may *locate* a named title; the title's own page is the source.
- No account-gated "free" series (Syncfusion etc.) as corpus material.
