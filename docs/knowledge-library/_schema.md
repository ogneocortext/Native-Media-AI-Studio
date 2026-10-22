---
tags:
  - technical
  - documentation
  - knowledge-library
aliases:
  - Knowledge Library Schema
  - KB Schema
  - Vault Conventions
cssclasses:
  - documentation-guide
date: 2026-10-21
type: tracker
---

# 🗺️ Knowledge Library Schema

> [!info] Purpose
> Constitution for the Native Media AI Studio knowledge library. Defines the
> frontmatter schema, page types, typed wiki-link relations, and health rules
> that keep the vault machine-readable for AI agents. Every new document should
> follow this schema; existing documents are migrated on touch.

---

## 1. Frontmatter Schema

Every library document requires a YAML frontmatter block:

| Field | Required | Values / Notes |
|-------|----------|----------------|
| `tags` | Yes | First entry is a primary category (`production`, `technical`, `platform`, `creative`, `performance`, `ai`, `research`). Follow with 0–4 cross-cutting tags. |
| `aliases` | Yes | Human-readable display names for wiki-link resolution. |
| `cssclasses` | Yes | Styling class for the docs UI. |
| `date` | Yes | ISO 8601 date (`YYYY-MM-DD`) of last meaningful update. |
| `type` | Recommended | Page type (see §2). Not yet enforced as required — existing docs are migrated on touch. |

Example:

```yaml
---
tags:
  - technical
  - platform-comfyui
aliases:
  - ComfyUI Workflow Guide
cssclasses:
  - technical-guide
date: 2026-10-21
type: entity
---
```

---

## 2. Page Types (`type`)

| Type | Purpose | Example |
|------|---------|---------|
| `concept` | Abstract domain knowledge, definitions, frameworks | "tempo octave error", "beat tracking" |
| `entity` | Concrete product, tool, service with facts/data | "Ollama", "ComfyUI", "GTX 1070 Ti" |
| `source` | Structured summary of external material (paper, article, report) | ISMIR 2018 tempo estimation paper |
| `comparison` | Side-by-side analysis of two+ entities | madmom vs librosa beat backends |
| `synthesis` | Cross-cutting analysis across notes, concepts, sources | "audio-reactive signal stack" |
| `tracker` | Progress / status / migration documents | migration-progress.md |
| `index` | Hub / catalog documents | index.md |

The `type` field lets agents route queries: "show me all `concept` pages about audio" or "which `entity` pages describe hardware constraints?"

---

## 3. Typed Wiki-Links

Plain `[[slug]]` links are navigation. Typed links add semantic weight for graph traversal:

| Relation | Meaning | Traversal weight |
|----------|---------|------------------|
| `[[slug]]:cites` | This doc references that source | 4 (strong) |
| `[[slug]]:extends` | Builds on / supersedes that concept | 3 |
| `[[slug]]:implements` | Concrete realization of that concept | 3 |
| `[[slug]]:compares-to` | Contrasts with another entity | 2 |
| `[[slug]]:part-of` | Belongs to a section or series | 2 |
| `[[slug]]:see-also` | Related, non-hierarchical | 1 |

Usage: `[[tempo-estimation-octave-errors-2026]]:cites` or `[[comfyui-workflows]]:implements`.

Untyped `[[slug]]` defaults to `:see-also`. Agents should prefer typed links when the relationship is clear.

---

## 4. File Naming

- `kebab-case` filenames (lowercase, hyphens, `.md` extension).
- No spaces, no PascalCase, no Chinese characters in filenames.
- Year-suffixed names for time-boxed research (e.g. `*-2026.md`).
- Meta-files start with underscore: `_schema.md`, `log.md`.

---

## 5. Special Files

| File | Role |
|------|------|
| `index.md` | Master catalog, organized by primary category. Updated on every add/remove. |
| `_schema.md` | This document — conventions and rules. |
| `log.md` | Append-only operations log, ISO 8601 date headings. |
| `migration-progress.md` | Tag-migration tracker (enforced by `validate-knowledge-tags.py`). |
| `tagging-guide.md` | Tag taxonomy and selection rules. |

---

## 6. Health Rules (enforced by `tools/validate-knowledge-tags.py`)

1. **No orphan pages** — every document (except `index.md`) must have at least one inbound `[[wiki-link]]` from another document.
2. **No dangling links** — every `[[slug]]` must resolve to an existing file.
3. **No duplicate basenames** — wiki-links resolve by basename; two `foo.md` files make `[[foo]]` ambiguous.
4. **Primary tag first** — the first `tags` entry must be one of the seven primary categories.
5. **Tracker/index sync** — `migration-progress.md` and `index.md` must list every document exactly once with correct counts.
6. **No index gaps** — every `[[slug]]` in `index.md` must resolve to a real document.

Run `python tools/validate-knowledge-tags.py` before committing any change to this directory.

---

## 6a. Tooling

Six tools maintain the vault. They share one link parser
(`tools/_kb_links.py`) and one token counter (`tools/_kb_tokens.py`), so
they cannot disagree about how a link is spelled or how long a document
is.

| Tool | What it does |
|------|--------------|
| `tools/validate-knowledge-tags.py` | The gate. Frontmatter, taxonomy, tracker/index sync, orphans, dangling links, index gaps. Exits non-zero on a problem. |
| `tools/kb-add.py` | Scaffolds a new document: frontmatter, auto-linked related documents, registration in `index.md` / `migration-progress.md` / `log.md`, then validation. Implements §7 below. |
| `tools/kb-graph.py` | The link graph: `outline`, `graph` (DOT), `orphans`, `dangling`, `typed`, `untyped`, `suggest`, `apply` (with `--dry-run`), and `audit`. |
| `tools/kb-context.py` | Exports the vault as agent context: `text`, `json`, `paths`, `summary`, `index`, with `--category` / `--type` / `--tag` / `--file` filters, `--neighborhood`, `--limit` and `--budget`. |
| `tools/kb-tokens.py` | Token accounting and context-window sizing: how big the library is, for which model, and which models can hold it. |
| `tools/kb-chunk.py` | Structure-aware chunking: headings first, code fences and tables atomic, sentences never split, no overlap by default. Emits a JSONL chunk index. |

**`kb-context.py --format index` is the entry point for an agent.** It
prints a routing table — title, type, category, tags and an estimated token
cost per document — so the agent can decide what to fetch instead of loading
everything. One level of routing is enough; a second level never helps
(He et al., *Is Progressive Disclosure All You Need for Long-Context
Agents?*, arXiv:2607.17598, 2026). Fetch a document with
`--file <name>.md`.

**`kb-graph.py --mode audit`** groups findings by severity, following the
LLM-wiki lint convention: **fix** (broken links), **improve** (quality
gaps: orphans, missing typed relations, one-way links), **explore**
(referenced but unwritten pages).

### Sizing the library against a context window

"Tokens" are a property of a *model's tokenizer*, not of text: the same
corpus measures 0.9–1.2 tokens per character across vendors, a 35% spread
(arXiv:2605.02173, 2026). So the tools count exactly when a local
tokenizer is available (the studio has one for `gemma-4-e2b-it`, its own
model) and estimate transparently when it is not — and `kb-tokens.py
--format models` reports **each local model with its own tokenizer**,
because one number cannot serve every model.

```bash
python tools/kb-tokens.py                  # totals, per category and type
python tools/kb-tokens.py --format models  # per-model sizing, live context windows
python tools/kb-chunk.py --format stats    # the chunking plan
```

Measured on this vault: **329,670 tokens** under gemma-4's tokenizer
(3.57 chars/token), **309,464** under Qwen3's (3.80), **301,683** by
estimate (3.90) — a 9.2% spread on identical text. The library fits the
three 1M-window cloud models and **none** of the local ones: `qwen3.5:9b`
(262,144) needs 1.18×, `gemma4:e2b-it-qat` (131,072) needs 2.52×,
`minicpm-v:8b` (32,768) needs 9.21×.

A context window is a ceiling, not a working size. Quality falls off a
"context cliff" past roughly 2,500 tokens of retrieved context even on a
1M-window model (arXiv:2601.14123, 2026), and a single chunk above ~8,000
tokens is noise even on a 200K model. So "load the whole library in one
prompt" is the wrong target — route to it, then fetch a small, well-formed
piece. `kb-chunk.py` produces those pieces; `kb-context.py --format index`
produces the routing table.

---

## 7. Adding a New Document

The manual procedure:

1. Create `kebab-case.md` with full frontmatter (tags, aliases, cssclasses, date, type).
2. Add at least two typed wiki-links from related existing documents (avoid orphans).
3. Add the document to `migration-progress.md` under its primary category.
4. Add the document to `index.md` under its primary category.
5. Update tag counts in `index.md`'s Tags Index.
6. Append an entry to `log.md` with an ISO 8601 date heading.
7. Run `python tools/validate-knowledge-tags.py` to verify.

`tools/kb-add.py` does all seven:

```bash
python tools/kb-add.py --title "My New Doc" --category technical --type entity \
  --alias "My New Doc" --cross-tag testing
```

It writes the frontmatter, finds and links the related documents (with a
relation type inferred from the page types), inserts the back-links so the
new page is not an orphan, registers it in all three bookkeeping files, and
runs the validator.

---

_Conventions adapted from the LLM Wiki pattern (Karpathy) and Google Cloud's Open Knowledge Format (OKF v0.1, 2026-06)._
