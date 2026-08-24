# Remotion Video Editor

## Overview

The Remotion video editor (packages/video-editor/) is a powerful system for creating audio-reactive music videos. It uses the Remotion library to compose videos programmatically with React components.

## Accessing the Video Editor

### From the Main Frontend

The main frontend (port 5173) includes a **Video Editor** page at `/video-editor` that provides:
- Quick start guide with step-by-step instructions
- Component reference with props and return values
- Composition registry and render commands
- Direct link to open the Remotion Studio

Navigate to: `http://localhost:5173/video-editor`

### Standalone Remotion Studio

The video editor runs as a separate Remotion dev server:

```bash
cd packages/video-editor
npm install
npm run dev
```

Then open: `http://localhost:3000`

The Remotion Studio provides:
- Live preview of compositions
- Props editor panel
- Timeline scrubbing
- Render queue management

---

## Quick Start

1. **Install dependencies:**
   `ash
   cd packages/video-editor
   npm install
   `

2. **Start the preview:**
   `ash
   npm run dev
   `

3. **Open your browser:** Navigate to http://localhost:3000 to see the Remotion Player

## Project Structure

\\\
video-editor/
├── public/                    # Static assets (audio, images, videos)
│   ├── *.mp3                  # Audio tracks
│   ├── *.png                  # Background images, characters, props
│   └── stems/                 # Separated audio stems
├── src/
│   ├── components/            # Reusable Remotion components
│   │   └── index.ts           # Audio analysis, lyrics, waveform, etc.
│   ├── compositions/          # Video compositions
│   │   └── Template.tsx       # Template for new videos
│   ├── StillIRise.tsx         # "Still I Rise" composition
│   ├── TakeTheCrown.tsx       # "Take the Crown" composition
│   ├── Composition.tsx        # Main composition registry
│   └── Root.tsx               # Remotion root entry point
├── package.json
└── tsconfig.json
\\\

## Creating a New Music Video

### Step 1: Prepare Assets

Place your assets in the public/ folder:
- Audio track: public/your-track.mp3
- Background image: public/background.png
- Character/prop images: public/character.png

### Step 2: Create a Composition

Copy src/compositions/Template.tsx and customize:

\\\	sx
import { AbsoluteFill, Audio, staticFile } from "remotion";
import { useAudioAnalysis, LyricDisplay, AudioWaveform } from "../components";

const CONFIG = {
  audioFile: "your-track.mp3",
  title: "Your Track",
  artist: "Your Artist",
  bpm: 120,
  key: "C MAJOR",
  accentColor: "#6366f1",
  // ... more config
};

const LYRICS = [
  { start: 0, end: 10, text: "First line", section: "INTRO" },
  { start: 10, end: 20, text: "Second line", section: "VERSE" },
  // ... more lyrics
];

export const MyVideo = () => {
  const analysis = useAudioAnalysis(CONFIG.audioFile);
  // ... composition using CONFIG, LYRICS, and analysis
};
\\\

### Step 3: Register Your Composition

Add your composition to Composition.tsx\:

\\\	sx
import { MyVideo } from "./compositions/YourVideo";

export const compositionRegistry = {
  // ... existing compositions
  "my-video": {
    component: MyVideo,
    durationInSeconds: 180,
  },
};
\\\

### Step 4: Preview and Render

Preview in the Remotion Player, then render:

\\\ash
npm run build -- --composition=my-video
\\\

## Reusable Components

### useAudioAnalysis(src)

Hook that provides real-time audio analysis data.

\\\	sx
const analysis = useAudioAnalysis("my-track.mp3");
// analysis.spectrum  - Frequency spectrum array (64 bands)
// analysis.waveform  - Waveform data array (280 points)
// analysis.bass      - Bass energy level (0-1)
// analysis.mid        - Mid energy level (0-1)
// analysis.high       - High energy level (0-1)
// analysis.bassPulse  - Scaled bass value for animations
\\\

### LyricDisplay

Renders animated lyrics that sync to timing data.

\\\	sx
<LyricDisplay
  lyrics={LYRICS}
  style="chorus" | "verse" | "bridge" | "intro"
  accentColor="#6366f1"
/>
\\\

### AudioWaveform

SVG waveform visualization that reacts to audio.

\\\	sx
<AudioWaveform
  color="#6366f1"
  height={92}
  opacity={0.85}
/>
\\\

### SpectrumBars

Frequency spectrum bar visualizer.

\\\	sx
<SpectrumBars
  color="#6366f1"
  height={100}
  width={420}
/>
\\\

### SceneTransition

Flash/transition effect at specified times.

\\\	sx
<SceneTransition
  times={[45, 90, 120]}  // Transition times in seconds
  color="#6366f1"
/>
\\\

### TrackInfo

Displays track metadata with progress bar.

\\\	sx
<TrackInfo
  title="My Song"
  artist="My Artist"
  bpm={120}
  key="C MAJOR"
  loudness={-8.5}
  color="#6366f1"
/>
\\\

## Configuration Options

| Property | Type | Description |
|----------|------|-------------|
| udioFile | string | Path to audio file in public/ |
| 	itle | string | Track title |
| rtist | string | Artist name |
| pm | number | Beats per minute |
| key | string | Musical key |
| loudness | number | Loudness in LUFS |
| ccentColor | string | Primary color (hex/hsl) |
| ackgroundColor | string | Background color |
| durationSeconds | number | Total duration |
| 	ransitions | number[] | Transition times (seconds) |

## Lyric Format

\\\	sx
const LYRICS = [
  {
    start: 0,      // Start time in seconds
    end: 15,       // End time in seconds
    text: "Lyric text",
    section: "INTRO" | "VERSE 1" | "CHORUS" | "BRIDGE" | etc.
  },
  // ...
];
\\\

## Tips for Great Videos

1. **Sync transitions to beat drops** — Use the 	ransitions array at musically significant moments
2. **Use section colors** — Different sections (verse, chorus, bridge) can have different accent colors
3. **Layer effects** — Combine waveform, spectrum, and particles for rich visuals
4. **Animate with bass** — Use nalysis.bass to drive scale, position, and opacity animations
5. **Add depth** — Use multiple layers with different opacity and blur for parallax effect

## Rendering

Render to video file:

\\\ash
npx remotion render src/index.tsx MyVideo out.mp4
\\\

Render with custom quality:

\\\ash
npx remotion render src/index.tsx MyVideo out.mp4 --codec=h265 --quality=95
\\\

## Troubleshooting

- **Audio not loading:** Ensure file is in public/ folder and referenced with staticFile()
- **Lyrics out of sync:** Verify start and nd times match the audio
- **Performance issues:** Reduce particle count or spectrum resolution
- **Build errors:** Check that all imports are from @remotion/* packages