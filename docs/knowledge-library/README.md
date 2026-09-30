# 📚 Knowledge Library

> [!info] AI-First Knowledge Base
> This library is designed for both human creators and AI agents to produce compelling music videos for YouTube.

## Quick Start

### For Humans (Obsidian)

1. Download [Obsidian](https://obsidian.md)
2. Open this folder as a vault: `docs/knowledge-library/`
3. Start with [[index]] for navigation
4. Use Graph View to visualize connections

### For AI Agents

1. Read `index.md` for the full structure
2. All documents are plain markdown with YAML frontmatter
3. Use `[[wiki-links]]` for cross-references
4. Return to update knowledge as new techniques are discovered

When adding a document, follow `tagging-guide.md`: give it a primary category as
the **first** tag, then 2-4 cross-cutting tags from the tables there. Run
`python tools/validate-knowledge-tags.py` before committing - a pre-commit hook
does this for you once `bash scripts/install-git-hooks.sh` has been run (see D10
in the decision log; there is no CI for this repo).

## Vault Structure

```
knowledge-library/
├── .obsidian/              ← Obsidian configuration (gitignored)
├── index.md                ← Start here (77 docs indexed, reorganized 2026-09-29)
├── tagging-guide.md        ← Hierarchical tagging system (2026-09-29)
├── migration-progress.md   ← Tag migration record (2026-09-29)
├── README.md               ← This file
├── music-video-production.md
├── youtube-optimization.md
├── technical-reference.md  ← Architecture + API + GPU (2026-09-05)
├── comfyui-workflows.md
├── blender-mcp.md
├── hunyuan3d-setup.md
├── three-js-studio.md
├── 3d-rendering.md
├── visualization-effects.md
├── 2d-visualization-2026.md
├── audio-reactive-production.md
├── silhouette-character-animation.md
├── character-driven-visualization-research.md
├── hardware-verified-models.md
├── prompt-engineering.md
├── integration-ollama.md
├── ai-agent-navigation.md
├── backend-debugging-guide.md
├── ollama-benchmarks.md / coding-benchmarks.md / ollama-thinking-structured-outputs.md
├── kilo-code-subagent-*.md
├── remotion-guide.md / ai-video-trends-2026.md
├── codebase.json / api-registry.json / mcp-registry.json / prompts.json / agent.manifest.json
└── Knowledge Graph.canvas  ← Visual overview
```

### Logical Organization (2026-09-29)

The library is now organized into 7 logical categories (see `index.md`):

1. **🎬 Production Pipeline** — Workflow & creative guides (10 docs)
2. **🛠️ Technical Implementation** — Code & systems (13 docs)
3. **🎮 MCP & Platform Integrations** — Platform-specific tools (11 docs)
4. **🎨 Creative & Visual** — Design & effects (17 docs)
5. **⚙️ Performance & Hardware** — Optimization (7 docs)
6. **🤖 AI & ML** — Models & training (11 docs)
7. **📊 Research & Reference** — Industry analysis (8 docs)

See [[tagging-guide]] for the new hierarchical tagging system.

## Key Features

- **YAML Frontmatter** — Tags, aliases, dates for machine readability
- **Wiki-Links** — `[[document-name]]` for cross-referencing
- **Callouts** — `> [!tip]`, `> [!warning]`, `> [!info]` for visual emphasis
- **Mermaid Diagrams** — Flowcharts and graphs
- **Canvas** — Visual knowledge graph

## Maintenance

This library is a living document. Update when:

- New features are added to the pipeline
- New models or tools are integrated
- YouTube platform requirements change
- New research on AI music video production emerges

### Tagging System (2026-09-29)

The library now uses a hierarchical tagging system. See [[tagging-guide]] for:

- Primary category tags (`#production/*`, `#technical/*`, etc.)
- Cross-cutting tags (`#platform-youtube`, `#hardware-8gb`, etc.)
- Tagging rules and examples
- Migration checklist for existing documents

---

_Part of [[Native Media AI Studio]]_
