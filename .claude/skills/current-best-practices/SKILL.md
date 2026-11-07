---
name: current-best-practices
description: |
  Automated research skill for current best practices (as of the current month/year).
  Use this whenever you need up-to-date best practices for any technology, framework, or domain.
  The skill handles the web search with proper date context and returns structured findings.
  
  Triggers on: "best practices", "current trends", "latest recommendations", "2026 practices", "modern approach"
  
  Usage:
    1. Load this skill
    2. Call the `research` function with your topic and domain
    3. Get structured, dated findings with sources
---

# Current Best Practices Research Skill

## Overview

This skill automates the process of finding current best practices for any technology or domain. It:
- Uses web search with proper date context (current month/year)
- Filters for recent, authoritative sources
- Returns structured findings with source attribution
- Caches results for the session to avoid duplicate searches

**Important**: This skill documents the research methodology. The actual web searches are performed by the agent using the `websearch` tool with the queries and filters provided here. The `research.py` helper generates optimized search queries.

## Current Date Context

**As of {{CURRENT_MONTH}} {{CURRENT_YEAR}}**, the current best practices landscape includes:

> **Note**: The date context above should be replaced with the actual current month/year when the skill is loaded. The `get_current_context()` function in `__init__.py` returns the live date.

### Frontend / Presentation Layer

| Area | Recommendation | Key Sources |
|------|----------------|-------------|
| **Framework** | React 19 + TypeScript (strict) + **Vite 8+**/Next.js App Router | React.dev, Next.js docs, Vite blog |
| **Architecture** | Feature-first (feature-sliced design) with co-located components | Feature-Sliced Design methodology, large org handbooks |
| **State** | TanStack Query v5 for server state, local useState/useReducer for UI, avoid mirroring server state globally | TanStack Query docs, React docs |
| **Styling** | **Tailwind v4** (default), CSS Modules (component libraries), Vanilla Extract (type-safe design systems), avoid runtime CSS-in-JS | Tailwind blog, Vanilla Extract docs |
| **Design Tokens** | CSS custom properties (`@theme` in Tailwind v4, `:root` elsewhere) as single source of truth | Tailwind v4 docs, CSS Custom Properties spec |
| **Components** | Functional + explicit props typing, `< 250 lines`, default exports for single-export modules | React docs, large org style guides |
| **Testing** | Vitest + React Testing Library (unit), Playwright (E2E), Storybook (visual) | Vitest docs, Playwright docs |
| **Tooling** | OXC (oxlint + oxfmt) for lint/format, TypeScript strict, ESLint for rules only | OXC repo, TypeScript handbook |
| **API Contracts** | Zod schemas + runtime validation, infer TS types from schemas | Zod docs, TanStack Query docs |

### Key Trends (Current)

1. **Runtime CSS-in-JS is deprecated** — styled-components/Emotion classic mode blocked by Server Components, adds bundle overhead
2. **Zero-runtime CSS-in-TS wins** — Vanilla Extract, Panda CSS, Pigment CSS (MUI v7)
3. **Tailwind v4 is default** — Oxide engine (Rust), CSS variables everywhere, `@theme` directive
4. **Vite 8+ is default** — Rolldown unified Rust bundler (replaces esbuild + Rollup), Oxc compiler, 10-30x faster builds, Node 20.19+/22.12+, raised browser targets (Chrome 111+)
5. **Feature-sliced / domain-driven architecture** — Aligns folder structure with team ownership
6. **Server Components first** — Next.js App Router patterns, streaming, suspense boundaries
7. **Type-safe everything** — Zod for runtime validation, inferred TS types, no `any`
8. **Accessibility by default** — WCAG 2.1 AA, ARIA roles, semantic HTML, reduced motion

### Backend / API

| Area | Recommendation |
|------|----------------|
| **Framework** | FastAPI (Python) or Hono (TypeScript/Edge) |
| **Validation** | Pydantic v2 / Zod — schema-first, runtime + compile-time |
| **Observability** | OpenTelemetry + structured logging (JSON) |
| **Database** | SQLAlchemy 2.0 async + Alembic, or Drizzle ORM (TypeScript) |
| **Auth** | OIDC/OAuth2 via Keycloak/Authentik, short-lived JWTs |

### AI/ML Integration

| Area | Recommendation |
|------|----------------|
| **Local LLMs** | Ollama + GGUF (Q4_K_M), nomic-embed-text:v1.5 for embeddings |
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
    
    Note: This function generates optimized search queries. 
    The agent should execute these queries via the `websearch` tool
    and then process results through `format_findings()`.
    """
    # 1. Get current context via get_current_context()
    # 2. Build queries via build_search_queries(topic, domain)
    # 3. Execute each query via websearch tool
    # 4. Process results through format_findings()
    # 5. Return structured findings
```

---

## Usage (Agent Workflow)

```python
# In agent code:
from skills.current_best_practices import get_current_context, get_domain_queries, build_search_queries, format_findings

# 1. Get current context
context = get_current_context()  # {"year": 2026, "month": 11, "month_name": "November", "date_string": "November 2026"}

# 2. Build queries for topic
queries = build_search_queries("React Server Components", "frontend")
# Returns: ["React Server Components best practices 2026 november", ...]

# 3. Execute via websearch tool (agent does this)
# results = await websearch({"query": queries[0], "numResults": 8})

# 4. Format findings
# findings = format_findings("React Server Components", "frontend", raw_results)
```

---

## Query Templates by Domain

The `build_search_queries()` function uses these templates:

| Domain | Templates |
|--------|-----------|
| **frontend** | `"{topic} best practices {year} {month}"`, `"{topic} modern patterns {year}"`, `"{topic} architecture {year} TypeScript React"` |
| **backend** | `"{topic} best practices {year} {month}"`, `"{topic} architecture {year} Python FastAPI"`, `"{topic} patterns {year} async"` |
| **ai** | `"{topic} best practices {year} {month} local LLM"`, `"{topic} patterns {year} Ollama RAG"`, `"{topic} implementation {year} embeddings"` |
| **devops** | `"{topic} best practices {year} {month} CI/CD"`, `"{topic} patterns {year} Kubernetes Docker"`, `"{topic} observability {year} OpenTelemetry"` |
| **general** | `"{topic} best practices {year} {month}"`, `"{topic} modern approach {year}"`, `"{topic} recommendations {year}"` |

---

## Source Quality Filters

The `format_findings()` function prioritizes sources by:

1. **Official docs** — react.dev, nextjs.org, tailwindcss.com, vite.dev, fastapi.tiangolo.com, pydantic.dev, tanstack.com, playwright.dev, vitest.dev, storybook.js.org, zod.dev
2. **Major project guidelines** — github.com/vercel, github.com/facebook/react, github.com/tailwindlabs, superset.apache.org
3. **Authoritative technical blogs** — web.dev, kentcdodds.com, epicweb.dev, joshwcomeau.com (with 2026 dates)
4. **Community consensus** — GitHub discussions, RFCs, official RFC repos
5. **Avoids** — dev.to, css-tricks.com, medium.com, SEO farms, outdated tutorials, unmaintained libraries

---

## Caching

Results are cached in-memory for the session. Repeated queries for the same topic return cached results instantly.

---

## Quick Reference: Current Frontend Stack

```
┌─────────────────────────────────────────────────────────────┐
│  RECOMMENDED STACK (Current)                                │
├─────────────────────────────────────────────────────────────┤
│  Framework:     React 19 + TypeScript (strict) + Vite 8+    │
│  Router:        React Router v7 / Next.js App Router        │
│  State:         TanStack Query v5 + Zustand (lightweight)   │
│  Styling:       Tailwind v4 (Oxide) + CSS Modules (complex) │
│  Design Tokens: CSS custom properties (@theme / :root)      │
│  Components:    Functional, explicit props, <250 lines      │
│  Testing:       Vitest + RTL (unit), Playwright (E2E)       │
│  Storybook:     Co-located .stories.tsx                     │
│  Lint/Format:   oxlint + oxfmt (OXC)                        │
│  API Layer:     Zod schemas + typed fetch wrapper           │
│  Build:         Vite 8+ (Rolldown) / Turbopack              │
└─────────────────────────────────────────────────────────────┘
```

---

## Anti-Patterns to Avoid

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

When the month/year changes, the skill automatically uses the current date via `get_current_context()`. The trend tables above should be reviewed quarterly and updated by re-running the research process for key domains.

> **Important**: The trend data in this document reflects the state as of the last manual update. Always verify critical decisions with fresh research using the `research()` workflow above.