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

Run `python tools/validate-knowledge-tags.py` before committing any change to this directory.

---

## 7. Adding a New Document

1. Create `kebab-case.md` with full frontmatter (tags, aliases, cssclasses, date, type).
2. Add at least two typed wiki-links from related existing documents (avoid orphans).
3. Add the document to `migration-progress.md` under its primary category.
4. Add the document to `index.md` under its primary category.
5. Update tag counts in `index.md`'s Tags Index.
6. Append an entry to `log.md` with an ISO 8601 date heading.
7. Run `python tools/validate-knowledge-tags.py` to verify.

---

_Conventions adapted from the LLM Wiki pattern (Karpathy) and Google Cloud's Open Knowledge Format (OKF v0.1, 2026-06)._
