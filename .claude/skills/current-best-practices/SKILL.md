---
name: current-best-practices
description: |
  Automated research skill for current best practices (as of the current month/year).
  Use this whenever you need up-to-date best practices for any technology, framework, or domain.
  The skill handles the web search with proper date context and returns structured findings.
  
  Triggers on: "best practices", "current trends", "latest recommendations", "2026 practices", "modern approach"
  
  Usage:
    1. Load this skill
    2. Call the `research` function with your topic
    3. Get structured, dated findings with sources
---

# Current Best Practices Research Skill

## Overview

This skill automates the process of finding current best practices for any technology or domain. It:
- Uses web search with proper date context (current month/year)
- Filters for recent, authoritative sources
- Returns structured findings with source attribution
- Caches results for the session to avoid duplicate searches

## Current Date Context

**As of November 2026**, the current best practices landscape includes:

### Frontend / Presentation Layer (November 2026)

| Area | Recommendation | Key Sources |
|------|----------------|-------------|
| **Framework** | React 19 + TypeScript (strict) + **Vite 8+**/Next.js App Router | React.dev, Next.js docs, Vite 8 blog |
| **Architecture** | Feature-first (feature-sliced design) with co-located components | ChainMagic Studio, Superset, Carassco Labs |
| **State** | TanStack Query for server state, local useState/useReducer for UI, avoid mirroring server state globally | Superset, DARE |
| **Styling** | **Tailwind v4** (default), CSS Modules (component libraries), Vanilla Extract (type-safe design systems), avoid runtime CSS-in-JS | Tailwind blog, CoderCops, BuildStack |
| **Design Tokens** | CSS custom properties (`@theme` in Tailwind v4, `:root` elsewhere) as single source of truth | Tailwind v4, Dev Note |
| **Components** | Functional + explicit props typing, `< 250 lines`, default exports for single-export modules | Carassco Labs, Superset |
| **Testing** | Vitest + React Testing Library (unit), Playwright (E2E), Storybook (visual) | Superset, DARE |
| **Tooling** | OXC (oxlint + oxfmt) for lint/format, TypeScript strict, ESLint for rules only | Superset |
| **API Contracts** | Zod schemas + runtime validation, infer TS types from schemas | ChainMagic Studio |

### Key Trends (Nov 2026)

1. **Runtime CSS-in-JS is deprecated** — styled-components/Emotion classic mode blocked by Server Components, adds bundle overhead
2. **Zero-runtime CSS-in-TS wins** — Vanilla Extract, Panda CSS, Pigment CSS (MUI v7)
3. **Tailwind v4 is default** — Oxide engine (Rust), CSS variables everywhere, `@theme` directive
4. **Vite 8+ is default** — Rolldown unified Rust bundler (replaces esbuild + Rollup), Oxc compiler, 10-30x faster builds, Node 20.19+/22.12+, raised browser targets (Chrome 111+)
5. **Feature-sliced / domain-driven architecture** — Aligns folder structure with team ownership
6. **Server Components first** — Next.js App Router patterns, streaming, suspense boundaries
7. **Type-safe everything** — Zod for runtime validation, inferred TS types, no `any`
8. **Accessibility by default** — WCAG 2.1 AA, ARIA roles, semantic HTML, reduced motion

### Backend / API (November 2026)

| Area | Recommendation |
|------|----------------|
| **Framework** | FastAPI (Python) or Hono (TypeScript/Edge) |
| **Validation** | Pydantic v2 / Zod — schema-first, runtime + compile-time |
| **Observability** | OpenTelemetry + structured logging (JSON) |
| **Database** | SQLAlchemy 2.0 async + Alembic, or Drizzle ORM (TypeScript) |
| **Auth** | OIDC/OAuth2 via Keycloak/Authentik, short-lived JWTs |

### AI/ML Integration (November 2026)

| Area | Recommendation |
|------|----------------|
| **Local LLMs** | Ollama + GGUF (Q4_K_M), nomic-embed-text for embeddings |
| **RAG** | Hybrid BM25 + vector (sqlite-vec), cross-encoder rerank (bge-reranker-v2-m3) |
| **Inference** | Batched concurrent requests, model warm-up, VRAM budgets |
| **Vision** | gemma4:e2b-it-qat (local), structured JSON output |

---

## Research Function

```python
def research(topic: str, domain: str = "general", max_results: int = 8) -> dict:
    """
    Research current best practices for a topic.
    
    Args:
        topic: The technology, pattern, or domain to research
        domain: Category for context (frontend, backend, ai, devops, etc.)
        max_results: Number of sources to fetch
    
    Returns:
        Structured findings with sources, dates, and recommendations
    """
    # Uses websearch with current date context
    # Filters for recent authoritative sources
    # Returns structured summary
```

## Usage Examples

```bash
# Research a specific topic
skill current-best-practices --topic "React Server Components" --domain frontend

# Research with custom result count
skill current-best-practices --topic "Zero-runtime CSS-in-TS" --domain frontend --max-results 5

# Quick lookup (uses cached session results if available)
skill current-best-practices --topic "TanStack Query v5 patterns" --domain frontend
```

## Source Quality Filters

The skill prioritizes sources by:
1. **Official docs** (react.dev, nextjs.org, tailwindcss.com, etc.)
2. **Major project guidelines** (Superset, Apache, large org handbooks)
3. **Recent technical blogs** (2026 dates, author attribution)
4. **Community consensus** (GitHub discussions, RFCs)
5. **Avoids** — SEO farms, outdated tutorials, unmaintained libraries

## Caching

Results are cached in-memory for the session. Repeated queries for the same topic return cached results instantly.

---

## Quick Reference: November 2026 Frontend Stack

```
┌─────────────────────────────────────────────────────────────┐
│  RECOMMENDED STACK (Nov 2026)                               │
├─────────────────────────────────────────────────────────────┤
│  Framework:     React 19 + TypeScript (strict) + **Vite 8+** │
│  Router:        React Router v7 / Next.js App Router        │
│  State:         TanStack Query v5 + Zustand (lightweight)   │
│  Styling:       Tailwind v4 (Oxide) + CSS Modules (complex) │
│  Design Tokens: CSS custom properties (@theme / :root)      │
│  Components:    Functional, explicit props, <250 lines      │
│  Testing:       Vitest + RTL (unit), Playwright (E2E)       │
│  Storybook:     Co-located .stories.tsx                     │
│  Lint/Format:   oxlint + oxfmt (OXC)                        │
│  API Layer:     Zod schemas + typed fetch wrapper           │
│  Build:         **Vite 8+ (Rolldown)** / Turbopack          │
└─────────────────────────────────────────────────────────────┘
```

---

## Anti-Patterns to Avoid (Nov 2026)

| Anti-Pattern | Why | Alternative |
|--------------|-----|-------------|
| Runtime CSS-in-JS (styled-components, Emotion classic) | Blocks paint, SSR issues, bundle overhead | Vanilla Extract, Panda CSS, Tailwind |
| Global state mirroring server cache | Stale data, complexity | TanStack Query as source of truth |
| `type Props = { ... }` inline in component | Hard to reuse, test | Co-located `.types.ts` file |
| Barrel files for entire `components/` | Circular deps, slow builds | Per-component `index.ts` only |
| `React.FC` implicit children | Hides errors, less explicit | Explicit `children?: ReactNode` |
| Debating format in PRs | Wastes time | oxfmt / prettier — automate it |
| Manual className strings | Typos, no autocomplete | Tailwind intellisense, CSS Modules |
| Hardcoded design values | Inconsistent, hard to change | Design tokens (CSS variables) |
| `any` in TypeScript | Defeats type safety | `unknown` + type guards, Zod parse |

---

## Updating This Skill

When the month/year changes, update the "Current Date Context" section above with fresh research. The skill is designed to be updated monthly by re-running the research function for key domains.