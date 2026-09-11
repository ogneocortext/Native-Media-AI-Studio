# Kinetic Typography Options — Research Note

Date: 2026-09-10
Context: Native Media AI Studio — lyric/karaoke preview and future video generation

## Top Libraries & Techniques

### Anime.js v4 (recommended for this project)
- Size: ~115 KB, MIT, active development in 2026
- Strengths: `text.split()` for chars/words/lines, stagger timelines, karaoke-friendly sequencing, good React integration
- Use case: word-by-word lyric highlight, per-line enter/exit choreography, beat-synced sequences
- Tradeoff: concurrent performance is good but slightly behind GSAP; MIT license is commercial-friendly

### Motion (formerly Framer Motion)
- Size: ~132 KB core, MIT
- Strengths: React-first, `animate` + `stagger`, layout animations, exit animations, spring physics
- Use case: smooth React-driven lyric line transitions, auto-scroll reveals, distance-based opacity
- Tradeoff: `splitText` is Motion+ paid add-on; core library is free and sufficient for most effects

### GSAP
- Size: ~73 KB core, Standard “no charge” license
- Strengths: industry-standard timelines, robust sequencing, strong text plugins, battle-tested
- Use case: complex multi-layer lyric compositions, frame-accurate video previews
- Tradeoff: license terms differ from MIT; heavier plugin surface than needed for simple karaoke

### Remotion + remotion-typography (Zodiac)
- Use case: deterministic video rendering, not live preview
- Strengths: frame-perfect, type-safe, good for final export
- Tradeoff: not suited for interactive in-browser preview

### music-lyric-player-web
- Strengths: purpose-built for karaoke, syllable-level timing, distance-based blur/scale, multiple scroll modes
- Use case: drop-in lyric player behavior
- Tradeoff: opinionated DOM structure; may not fit existing preset/animation architecture

## Key Techniques to Apply

1. Split text into animatable units (words or chars) instead of animating whole lines
2. Stagger word reveals with small delays for karaoke-style highlight
3. Distance-based opacity/blur for upcoming and past lines
4. Clip/overflow-hidden containers for slide-up line reveals
5. Beat-reactive scale/glow driven by audio analysis timestamps
6. Auto-scroll to keep active line centered without jarring jumps
7. Section-aware transitions (verse vs chorus vs bridge)

## Decision for This Project

Primary: use Motion (core) for React-friendly line transitions and stagger effects.
Secondary: use Anime.js for timeline-heavy karaoke sequences if Motion+ splitText is unavailable.
Keep custom CSS for lightweight effects to avoid bundle bloat.
