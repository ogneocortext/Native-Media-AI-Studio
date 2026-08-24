/**
 * Template composition for creating music videos.
 * Copy this file and customize for your track.
 * Follows Remotion markup best practices.
 */

import { AbsoluteFill, Audio, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { useAudioAnalysis, LyricDisplay, AudioWaveform, SpectrumBars, SceneTransition, TrackInfo } from "../components";

// ============================================================================
// Configuration - Edit these for your track
// ============================================================================

const CONFIG = {
  audioFile: "your-track.mp3",
  title: "Your Track Title",
  artist: "Artist Name",
  bpm: 120,
  key: "C MAJOR",
  loudness: -8.5,
  accentColor: "#6366f1",
  backgroundColor: "#070a13",
  durationSeconds: 180,
  backgroundImage: "background.png",
  characterImage: "character.png",
  transitions: [45, 90, 120, 160],
};

const LYRICS = [
  { start: 0, end: 15, text: "First line of your song", section: "INTRO" },
  { start: 15, end: 30, text: "Second line of your song", section: "VERSE 1" },
  { start: 30, end: 45, text: "Third line of your song", section: "VERSE 1" },
  { start: 45, end: 60, text: "Chorus line here", section: "CHORUS" },
];

export const MyMusicVideoComposition: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, fps } = useVideoConfig();
  const t = frame / fps;
  const analysis = useAudioAnalysis(CONFIG.audioFile);

  const bgScale = interpolate(analysis.bass, [0, 0.5], [1, 1.02], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: CONFIG.backgroundColor, fontFamily: "Space Grotesk, sans-serif", overflow: "hidden" }}>
      <Audio src={staticFile(CONFIG.audioFile)} />

      <AbsoluteFill>
        <Img
          src={staticFile(CONFIG.backgroundImage)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: `brightness(0.85) contrast(1.05)`,
            opacity: 0.7
          }}
        />
        <AbsoluteFill style={{
          background: `linear-gradient(180deg, transparent 38%, rgba(0,0,0,0.5) 88%), radial-gradient(800px 500px at 50% 40%, ${CONFIG.accentColor}15 0%, transparent 60%)`
        }} />
      </AbsoluteFill>

      <AbsoluteFill style={{ pointerEvents: "none", opacity: 0.3 }}>
        {Array.from({ length: 12 }).map((_, i) => {
          const px = (i * 137.5 + frame * 0.1) % width;
          const py = 100 + Math.sin(t * 0.2 + i) * 50 + (i % 4) * 100;
          const sz = 1.5 + (i % 5) * 0.5 + analysis.bass * 2;
          const particleY = py + Math.sin(t * 0.6 + i) * 6;
          return (
            <div key={i} style={{
              position: "absolute",
              left: px,
              top: particleY,
              width: sz,
              height: sz,
              borderRadius: 999,
              background: CONFIG.accentColor,
              opacity: 0.2 + analysis.bass * 0.1,
              boxShadow: `0 0 8px ${CONFIG.accentColor}`,
            }} />
          );
        })}
      </AbsoluteFill>

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <Img
          src={staticFile(CONFIG.characterImage)}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 500 + analysis.bass * 20,
            height: 650 + analysis.bass * 20,
            objectFit: "contain",
            translate: `-50% -50%`,
            scale: bgScale,
            filter: `drop-shadow(0 20px 30px rgba(0,0,0,0.5)) drop-shadow(0 0 15px ${CONFIG.accentColor}40)`,
            opacity: 0.95
          }}
        />
      </AbsoluteFill>

      <div style={{ position: "absolute", bottom: 180, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <AudioWaveform color={CONFIG.accentColor} opacity={0.6} />
      </div>

      <LyricDisplay lyrics={LYRICS} accentColor={CONFIG.accentColor} />

      <SceneTransition times={CONFIG.transitions} color={CONFIG.accentColor} />

      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-end", padding: 24, pointerEvents: "none" }}>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end" }}>
          <TrackInfo
            title={CONFIG.title}
            artist={CONFIG.artist}
            bpm={CONFIG.bpm}
            key={CONFIG.key}
            loudness={CONFIG.loudness}
            color={CONFIG.accentColor}
          />
          <SpectrumBars color={CONFIG.accentColor} width={360} height={100} />
        </div>
      </AbsoluteFill>

      <div style={{
        position: "absolute",
        top: 24,
        left: 24,
        right: 24,
        display: "flex",
        justifyContent: "space-between",
        fontFamily: "DM Mono, monospace",
        fontSize: 11,
        letterSpacing: "0.12em",
        color: "rgba(255,255,255,0.7)"
      }}>
        <span style={{ background: "rgba(0,0,0,0.5)", padding: "6px 12px", borderRadius: 20 }}>
          {CONFIG.artist} — {CONFIG.title}
        </span>
        <span style={{ background: "rgba(0,0,0,0.5)", padding: "6px 12px", borderRadius: 20 }}>
          {String(Math.floor(t / 60)).padStart(2, "0")}:{String(Math.floor(t % 60)).padStart(2, "0")} / {String(Math.floor(CONFIG.durationSeconds / 60)).padStart(2, "0")}:{String(Math.floor(CONFIG.durationSeconds % 60)).padStart(2, "0")}
        </span>
      </div>

      <AbsoluteFill style={{
        background: "radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.5) 100%)",
        pointerEvents: "none"
      }} />
    </AbsoluteFill>
  );
};
