---
tags:
  - index
  - knowledge-library
  - music-video
  - production
aliases:
  - Knowledge Library Index
  - Music Video Knowledge Base
  - Production Reference
cssclasses:
  - knowledge-index
date: 2026-08-27
---

# 📚 Knowledge Library Index

> [!info] Purpose
> Centralized knowledge hub for AI agents and creators to produce compelling music videos for YouTube.
> Built for [[Native Media AI Studio]] — a full-stack AI music video creation suite.

> [!tip] For AI Agents
> This vault is machine-readable. All documents use plain markdown with YAML frontmatter.
> Link between documents using `[[wiki-links]]` for cross-referencing.

---

## 🗂️ Library Structure

### 🎬 Production Pipeline
- [[music-video-production|🎵 Music Video Production Guide]] — Complete production workflow from audio upload to final export
- [[youtube-optimization|📺 YouTube Optimization]] — Platform-specific optimization for reach and engagement

### 🛠️ Technical References
- [[technical-reference|⚙️ Technical Reference]] — System architecture, API reference, service management
- [[integration-ollama|🤖 Ollama Integration]] — Local LLM inference, tool calling, agent loop patterns
- [[comfyui-workflows|🎨 ComfyUI Workflows]] — Custom workflows for image/video generation
- [[blender-mcp|🖥️ Blender MCP Integration]] — 3D scene building via MCP protocol
- [[hunyuan3d-setup|🧊 Hunyuan3D-2mini Setup]] — ComfyUI 3D generation with Kijai wrapper
- [[three-js-studio|🌐 Three.js Studio]] — Browser-based 3D scene builder with particles & reflections
- [[ai-video-trends-2026|📈 AI Video Trends 2026]] — 5 industry shifts, model landscape, pipeline upgrades
- [[kilo-code-subagent-orchestration|🤖 Kilo Code Subagent Orchestration]] — Subagent architecture, provider errors, optimization strategies

### 🎯 Specialized Guides
- [[3d-rendering|🧊 3D Rendering]] — GPU rendering, Blender 5.2 EEVEE Next, optimization
- [[visualization-effects|✨ Visualization Effects]] — WebGPU/TSL, particles, shaders, post-processing, volumetrics (NEW 2026-08-29)
- [[prompt-engineering|✍️ Prompt Engineering]] — Effective prompts + repair/versioning workflow
- [[remotion-guide|🎬 Remotion Video Compositing]] — Programmatic video with React (NEW 2026-09-01)
- [[remotion-guide|🎬 Remotion Video Compositing]] — Programmatic video with React (NEW 2026-09-01)

### 🤖 AI Agent Resources
- [[ai-agent-navigation|🤖 AI Agent Navigation]] — Quick lookup table for agents (NEW 2026-09-01)

### 📊 Research & Audit
- [[../ux-audit/audit-report|🔍 UX Audit Report]] — User experience findings and recommendations

---

## 🏷️ Tags Index

| Tag | Description | Documents |
|-----|-------------|-----------|
| `#music-video` | Music video production | 5 documents |
| `#3d-rendering` | 3D rendering and optimization | 3 documents |
| `#visualization` | Visualization effects, shaders, particles | 1 document |
| `#webgpu` | WebGPU / TSL / compute | 2 documents |
| `#ai-generation` | AI image/video generation | 4 documents |
| `#youtube` | YouTube platform optimization | 1 document |
| `#blender` | Blender 3D integration | 2 documents |
| `#comfyui` | ComfyUI workflows | 2 documents |
| `#gpu` | GPU optimization | 3 documents |
| `#prompt` | Prompt engineering | 1 document |
| `#kilo-code` | Kilo Code tooling and orchestration | 1 document |
| `#subagent` | Subagent architecture and errors | 1 document |
| `#remotion` | Remotion video compositing | 1 document |

---

## 🔗 Quick Links

### By Role
- **🎬 Director** → [[music-video-production]] → [[youtube-optimization]]
- **💻 Developer** → [[technical-reference]] → [[comfyui-workflows]] → [[blender-mcp]]
- **🎨 Artist** → [[prompt-engineering]] → [[3d-rendering]] → [[music-video-production]]
- **🤖 AI Agent** → [[kilo-code-subagent-orchestration]] → [[technical-reference]] → [[prompt-engineering]]

### By Pipeline Phase
```mermaid
graph LR
    A[Upload Audio] --> B[Analyze Beats]
    B --> C[Configure Generation]
    C --> D[Generate per Section]
    D --> E[Review & Export]
    E --> F[Upload to YouTube]
```

---

## 📝 How to Use This Vault

### For Creators
1. Start with [[music-video-production]] to understand the full workflow
2. Use [[prompt-engineering]] to craft better prompts
3. Reference [[youtube-optimization]] before publishing

### For AI Agents
1. Read [[technical-reference]] for system capabilities
2. Follow the workflow in [[music-video-production]]
3. Use [[comfyui-workflows]] and [[blender-mcp]] for technical operations
4. Return here to update knowledge as new techniques are discovered

### Adding New Knowledge
1. Create a new `.md` file in this vault
2. Add YAML frontmatter with `tags`, `aliases`, and `date`
3. Use `[[wiki-links]]` to connect to related documents
4. Update this index with the new entry

---

## 🔄 Maintenance

> [!warning] Keep Updated
> This knowledge library should be updated when:
> - New features are added to the pipeline
> - UX improvements are implemented
> - New models or tools are integrated
> - YouTube platform requirements change
> - New research on AI music video production emerges

---

## 📊 Vault Statistics

| Metric | Count |
|--------|-------|
| Total Documents | 15 (+ ai-video-trends-2026, visualization-effects, ai-agent-navigation) |
| Total Tags | 16 (+ remotion) |
| Total Links | 80+ |
| Last Updated | 2026-09-01 (ai-agent-navigation added, duplicates consolidated) |

---

*Last updated: 2026-09-01*
