---
tags:
  - technical
  - knowledge-library
  - documentation
  - tagging
aliases:
  - Tagging Guide
  - Knowledge Library Tags
  - Document Classification
cssclasses:
  - documentation-guide
date: 2026-09-29
---

# 🏷️ Knowledge Library Tagging Guide

> [!info] Purpose
> This guide explains the new hierarchical tagging system for the Native Media AI Studio knowledge library. Use this when creating or updating documents to ensure consistent categorization.

---

## New Tagging System (2026-09-29)

The knowledge library now uses a **hierarchical tagging system** with two types of tags:

### 1. Hierarchical Category Tags

These tags define the primary category of the document and use the format `#category/*`:

| Category Tag | Description | Use For |
|--------------|-------------|---------|
| `#production/*` | Production workflow & creative guides | Music video production, audio analysis, prompts, character consistency |
| `#technical/*` | System implementation & code | API docs, build pipelines, debugging, testing |
| `#platform/*` | Platform-specific integrations | MCP tools, Unity, Blender, ComfyUI, Go services |
| `#creative/*` | Design, effects & visualization | Visualization techniques, shaders, color systems, design philosophy |
| `#performance/*` | Hardware & optimization | GPU constraints, VRAM management, benchmarks, CUDA |
| `#ai/*` | AI models, training & ML | Model utilization, fine-tuning, Ollama, vision models |
| `#research/*` | Industry trends & analysis | Competitive analysis, benchmarks, research gaps |

### 2. Cross-Cutting Tags

These tags describe specific technologies, platforms, or constraints that apply across categories:

| Tag | Description | When to Use |
|-----|-------------|-------------|
| `#platform-youtube` | YouTube-specific content | YouTube optimization, algorithm updates |
| `#platform-unity` | Unity-specific integration | Unity MCP, Unity shaders, Unity workflows |
| `#platform-blender` | Blender-specific | Blender MCP, EEVEE/Cycles, Blender workflows |
| `#platform-comfyui` | ComfyUI-specific | ComfyUI workflows, ComfyUI MCP, custom nodes |
| `#platform-remotion` | Remotion video compositing | Remotion guides, React video composition |
| `#hardware-8gb` | 8GB VRAM constraints | Documents specifically about 8GB limitations |
| `#hardware-pascal` | Pascal architecture specifics | GTX 10xx, sm_61, Pascal-specific optimizations |
| `#mcp` | Model Context Protocol | MCP contracts, MCP tools, MCP integration |
| `#testing` | Testing & QA | E2E tests, unit tests, test plans |
| `#design` | Design systems & UX | Color strategy, design philosophy, UI/UX |
| `#audio` | Audio analysis & processing | Audio analysis, beat detection, audio-reactive |
| `#visualization` | Visualization techniques | 2D/3D visualization, effects, shaders |
| `#3d` | 3D generation & rendering | 3D models, rendering, 3D workflows |
| `#webgpu` | WebGPU/TSL/compute shaders | WebGPU, TSL, GPU compute |

---

## Tagging Rules

### Primary Category Tag

Every document must have **exactly one** primary category tag from the hierarchical list:

```yaml
---
tags:
  - production  # or technical, platform, creative, performance, ai, research
---
```

### Cross-Cutting Tags

Add relevant cross-cutting tags based on content:

```yaml
---
tags:
  - production
  - platform-youtube
  - audio
  - design
---
```

### Tag Selection Guidelines

1. **Be specific but not redundant**: Don't add both `#platform-unity` and `#platform-blender` unless the document genuinely covers both
2. **Use platform tags for platform-specific content**: Only add `#platform-comfyui` if the content is ComfyUI-specific
3. **Hardware tags are for constraints**: Use `#hardware-8gb` only when discussing 8GB VRAM limitations specifically
4. **Keep it manageable**: Aim for 3-5 tags total per document (1 primary + 2-4 cross-cutting)

---

## Examples

### Example 1: Production Workflow Document

```yaml
---
tags:
  - production
  - audio
  - platform-youtube
aliases:
  - Audio Analysis Guide
cssclasses:
  - production-guide
date: 2026-09-29
---
```

### Example 2: Technical Implementation Document

```yaml
---
tags:
  - technical
  - platform-comfyui
  - testing
aliases:
  - ComfyUI Setup Guide
cssclasses:
  - technical-guide
date: 2026-09-29
---
```

### Example 3: AI/ML Document

```yaml
---
tags:
  - ai
  - hardware-8gb
  - hardware-pascal
aliases:
  - Model Optimization Guide
cssclasses:
  - ai-guide
date: 2026-09-29
---
```

### Example 4: Research Document

```yaml
---
tags:
  - research
  - platform-youtube
aliases:
  - YouTube Algorithm Analysis
cssclasses:
  - research-report
date: 2026-09-29
---
```

---

## Migration Checklist

When updating existing documents to the new tagging system:

- [ ] Remove old flat tags (e.g., `#music-video`, `#3d-rendering`, `#gpu`)
- [ ] Add exactly one primary category tag
- [ ] Add 2-4 relevant cross-cutting tags
- [ ] Update the document's `date` field to today's date
- [ ] Verify the document appears in the correct section of `index.md`
- [ ] Test that wiki-links still work correctly

---

## Tag Maintenance

The tagging system should be reviewed quarterly (every 3 months) to:

1. Remove unused or redundant tags
2. Add new cross-cutting tags for emerging technologies
3. Ensure consistency across similar documents
4. Update this guide with any changes

---

## Integration with Index

The `index.md` file is organized by the 7 primary categories. When you add a new document:

1. Choose the appropriate primary category
2. Add the document to the corresponding section in `index.md`
3. Apply the corresponding category tag to the document
4. Add relevant cross-cutting tags
5. Update the tag counts in the Tags Index section

---

_Last updated: 2026-09-29_
