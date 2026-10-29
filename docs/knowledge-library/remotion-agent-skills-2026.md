---
tags:
  - technical
  - remotion
  - skills
  - ai-agents
aliases:
  - Remotion Agent Skills
  - Remotion Skills
  - Remotion AI Skills
cssclasses:
  - technical-guide
date: 2026-10-29
type: concept
---

# Remotion Agent Skills

Remotion's MCP server (`@remotion/mcp`) was **shut down on October 26, 2026**. This project now uses **Remotion Agent Skills** instead — a set of 12 specialized skill modules that define best practices for working in Remotion projects.

## Installation

Skills are installed via the `skills` CLI:

```bash
# Install all 12 Remotion skills non-interactively
npx skills add remotion-dev/skills --agent '*' -y

# Or with GitHub CLI
gh skill install remotion-dev/skills
```

## Available Skills

| Skill | Purpose |
|-------|---------|
| `/remotion-best-practices` | Umbrella skill encompassing all others. Use when unsure which specific skill to apply. |
| `/remotion-create` | Create a new Remotion project or composition. |
| `/remotion-markup` | Best practices for writing Remotion React markup (compositions, animations, layout, typography, media elements, effects, audio, fonts, timing). |
| `/remotion-studio` | Launch the Studio to preview your video. |
| `/remotion-render` | Invoke a render into a video or still image. |
| `/remotion-maps` | Best practices for map animations (static maps, animated routes, markers, Mapbox, MapLibre, MapTiler, GeoJSON, CesiumJS 3D flyovers). |
| `/remotion-captions` | Guidance for captions and subtitles. |
| `/remotion-saas` | Architecture guidance for Remotion-powered apps and product integrations. |
| `/remotion-interactivity` | Guidance for making Remotion code editable in Studio (when elements aren't selectable/editable as expected). |
| `/remotion-docs` | Search Remotion documentation and fetch any page as Markdown (API references, component props, package guides). |
| `/remotion-license` | Find Remotion license information, FAQs, terms, and where to buy a license. |
| `/remotion-upgrade` | Upgrade Remotion, related packages, compatible Mediabunny packages, and installed Remotion Agent Skills. |
| `/remotion-multimedia` | Guidance for browser-based multimedia handling with Mediabunny (video/audio metadata). |

## Migration from @remotion/mcp

The deprecated `@remotion/mcp` MCP server has been removed from this project:

| Before (deprecated) | After (current) |
|---------------------|-----------------|
| `npx -y @remotion/mcp@latest` | `npx skills add remotion-dev/skills --agent '*' -y` |
| `npx -y @remotion/mcp@1.0.0` | `npx skills add remotion-dev/skills --agent '*' -y` |
| MCP server via stdio | Skill modules via `skills` CLI |
| Unpinned `@latest` | Version-tracked via skills registry |

## Usage Examples

```bash
# Create a new composition
npx skills use remotion-create -- "Make a promo video for a record store"

# Get documentation
npx skills use remotion-docs -- "How to set up Remotion Lambda?"

# Upgrade Remotion packages
npx skills use remotion-upgrade -- ""

# Render a video
npx skills use remotion-render -- ""
```

## Security

All 12 skills have been scanned:
- 11 skills: **Safe** / Low Risk
- `remotion-docs`: **High Risk** (Snyk) — review before production use
- `remotion-upgrade`: **Medium Risk** (Snyk) — review before production use

## Verification

```bash
# List installed skills
npx skills list

# Verify Remotion version
pnpm list remotion  # Should show 4.0.534
```

## References

- [Remotion Agent Skills Documentation](https://www.remotion.dev/docs/ai/skills)
- [Remotion Skills GitHub Repository](https://github.com/remotion-dev/skills)
- [Remotion Documentation](https://www.remotion.dev/docs/)
