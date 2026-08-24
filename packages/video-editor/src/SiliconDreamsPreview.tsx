/* Silicon Dreams 10s Preview — 5s to 15s of Still I Rise */
/* Aesthetic: Early CGI / Bryce 3D / Trapper Keeper — sparse low-poly terrain, big pastel planet, floating chrome torus/ico, checker grid, uncanny dream */
import { AbsoluteFill, Audio, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { useWindowedAudioData, visualizeAudio } from "@remotion/media-utils";
import React from "react";

const FPS = 30;
const PREVIEW_START = 5; // seconds, preview window 5-15s
const PREVIEW_DURATION = 10; // seconds
const DURATION_FRAMES = PREVIEW_DURATION * FPS; // 300

// Lyric slice for 5-15s: intro tail + verse start
const lyricsForPreview = [
  { start: 5, end: 9, text: "Midnight hums in shades of blue", section: "INTRO" },
  { start: 9, end: 15, text: "A map unwritten, waiting to be drawn anew", section: "INTRO" },
  { start: 15, end: 18, text: "A map unwritten, waiting...", section: "INTRO" },
];

export const SiliconDreamsPreview: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const absoluteTime = PREVIEW_START + frame / fps; // absolute song time 5-15s

  // Audio analysis synced to absolute time: offset frame by PREVIEW_START
  const audioFrame = frame + PREVIEW_START * fps;
  const { audioData, dataOffsetInSeconds } = useWindowedAudioData({
    src: staticFile("still-i-rise.mp3"),
    frame: audioFrame,
    fps,
    windowInSeconds: 12,
  });
  const spectrum = audioData ? visualizeAudio({ fps, frame: audioFrame, audioData, numberOfSamples: 32, optimizeFor: "speed", dataOffsetInSeconds }) : new Array(32).fill(0);
  const bass = spectrum.slice(0, 6).reduce((a, b) => a + b, 0) / 6 || 0;
  const mid = spectrum.slice(6, 14).reduce((a, b) => a + b, 0) / 8 || 0;

  const t = frame / fps; // 0-10 preview time
  const progress = frame / DURATION_FRAMES;

  // Current lyric for preview window
  const current = lyricsForPreview.find((l) => absoluteTime >= l.start && absoluteTime < l.end) ?? lyricsForPreview[0];
  const lineProg = (absoluteTime - current.start) / (current.end - current.start);
  const words = current.text.split(" ");

  // Low-poly drift for floaters (early CGI had stiff, low frame-rate drift)
  const floaterY = Math.sin(t * 0.38) * 6 + bass * 8;
  const planetX = 68 + Math.sin(t * 0.08) * 2;
  const gridShift = (frame * 0.6) % 40;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0f1e", fontFamily: "Space Grotesk, sans-serif", overflow: "hidden" }}>
      {/* Audio slice 5-15s */}
      <Audio src={staticFile("still-i-rise.mp3")} trimBefore={PREVIEW_START * fps} trimAfter={(234.12 - (PREVIEW_START + PREVIEW_DURATION)) * fps} />

      {/* 1. BACKGROUND: Sparse low-poly terrain checker + pastel sky gradient (Bryce) */}
      <AbsoluteFill>
        <Img src={staticFile("sd-terrain.png")} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "contrast(1.02) saturate(0.96)" }} />
        {/* Grid overlay — classic Silicon Dreams laser grid */}
        <AbsoluteFill style={{ opacity: 0.22, backgroundImage: `linear-gradient(rgba(140,200,220,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(140,200,220,0.18) 1px, transparent 1px)`, backgroundSize: `40px 40px`, backgroundPosition: `${gridShift}px ${gridShift * 0.5}px` } as React.CSSProperties} />
        {/* Fog haze */}
        <AbsoluteFill style={{ background: `linear-gradient(180deg, transparent 28%, rgba(10,15,30,0.42) 78%), radial-gradient(700px 400px at 52% 34%, rgba(180,210,255,0.14) 0%, transparent 62%)` }} />
      </AbsoluteFill>

      {/* 2. BIG PASTEL PLANET — low-poly icosphere, wobbles slowly (uncanny) */}
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-end", paddingRight: 42, paddingTop: 32 }}>
        <Img
          src={staticFile("sd-planet.png")}
          style={{
            position: "absolute",
            right: `${planetX - 68}px`,
            top: 48,
            width: 320,
            height: 320,
            objectFit: "contain",
            transform: `scale(${1 + bass * 0.06}) rotate(${t * 2}deg)`,
            filter: `drop-shadow(0 12px 24px rgba(0,0,0,0.45)) saturate(1.08)`,
            opacity: 0.92,
          }}
        />
      </AbsoluteFill>

      {/* 3. FLOATING CHROME SHAPES — torus + ico, low-res, hard shadows (early CGI jank) */}
      <AbsoluteFill style={{ opacity: 0.94 }}>
        <Img
          src={staticFile("sd-floaters.png")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `translateY(${floaterY}px) scale(${1 + mid * 0.025})`,
            filter: `contrast(1.04) brightness(1.02) drop-shadow(0 10px 22px rgba(0,0,0,0.35))`,
          }}
        />
      </AbsoluteFill>

      {/* 4. CHROME TITLE — Silicon Dreams chrome + low-poly grid, not liquid glass */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
        <div style={{ textAlign: "center", transform: `scale(${1 + bass * 0.03})` }}>
          <div
            style={{
              fontSize: 56,
              fontWeight: 800,
              letterSpacing: "0.14em",
              lineHeight: 1,
              color: "#d8dde6",
              WebkitTextStroke: "1px rgba(160,170,190,0.9)",
              textShadow: `0 1px 0 #fff, 0 2px 0 #c8d0de, 0 6px 14px rgba(0,0,0,0.45), 0 0 18px rgba(180,210,255,0.35)`,
              fontFamily: "Space Grotesk, sans-serif",
              // Chrome gradient via background clip
              background: `linear-gradient(180deg, #ffffff 0%, #dbe2ef 38%, #8ea0b8 52%, #ffffff 68%, #a8b4c8 100%)`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              filter: `drop-shadow(0 2px 0 rgba(0,0,0,0.22))`,
            }}
          >
            SILICON DREAMS
          </div>
          <div style={{ marginTop: 6, fontFamily: "DM Mono, monospace", fontSize: 11, letterSpacing: "0.22em", color: "rgba(180,210,255,0.78)" }}>
            05:00 — 15:00 • INTRO → VERSE • PREVIEW
          </div>
          {/* Lyric as Trapper Keeper sub-title — low-res, 1px outline */}
          <div
            style={{
              marginTop: 18,
              display: "inline-block",
              background: "rgba(12, 16, 28, 0.72)",
              border: "1px solid rgba(160,180,210,0.22)",
              borderRadius: 12,
              padding: "10px 18px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", maxWidth: 720 }}>
              {words.map((w, i) => {
                const s = i / words.length;
                const e = (i + 1) / words.length;
                const active = lineProg >= s && lineProg < e;
                const done = lineProg >= e;
                return (
                  <span
                    key={i}
                    style={{
                      fontFamily: "Space Grotesk, sans-serif",
                      fontSize: 16,
                      fontWeight: active ? 700 : 500,
                      color: done ? "#e6eef6" : active ? "#a8d8ff" : "rgba(220,230,245,0.42)",
                      transform: active ? "translateY(-1px)" : "none",
                      textShadow: active ? "0 0 8px rgba(168,216,255,0.9)" : "none",
                      WebkitTextStroke: active ? "0.4px rgba(168,216,255,0.9)" : "none",
                    }}
                  >
                    {w}
                  </span>
                );
              })}
            </div>
            <div style={{ width: "100%", height: 2, background: "rgba(255,255,255,0.08)", borderRadius: 99, marginTop: 10, overflow: "hidden" }}>
              <div style={{ width: `${lineProg * 100}%`, height: "100%", background: "#a8d8ff", boxShadow: "0 0 8px #a8d8ff" }} />
            </div>
          </div>
          <div style={{ marginTop: 10, fontFamily: "DM Mono, monospace", fontSize: 10, letterSpacing: "0.16em", color: "rgba(180,210,255,0.52)" }}>
            {current.section} • {current.text.slice(0, 48)}
          </div>
        </div>
      </AbsoluteFill>

      {/* 5. SPECTRUM as low-res bars (early CGI had chunky bars) */}
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 18, pointerEvents: "none" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 56, padding: "8px 14px", borderRadius: 12, background: "rgba(12,16,28,0.68)", border: "1px solid rgba(160,180,210,0.14)", backdropFilter: "blur(6px)" }}>
          {spectrum.slice(0, 20).map((v, i) => {
            const h = 6 + v * 42 + (i < 4 ? bass * 10 : 0);
            return <div key={i} style={{ width: 10, height: h, background: i < 4 ? "#a8d8ff" : i < 8 ? "#d8dde6" : "rgba(160,180,210,0.55)", borderRadius: 2, boxShadow: i < 4 ? "0 0 8px #a8d8ff" : "none" }} />;
          })}
          <span style={{ fontFamily: "DM Mono, monospace", fontSize: 9, color: "rgba(160,180,210,0.62)", marginLeft: 8, letterSpacing: "0.12em" }}>{(absoluteTime).toFixed(2)}s / 234.12s</span>
        </div>
      </AbsoluteFill>

      {/* 6. Progress bar chrome */}
      <div style={{ position: "absolute", bottom: 0, left: 0, width: `${progress * 100}%`, height: 3, background: "linear-gradient(90deg, #a8d8ff 0%, #d8dde6 50%, #8ea0b8 100%)", boxShadow: "0 0 10px #a8d8ff" }} />

      {/* Top HUD chrome pill */}
      <div style={{ position: "absolute", top: 18, left: 18, right: 18, display: "flex", justifyContent: "space-between", fontFamily: "DM Mono, monospace", fontSize: 10, letterSpacing: "0.14em", color: "rgba(180,210,255,0.78)" }}>
        <span style={{ background: "rgba(12,16,28,0.62)", border: "1px solid rgba(160,180,210,0.18)", padding: "6px 12px", borderRadius: 99, backdropFilter: "blur(8px)" }}>SILICON DREAMS • BRYCE 3D • 1994</span>
        <span style={{ background: "rgba(12,16,28,0.62)", border: "1px solid rgba(160,180,210,0.18)", padding: "6px 12px", borderRadius: 99, backdropFilter: "blur(8px)" }}>{String(Math.floor(absoluteTime / 60)).padStart(2, "0")}:{(Math.floor(absoluteTime % 60) + "").padStart(2, "0")} / 03:54</span>
      </div>
    </AbsoluteFill>
  );
};

export const SiliconDreamsDuration = DURATION_FRAMES;
export const SiliconDreamsFps = FPS;
