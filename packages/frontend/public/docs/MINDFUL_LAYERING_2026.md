# Mindful Layering & Polished Cohesion — 2026 System
*Why v3/v4 felt cluttered + how to fix with restraint*
*Research distilled from 2026 motion + brand video + Remotion audits*

---

## Core Principle: Layering with Intent, Not Decoration

**Mantlr 2026 — Motion with Intent (9 mistakes):**
- Motion must *communicate*, not decorate. If you can't name the information it conveys, remove it.
- Hierarchy required: **Primary** (moves first / most prominent), **Secondary** (starts after / lower weight), **Ambient** (background, never competes). When all animate equally, user notices none.
- Durations: micro 100-200ms, mid 200-300ms, page 300-500ms, never >500ms. Anything over feels laggy. Err shorter (150ms snappy, 800ms broken).
- Easing as verb: `ease-out` enter (fast→slow landing), `ease-in` exit (slow→fast depart), `ease-in-out` transition. Never linear. Use 3 tokens, not per-component beziers.
- Audit: List every animation, answer "what info does this convey?" Delete those answering "delight/personality" unless 1-2 signature moments.

**Monotonomo 2026 Motion Budget:**
- **Rule 1:** Every animation has 1 of 4 jobs: state change, guide attention, feedback, spatial relationship. Else cut.
- **Rule 2:** Cap total initial-viewport animation duration **<800ms** (hero reveals + nav + ambient). 800ms = alive without waiting.
- **Rule 3:** Scroll-triggered fires once, not on re-entry.
- **Rule 4:** Nothing >500ms. Component 150-200ms, disclosure 200ms, page 300-500ms.
- **Rule 5:** Use CSS `opacity` + `transform` only (compositor thread, 16.6ms/frame @60fps). Never `width/height/top/left` (layout cost 6-14ms).
- **Cut list:** Parallax hero, letter-by-letter reveal, mouse-follow cursor, background gradient animation, staggered cards 100ms+, infinite loops. All add zero communication + performance cost.

**SamuelStudio 2026 — Designing Stillness:**
- Night city, empty road, solitary figure — not linear story, but state of being. Light sparingly, not solution. Tempo long, calm, slow — risk in short-form but offers breathing room.
- Repetition as meditation (road, city, figure), no climax, just continuation. Typography simple, disappears leaving space — less about communication, more about silence. Event name only at end. *Lesson: For headphone future-garage (spacious, introspective, 99-132 swung), calm holds > fast bounce.*

**OlafMotion Clean Motion:**
- Clarity: viewer instantly knows next focus. Hierarchy: primary→secondary. Consistency: same easing/timing Repeats. Restraint: no extra bounces/spins competing.
- Clean = 1 primary motion idea per element, staggered 2-4f, durations 6-12f micro / 12-20f text, 2-3 transitions max per project, subtle blur/parallax, predictable widget systems (titles, lower-thirds, bento cards share rules).

**StudioForTech Minimalist 2026:**
- One primary focal per screen (squint test). Reduction test: "If removed, would user still accomplish goal?" Yes → delete. Decorative borders, redundant labels, hero carousels → cut.
- 1 bg + 2-3 text colors + 1 accent used sparingly. Accent appearance = meaning, not decoration.  One typeface family, weight/size variations.
- Motion 150-300ms UI, 300-500ms transitions.

**Helion360 Cohesive Video System:**
- Video must be **single visual system**, not sequence of clips. 4 locks before animating: visual theme (emotional register, lighting, abstraction), image curation (consistent color temp, DOF, composition on one artboard), **type hierarchy (60-72pt hero / 36-40pt secondary / 20-24pt body)** held across every scene, **motion language** (entrance 0.3s ease-out, hold, exit reverse — 2-3 types max). *Dominant color ≤30% of frame, accent only on CTA/key stat.* Stock selection 20-30 → final 8-12 curated for same shoot. Transitions 12-18f cross-dissolve for content, motion-blur wipe for energy — not uniform. Polish phase spacing/alignment/easing/audio = where amateur breaks.

**Tapscape Cinematic AI:**
- One clear job per shot (not introduce+transform+move+logo at once). Structure: establishing → hero → detail → action → closing. 3 layers: **foreground (blur/shadow/particle) / midground (subject) / background (architecture/light)**. Parallax creates depth. Light direction consistent between shots; palette 2-3 tones. Transitions connect movement/shape/light/sound; clean cut often more pro than effect.

**Remotion Docs 2026:**
- Layers via `<AbsoluteFill>` stack — lower in tree = higher in layer stack; avoid `z-index` unless needed. Use `position:absolute` fixed dims. `Sequence from/durationInFrames` for timing, `interpolate` over `spring` for Studio-editable, keep inline `style` with individual `scale/translate/rotate` not `transform` string. CSS transitions forbidden, Tailwind animation classes forbidden. Render `still` for sanity check. Performance: `@remotion/media` for video, memoize, jpeg > png, `concurrency` benchmark, avoid fetching, avoid WebGL where not needed (2MB Spline hero cost).

---

## Audit of Current Storyboard & Composition (Why Cluttered)

**Storyboard 10 seq:** Each seq lists 7-9 elements (scenery + character + props + crystal + bento 2 cards + waveform + HUD 2 pills + grain + light leak + vignette + wipe). That's **11 layers simultaneously** — violates mindful "max 3 focal" and motion budget 800ms. Bento appears in 8/10 seq identically, waveform in all 10, character in all 10 — no hierarchy, no reduction test pass.

**Composition `StillIRise.tsx:99` current:**
- Background plate scale+translate every frame (1), haze (2), light leaks screen 0.09-0.16 (3), grain 0.045 + paper fiber 0.035 + burlap 0.025 (4-6), beat flash soft-light (7), dust 18 motes (8), color grade soft-light (9), character + shadow + reflection (10-12), props (13), ThreeCanvas crystal + 2 rings + reflective plane (14-17), waveform SVG (18), bento 2 cards (19-20), wipe (21), HUD 2 pills (22-23), center lyric hero vs editorial (24), bottom credit (25), vignette + letterbox (26-27). **27 layers, ~12 animating per frame** — budget blown, FPS tax, visual noise. Character occluded 30-60% by lyric glass + waveform line crossing waist.

**Specific clutter vs 2026:**
- Paper fiber + burlap on top of grain = double texture, not subtle. Dust 18 competing with waveform. Reflection mirrored adds second character competing for focus. Beat flash 0.03-0.05 is ambient but still flashes every beat.
- Bento spectrum 32 bars with `box-shadow` per bar → GPU blur cost, while flat slate bg doesn't need two cards.
- Typography: 88px STILL (letter bounce) + 72px RISE + 13px mono words below hero = 3 type levels in one frame, exceeds Helion's 3-level cap when combined with HUD 11px → 4 levels.
- Motion: `sin(t*0.45)` character + `sin(t*0.14)` props + `sin(t*0.22)` crystal + `sin(t*0.07)` leaks + `sin(t*0.9)` grain = 5 simultaneous sines, no hierarchy, feels busy not calm for headphone mix.

---

## Cohesive, Restrained System (v5 Polished)

**Motion Budget for Still I Rise (headphone future-garage, not UI):**
- Adapt UI budget to video: **Total motion per shot <3 focal movements**. Each shot: 1 primary (lyric or character entrance, 300-400ms ease-out), 1 secondary (bento or crystal drift, 200ms, starts 4f after primary), ambient = none. No infinite loops except subtle grain 15fps.
- Easing tokens: `--ease-enter: cubic-bezier(0,0,0.2,1)` (decelerate), `--ease-exit: cubic-bezier(0.4,0,1,1)` (accelerate), `--ease-standard: cubic-bezier(0.4,0,0.2,1)`. Use via `Easing.bezier()` in `interpolate`.
- Properties: Only `opacity`, `translate`, `scale`, `rotate`, `filter: blur()` sparingly. No `width/height/top`.
- Duration: Lyric line hold 3.5-9s, entrance 12f (400ms), exit 6f (200ms). Chorus hero letters stagger 2f, not simultaneous bounce. Prefer `interpolate` over `spring` unless physics needed (character landing).

**Layer Count per Shot — Max 3 Focal:**
| Shot | Primary (1) | Secondary (1) | Ambient (0-1) | Cut |
|------|-------------|---------------|---------------|-----|
| **Intro 00:00-00:18** | Scenery wide + letterbox (1) | Lyric thin pill (1) | Grain 0.04 (ambient) | 2 focal |
| **Verse 00:18-01:07** | Character mid + lyric glass (1+1) | Props *or* scenery detail, not both | Grain, no dust, no reflection | 2-3 focal,Props hidden in S03 |
| **Chorus** | Hero 72px STILL/I/RISE + crystal (1) | Bento *single* spectrum card (1) | Light leak 0.12, no waveform full-width | 2 focal + 1 ambient |
| **Bridge** | Character close + lyric (1) | Footprint texture (1) | VHS grain 0.06 | 2 focal, no Three.js |

**Hierarchy Rules Applied:**
- Squint test: In verse, lyric glass is primary (largest, centered, 19px bold), character secondary (behind, 0.82 opacity, blur 0px), bento tertiary hidden. In chorus, hero is primary (88px), crystal secondary (0.9 scale), bento tertiary (single card, not two).
- Reduction test: Removed — mirrored reflection, dust 18, burlap weave, second bento card, beat flash full-screen, paper fiber second overlay. Kept — one grain (0.04), one haze, one light leak.
- Color: Dominant `~70%` dark slate `#070a13`, accent `glowColor` ≤20% of frame (lyric active + spectrum bass bars + crystal emissive), not 30%+. Keeps accent meaningful when it appears.
- Typography: Locked to **2 families** (Space Grotesk + DM Mono), **3 levels** hero 72px / lyric 19-22px / HUD 10px. No 13px mono under hero (was 4th level).
- Transitions: **2 types only** — `cut` on snare (hard, 0f) for verse internal, `soft wipe 0.9s ease-out + light leak` at section boundaries (00:18,01:07,02:04,03:24). No letter-by-letter, no mouse-follow, no gradient animation.

**Foreground/Mid/Background Depth (Tapscape 3 layers):**
- Foreground: lyric glass + HUD pills (blur 18px, depth via shadow `0 14px 36px`), sharp.
- Midground: character / crystal / props — sharp, cast shadow to ground.
- Background: scenery plane + haze — blurred 0.5px in bridge, desat, no competition. Parallax only 4-6px, not 12px.

**Polish Cohesion Checklist (from research):**
- Style frame first: Single static 1920×1080 reference with palette `bg #070a13 + verse 198° / chorus 258° / bridge 28°` + type hierarchy + 2 bento cards → measured all previews against it.
- Image curation: 4 Blender renders share same HDRI, same sun angle 58°/rim 28°, same Cycles 128 samples — passed thumbnail artboard test (all look same shoot vs patchwork before).
- Motion language: `enter ease-out 12f / hold / exit ease-in 6f` standardized via `interpolate(..., Easing.bezier(0,0,0.2,1))`, not per-element `sin`.
- QA: Still frames at 150/900/2100/4500 + 6 bass samples (10s 0.23 →45s 17.16) validate grade before 7024f render.

**Future Mapping:**
- For new track, run `analyze_audio.py` → map BPM/key/LUFS → choose 4-color cap → lock style frame → define 2 transitions + 3 easing tokens → assign each lyric line to 1 primary +1 secondary layer → motion budget audit (<800ms) → still QA → render `concurrency 6`.

