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

## The redistribution rule (owner policy)

**No external book text is committed to this repo — in any form, under
any license.** Not excerpts, not converted EPUBs, not chunked corpora.
This is stricter than the law requires (public-domain and CC-BY text
could legally be committed); it is a policy choice, not merely a legal
one, and it holds regardless of how permissive a title's license is.

The only sanctioned flow is:

1. **Private study** — read the source; any text extraction stays
   local and uncommitted (see the recipe below).
2. **Application** — what the source taught lands as *code changes*,
   and/or as a **distilled knowledge doc written in this project's own
   words**: facts, methods, and decisions, expressed as instructions to
   this codebase — none of the source's text, structure, or phrasing.

Licenses are still checked on the title's own page at download time,
because they bound private use and any future commercialization of the
work (the NC case below). Verified 2026-11-06:

| Title | License | Posture here |
|---|---|---|
| *Think DSP* — Downey (Green Tea Press) | CC BY-NC 3.0 | Private study; distilled code/docs only. **NC boundary:** if derived work is ever commercialized, this title is out. |
| *The Scientist and Engineer's Guide to DSP* — Smith | © author; full text free to read at dspguide.com | Read-only reference; distilled output only. |
| *Dive into Deep Learning* (d2l.ai) | Book CC BY-SA 4.0; code modified MIT | The license would permit more; repo policy doesn't use it. Also low fit: it teaches training models, which this studio rarely does. |
| *Deep Learning* — Goodfellow et al. (MIT Press) | CC BY-NC-ND (author-hosted edition) | Read online only; ND independently forbids derivative corpora. |
| Murphy, *Probabilistic Machine Learning*; Hastie et al., *Elements of Statistical Learning* | Publisher ©; author-posted free PDFs | Read-only reference; distilled output only. |

## What actually earns a place

The pattern is **distill, don't dump** — the same one used for the
Remotion skills reference: one source, read for a specific gap, and the
output is code changes plus a knowledge doc written from understanding,
in this project's own words. These docs are an instruction set to the
codebase, not a vessel for anyone else's text. Current candidates, held
until the gap is real:

- **Think DSP** — Python-first DSP (spectra, filters, convolution) that
  maps directly onto `audio-analysis` work. Distill when an analysis
  question outgrows the current docs.
- **DSP Guide (Smith)** — the practical companion to the same shelf;
  read online at need, cite in the distilled doc.

## Extraction recipe — for private study only (proven on this machine)

When a source needs close study, extract it locally with the same
toolchain that builds the library EPUB archive, run in reverse:

```bash
pandoc book.epub -t gfm -o book.md        # EPUB -> markdown
# chunk on headings (## / ###) for study and note-taking
```

The extraction lives **outside this repo** (local scratch) and is never
committed; only the distilled output of the flow above lands here.
Calibre's `ebook-convert` is the fallback for malformed EPUBs. Source
quality decides extraction quality: prefer a born-digital EPUB over a
scan-derived one (Standard Ebooks over raw Gutenberg when both exist).

## Explicitly not doing

- No bulk Gutenberg/Standard Ebooks ingestion into `/api/retrieval`.
- No link-farm lists (awesome-*, freecomputerbooks) as sources of truth —
  they may *locate* a named title; the title's own page is the source.
- No account-gated "free" series (Syncfusion etc.) as corpus material.
