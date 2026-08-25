/**
 * Reusable Remotion components for music video creation.
 * These components provide audio-reactive visuals, lyric displays, and scene transitions.
 *
 * Follows Remotion markup best practices:
 * - Uses scale/translate/rotate instead of transform
 * - Uses interpolate() for all animations (no CSS transitions)
 * - Uses Interactive.Div for Studio interactivity
 */

import { AbsoluteFill, interpolate, staticFile, useCurrentFrame, useVideoConfig, Easing, Interactive } from "remotion";
import { useWindowedAudioData, visualizeAudio, visualizeAudioWaveform, createSmoothSvgPath } from "@remotion/media-utils";
import { useMemo } from "react";
import { createTikTokStyleCaptions } from "@remotion/captions";
import type { Caption } from "@remotion/captions";

// ============================================================================
// Audio Analysis Hook
// ============================================================================

interface AudioAnalysis {
  spectrum: number[];
  waveform: number[];
  bass: number;
  mid: number;
  high: number;
  bassPulse: number;
}

export function useAudioAnalysis(src: string, windowInSeconds: number = 30): AudioAnalysis {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { audioData, dataOffsetInSeconds } = useWindowedAudioData({ src: staticFile(src), fps, frame, windowInSeconds });

  const spectrum = audioData ? visualizeAudio({ fps, frame, audioData, numberOfSamples: 64, optimizeFor: "speed", dataOffsetInSeconds }) : new Array(64).fill(0);
  const waveform = audioData ? visualizeAudioWaveform({ fps, frame, audioData, numberOfSamples: 280, windowInSeconds: 0.6, dataOffsetInSeconds }) : new Array(280).fill(0);

  const low = spectrum.slice(0, 10);
  const bass = low.reduce((a, b) => a + b, 0) / low.length || 0;
  const mid = spectrum.slice(10, 28).reduce((a, b) => a + b, 0) / 18 || 0;
  const high = spectrum.slice(28, 52).reduce((a, b) => a + b, 0) / 24 || 0;
  const bassPulse = interpolate(bass, [0, 0.6], [1, 1.35], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return { spectrum, waveform, bass, mid, high, bassPulse };
}

// ============================================================================
// Lyric Display Component (with word-by-word highlighting)
// ============================================================================

interface LyricLine {
  start: number;
  end: number;
  text: string;
  section: string;
}

interface LyricDisplayProps {
  lyrics: LyricLine[];
  style?: "chorus" | "verse" | "bridge" | "intro";
  accentColor?: string;
}

const EASE_WORD = Easing.bezier(0.16, 1, 0.3, 1);

export function LyricDisplay({ lyrics, style = "verse", accentColor = "#6366f1" }: LyricDisplayProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const currentLyric = lyrics.find((l) => t >= l.start && t < l.end) ?? lyrics[0];
  const lyricProgress = currentLyric ? (t - currentLyric.start) / (currentLyric.end - currentLyric.start) : 0;
  const words = currentLyric.text.split(" ");

  if (style === "chorus") {
    return (
      <ChorusLyricDisplay words={words} accentColor={accentColor} lyricProgress={lyricProgress} section={currentLyric.section} />
    );
  }

  return (
    <VerseLyricDisplay words={words} accentColor={accentColor} lyricProgress={lyricProgress} section={currentLyric.section} style={style} />
  );
}

function ChorusLyricDisplay({ words, accentColor, lyricProgress, section }: { words: string[]; accentColor: string; lyricProgress: number; section: string }) {
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
      <Interactive.Div name="ChorusLyrics" style={{ textAlign: "center", scale: 1 }}>
        <div style={{ display: "flex", gap: 18, justifyContent: "center", fontSize: 88, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, fontFamily: "Space Grotesk, sans-serif", color: "white", textShadow: "0 32px 66px rgba(0,0,0,0.5)" }}>
          {words.map((word, i) => {
            const wStart = i / words.length;
            const wEnd = (i + 1) / words.length;
            const active = lyricProgress >= wStart && lyricProgress < wEnd;
            const wordScale = interpolate(lyricProgress, [wStart, wEnd], [0.9, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_WORD });
            return (
              <Interactive.Div key={i} name={`Word-${i}`} style={{ display: "inline-block", scale: active ? wordScale : 1, opacity: active ? 1 : 0.96 }}>
                {word}
              </Interactive.Div>
            );
          })}
        </div>
        <div style={{ marginTop: 18, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", maxWidth: 760 }}>
          {words.map((w, i) => {
            const wStart = i / words.length;
            const wEnd = (i + 1) / words.length;
            const active = lyricProgress >= wStart && lyricProgress < wEnd;
            const appeared = lyricProgress >= wEnd;
            const wordOpacity = interpolate(lyricProgress, [wStart, wEnd], [0.4, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            return (
              <span key={i} style={{
                fontFamily: "DM Mono, monospace",
                fontSize: 13,
                letterSpacing: "0.18em",
                fontWeight: active ? 700 : 400,
                color: appeared ? "white" : active ? accentColor : "rgba(255,255,255,0.42)",
                opacity: appeared ? 1 : wordOpacity,
                textShadow: active ? `0 0 12px ${accentColor}88` : "none",
              }}>{w}</span>
            );
          })}
        </div>
        <div style={{ marginTop: 14, fontFamily: "DM Mono, monospace", fontSize: 11, letterSpacing: "0.22em", color: accentColor, opacity: 0.7 }}>{section}</div>
      </Interactive.Div>
    </AbsoluteFill>
  );
}

function VerseLyricDisplay({ words, accentColor, lyricProgress, section, style }: { words: string[]; accentColor: string; lyricProgress: number; section: string; style: string }) {
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
      <Interactive.Div name="VerseLyrics" style={{ textAlign: "center", maxWidth: 820, padding: "0 24px" }}>
        <div style={{
          display: "inline-block",
          background: style === "bridge" ? "rgba(16,18,22,0.64)" : "rgba(18,22,34,0.58)",
          backdropFilter: "blur(18px)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 24,
          padding: style === "bridge" ? "28px 36px 22px" : "22px 32px 18px",
          boxShadow: "0 14px 36px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.06)"
        }}>
          <div style={{ fontFamily: "DM Mono, monospace", fontSize: 11, letterSpacing: "0.22em", color: accentColor, opacity: 0.9, marginBottom: 10 }}>
            {section}
          </div>
          <div style={{ display: "flex", gap: 9, justifyContent: "center", flexWrap: "wrap" }}>
            {words.map((w, i) => {
              const wStart = i / words.length;
              const wEnd = (i + 1) / words.length;
              const active = lyricProgress >= wStart && lyricProgress < wEnd;
              const appeared = lyricProgress >= wEnd;
              const wordOpacity = interpolate(lyricProgress, [wStart, wEnd], [0.4, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
              const wordScale = interpolate(lyricProgress, [wStart, wEnd], [0.95, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_WORD });
              return (
                <span key={i} style={{
                  fontFamily: "Space Grotesk, sans-serif",
                  fontSize: style === "bridge" ? 22 : 19,
                  fontWeight: active ? 700 : 500,
                  color: appeared ? "white" : active ? accentColor : "rgba(255,255,255,0.42)",
                  opacity: appeared ? 1 : wordOpacity,
                  scale: active ? wordScale : 1,
                  textShadow: active ? `0 0 12px ${accentColor}88` : "none",
                }}>{w}</span>
              );
            })}
          </div>
        </div>
      </Interactive.Div>
    </AbsoluteFill>
  );
}

// ============================================================================
// TikTok-Style Captions Component (using @remotion/captions)
// ============================================================================

interface TikTokCaptionsProps {
  captions: Caption[];
  accentColor?: string;
  switchEveryMs?: number;
}

export function TikTokCaptions({ captions, accentColor = "#6366f1", switchEveryMs = 1200 }: TikTokCaptionsProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const { pages } = useMemo(() => {
    return createTikTokStyleCaptions({
      captions,
      combineTokensWithinMilliseconds: switchEveryMs,
    });
  }, [captions, switchEveryMs]);

  const tMs = t * 1000;

  const currentPage = pages.find((p) => tMs >= p.startMs && tMs < p.startMs + p.durationMs) ?? pages[0];

  if (!currentPage) {
    return (
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 120, pointerEvents: "none" }}>
        <div style={{ textAlign: "center", color: "#6b7280", fontSize: 14 }}>
          No captions for this timestamp
        </div>
      </AbsoluteFill>
    );
  }

  const words = currentPage.text.split(" ");
  const pageDurationSec = currentPage.durationMs / 1000;
  const pageStartSec = currentPage.startMs / 1000;
  const pageProgress = (t - pageStartSec) / pageDurationSec;

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 120, pointerEvents: "none" }}>
      <Interactive.Div name="Captions" style={{ textAlign: "center", maxWidth: 900, padding: "0 24px" }}>
        <div style={{
          display: "inline-flex",
          gap: 12,
          justifyContent: "center",
          flexWrap: "wrap",
          padding: "16px 28px",
          borderRadius: 20,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(16px)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}>
          {words.map((word, i) => {
            const wStart = i / words.length;
            const wEnd = (i + 1) / words.length;
            const active = pageProgress >= wStart && pageProgress < wEnd;
            const wordOpacity = interpolate(pageProgress, [wStart, wEnd], [0.5, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            return (
              <span key={i} style={{
                fontFamily: "Space Grotesk, sans-serif",
                fontSize: 32,
                fontWeight: active ? 700 : 400,
                color: active ? accentColor : "white",
                opacity: wordOpacity,
                textShadow: active ? `0 0 16px ${accentColor}88` : "0 2px 8px rgba(0,0,0,0.5)",
              }}>{word}</span>
            );
          })}
        </div>
      </Interactive.Div>
    </AbsoluteFill>
  );
}

// ============================================================================
// Audio Waveform Visualization
// ============================================================================

interface WaveformProps {
  color?: string;
  height?: number;
  opacity?: number;
}

export function AudioWaveform({ color = "#6366f1", height = 92, opacity = 0.85 }: WaveformProps) {
  const { width } = useVideoConfig();
  const analysis = useAudioAnalysis("still-i-rise.mp3");

  const path = createSmoothSvgPath({
    points: analysis.waveform.map((y, i) => ({
      x: (i / (analysis.waveform.length - 1)) * width,
      y: height + y * 92
    }))
  });

  return (
    <svg width={width} height={height * 2} style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity }}>
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} style={{ filter: `drop-shadow(0 0 8px ${color})` }} />
    </svg>
  );
}

// ============================================================================
// Spectrum Analyzer Bars
// ============================================================================

interface SpectrumBarsProps {
  color?: string;
  height?: number;
  width?: number;
}

export function SpectrumBars({ color = "#6366f1", height = 100, width = 420 }: SpectrumBarsProps) {
  const analysis = useAudioAnalysis("still-i-rise.mp3");

  const barValues = analysis.spectrum.filter((_, i) => i % 2 === 0).slice(0, 32);

  return (
    <div style={{ width, height, borderRadius: 22, background: "rgba(18,22,34,0.62)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px 12px", boxShadow: "0 10px 32px rgba(0,0,0,0.38)", display: "flex", alignItems: "flex-end", gap: 3 }}>
      {barValues.map((v, i) => {
        const scaled = Math.max(0, v * 100);
        const h = 8 + scaled * 0.86 + (i < 8 ? analysis.bass * 16 : 0);
        const isBass = i < 6;
        return (
          <div key={i} style={{
            flex: 1,
            height: h,
            backgroundColor: isBass ? color : i < 14 ? "rgba(255,255,255,0.92)" : "rgba(180,200,255,0.85)",
            opacity: isBass ? 0.95 : 0.72,
            borderRadius: 6,
            boxShadow: isBass ? `0 0 10px ${color}90` : "none",
            scale: 1,
            transformOrigin: "bottom"
          }} />
        );
      })}
    </div>
  );
}

// ============================================================================
// Scene Transition Effect
// ============================================================================

interface TransitionProps {
  times: number[];
  color?: string;
}

export function SceneTransition({ times, color = "#6366f1" }: TransitionProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const EASE_ENTER = Easing.bezier(0, 0, 0.2, 1);

  let wipeProgress = 0;
  let activeTransition = -1;

  for (let i = 0; i < times.length; i++) {
    const s = times[i];
    const e = s + 0.9;
    if (t >= s && t < e) {
      wipeProgress = (t - s) / 0.9;
      activeTransition = i;
      break;
    }
  }

  if (activeTransition === -1) {
    // No active transition — render empty fill (no transition effect)
    return <AbsoluteFill />;
  }

  const wipeX = interpolate(wipeProgress, [0, 1], [-900, 2700], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_ENTER });
  const wipeOpacity = interpolate(wipeProgress, [0, 0.5, 1], [0, 0.22, 0]);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{
        position: "absolute",
        inset: 0,
        background: `linear-gradient(100deg, transparent 42%, ${color}49 49%, white 50%, ${color}51 51.5%, transparent 62%)`,
        opacity: wipeOpacity,
        translate: `${wipeX}px 0px`
      }} />
    </AbsoluteFill>
  );
}

// ============================================================================
// Audio Track Info Display
// ============================================================================

interface TrackInfoProps {
  title: string;
  artist: string;
  bpm: number;
  key: string;
  loudness: number;
  color?: string;
}

export function TrackInfo({ title, artist, bpm, key, loudness, color = "#6366f1" }: TrackInfoProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <Interactive.Div name="TrackInfo" style={{
      width: 280,
      borderRadius: 22,
      background: "rgba(18,22,34,0.72)",
      backdropFilter: "blur(18px)",
      border: "1px solid rgba(255,255,255,0.09)",
      padding: 18,
      boxShadow: "0 10px 32px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.06)"
    }}>
      <div style={{ fontFamily: "DM Mono, monospace", fontSize: 10, letterSpacing: "0.18em", color: "rgba(255,255,255,0.56)" }}>
        {bpm} BPM • {key} • {loudness} LU
      </div>
      <div style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 13, fontWeight: 600, color: "white", lineHeight: 1.2, marginTop: 4 }}>
        {artist} — {title}
      </div>
      <div style={{ width: "100%", height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 99, marginTop: 12, overflow: "hidden" }}>
        <div style={{ width: `${(frame / fps / 234) * 100}%`, height: "100%", background: color, boxShadow: `0 0 8px ${color}` }} />
      </div>
    </Interactive.Div>
  );
}