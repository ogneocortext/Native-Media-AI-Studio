---
name: remotion-demo-in-action
description: Demonstration of all Remotion skills applied to a sample composition
version: 4.0.539
---

# Remotion Skills in Action

This document demonstrates every Remotion skill applied to a single, cohesive
sample composition. Each section cites the skill file it implements so you can
see exactly how the guidance translates into working code.

---

## Skill Inventory

All skill files live under
`packages/frontend/.claude/skills/remotion-best-practices/`.

| Skill | File | Purpose |
|-------|------|---------|
| **Router** | `SKILL.md` | Entry point — routes to the right skill based on task |
| **Create** | `remotion-create/REFERENCE.md` | Scaffold new Remotion projects & compositions |
| **Markup** | `remotion-markup/REFERENCE.md` | React markup, animation, effects best practices |
| **Interactivity** | `remotion-interactivity/REFERENCE.md` | Studio-editable components, schemas, Interactive wrappers |
| **Studio** | `remotion-studio/REFERENCE.md` | Launch and use Remotion Studio preview |
| **Render** | `remotion-render/REFERENCE.md` | Export videos, stills, frame sequences |
| **Captions** | `remotion-captions/REFERENCE.md` | Transcribe, display, animate captions |
| **SaaS** | `remotion-saas/REFERENCE.md` | Build SaaS apps with Remotion |
| **Docs** | `remotion-docs/REFERENCE.md` | Look up Remotion API documentation |
| **Upgrade** | `remotion-upgrade/REFERENCE.md` | Upgrade Remotion and related packages |
| **Maps** | `remotion-maps/REFERENCE.md` | Geographic explainers, Mapbox, MapLibre, MapTiler |
| **Multimedia** | `remotion-multimedia/REFERENCE.md` | Trim, crop video/audio, metadata |

---

## Demonstration Composition

The sample below applies skills from **Markup**, **Interactivity**, **Captions**,
and **Studio** simultaneously. It is a 5-second audio-reactive title card with
an editable title, editable accent color, fade-in animation, and animated
captions.

### 1. Composition Registration (`RemotionComposition.tsx`)

Follows **Markup → Compositions and stills** and **Interactivity →
Make your own component interactive**.

```tsx
// packages/frontend/src/features/remotion/demo/RemotionComposition.tsx
import { Composition, registerRoot, useCurrentFrame, useVideoConfig } from "remotion";
import { Interactive } from "remotion";
import { Easing, interpolate } from "remotion";
import { Caption } from "@remotion/captions";
import { DemoTrack } from "./DemoTrack";

interface DemoProps {
  title: string;
  accentColor: string;
}

export const DemoComposition = (props: DemoProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Markup skill: inline interpolate(), inline Easing, inline output: 'perceptual-scale'
  const opacity = interpolate(frame, [0, 2 * fps], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const scale = interpolate(frame, [0, fps], [0.8, 1], {
    easing: Easing.spring({ damping: 200 }),
    output: "perceptual-scale",
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{ width: 1920, height: 1080, background: "#0b0b0f" }}>
      {/* Interactive skill: inline style, name prop, no extracted constants */}
      <Interactive.Div
        name="Main Title"
        style={{
          position: "absolute",
          top: "40%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          fontSize: 80,
          color: props.accentColor,
          fontWeight: "bold",
          opacity,
          transformOrigin: "center",
          // Inline transform shorthands — NOT a `transform` string
          scale,
          rotate: interpolate(frame, [0, fps], ["-5deg", "5deg"], {
            easing: Easing.spring({ damping: 150 }),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {props.title}
      </Interactive.Div>

      {/* Captions skill: animated caption overlay */}
      <DemoCaptions frame={frame} />

      <DemoTrack frame={frame} />
    </div>
  );
};

// Interactivity skill: schema defines every Studio-editable prop
export const DemoSchema = {
  ...Interactive.textSchema,   // style.color, style.fontSize, ...
  ...Interactive.backgroundSchema, // style.backgroundColor
  title: {
    type: "string",
    default: "Native Media AI",
    description: "Main title text",
    keyframable: false,
  },
  accentColor: {
    type: "color",
    default: "#0b84ff",
    description: "Accent color for the title",
    keyframable: false,
  },
} as const satisfies InteractivitySchema;

// Composition registration — id is a string literal, props are inline
registerRoot(DemoComposition, {
  id: "demo-title-card",
  component: DemoComposition,
  durationInFrames: 150,
  fps: 30,
  defaultProps: {
    title: "Native Media AI Studio",
    accentColor: "#0b84ff",
  },
});
```

### 2. Captions Component (`DemoCaptions.tsx`)

Follows **Captions → Generating captions** and **Captions → Displaying captions**.

```tsx
// packages/frontend/src/features/remotion/demo/DemoCaptions.tsx
import type { Caption } from "@remotion/captions";
import { useCurrentFrame } from "remotion";
import { Caption as RemotionCaption } from "@remotion/captions";

// Captions skill: JSON array of Caption objects
const CAPTIONS: Caption[] = [
  { text: "Welcome to Native Media AI Studio", startMs: 0, endMs: 1500, timestampMs: 0, confidence: 1 },
  { text: "Built with Remotion and React", startMs: 1500, endMs: 3000, timestampMs: 1500, confidence: 1 },
  { text: "AI-powered music video creation", startMs: 3000, endMs: 5000, timestampMs: 3000, confidence: 1 },
];

export const DemoCaptions = ({ frame }: { frame: number }) => {
  const ms = (frame / 30) * 1000;

  // Captions skill: find the active caption by time
  const active = CAPTIONS.find(
    (c) => ms >= c.startMs && ms < c.endMs
  );

  if (!active) return null;

  return (
    <RemotionCaption
      text={active.text}
      startMs={active.startMs}
      endMs={active.endMs}
      style={{
        position: "absolute",
        bottom: "20%",
        left: "50%",
        transform: "translateX(-50%)",
        fontSize: 32,
        color: "#ffffff",
        textAlign: "center",
        textShadow: "0 2px 4px rgba(0,0,0,0.5)",
      }}
    />
  );
};
```

### 3. Audio Track Component (`DemoTrack.tsx`)

Demonstrates **Markup → Media components** (`<Audio>` from `@remotion/media`) and
**Markup → Audio visualization**.

```tsx
// packages/frontend/src/features/remotion/demo/DemoTrack.tsx
import { useCurrentFrame, useVideoConfig } from "remotion";
import { Audio, staticFile } from "remotion";

export const DemoTrack = ({ frame }: { frame: number }) => {
  const { fps } = useVideoConfig();

  // Markup skill: staticFile() for assets in public/, inline style
  return (
    <Audio
      src={staticFile("background-music.mp3")}
      style={{ opacity: interpolate(frame, [0, fps], [0, 0.5], { extrapolateRight: "clamp" }) }}
    />
  );
};
```

---

## How the Skills Guide This Code

| Skill File | Applied In | What It Enforces |
|------------|-----------|------------------|
| `SKILL.md` (Router) | Entry point | Routes to Create/Markup/Interactivity/Studio/Render based on task |
| `remotion-create/REFERENCE.md` | Project setup | `npx create-video@latest --yes --blank --no-tailwind .`, `npm i` |
| `remotion-markup/REFERENCE.md` | `DemoComposition.tsx` | Inline `interpolate()`, `Easing`, `scale`/`translate`/`rotate` (no `transform` strings), `staticFile()` for assets |
| `remotion-interactivity/REFERENCE.md` | `DemoSchema`, `DemoComposition` | `Interactive.Div` (not plain `<div>`), inline `style` object, `name` prop, schema with `type`, `default`, `description`, `keyframable` |
| `remotion-captions/REFERENCE.md` | `DemoCaptions.tsx` | `Caption[]` JSON type, `startMs`/`endMs`/`text`, `<Caption>` component |
| `remotion-render/REFERENCE.md` | N/A (runtime) | `npx remotion render`, `npx remotion still`, `render --frames` |
| `remotion-studio/REFERENCE.md` | N/A (runtime) | `npx remotion studio`, open preview before editing |

---

## Running the Demo

### Step 1: Scaffold (per Create skill)

If no Remotion project exists yet:

```bash
cd packages/frontend
npx create-video@latest --yes --blank --no-tailwind remotion-demo
cd remotion-demo
npm i
```

### Step 2: Copy the demo files

Copy `DemoComposition.tsx`, `DemoCaptions.tsx`, `DemoTrack.tsx` into
`remotion-demo/src/`.

### Step 3: Open Studio (per Studio skill)

```bash
npx remotion studio
```

Open `http://localhost:3000/demo-title-card` in the browser. The title, accent
color, and opacity are all editable in the Studio sidebar per the schema.

### Step 4: Render (per Render skill)

When the user explicitly asks to export:

```bash
npx remotion render demo-title-card out/demo.mp4
```

Or render a still:

```bash
npx remotion still demo-title-card out/thumbnail.png
```

---

## Integration with Native Media AI Studio

These skill files are agent instructions stored at
`packages/frontend/.claude/skills/remotion-best-practices/`. They are loaded
automatically by the agent when any Remotion-related task is detected (creating
a video, editing captions, rendering, upgrading Remotion, etc.). The skills
encode project-specific conventions:

- **Inline styles only** — Studio can write back edits to inline `style` objects
- **No CSS transitions/animations** — use `interpolate()` + `Easing` instead
- **`Interactive.*` wrappers** — every editable element needs a `name` prop
- **Schema-driven props** — every Studio-editable value needs a schema entry
- **`staticFile()`** — all local assets go through `staticFile()` from `public/`

The skills are referenced by the router (`SKILL.md`) which dispatches based on
the user's request: "create a video" → `remotion-create`, "add captions" →
`remotion-captions`, "render the video" → `remotion-render`, etc.