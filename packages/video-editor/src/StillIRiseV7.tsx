/**
 * StillIRise V7 — Real analysis timing + shared timing/section helpers.
 *
 * - TimingContract embedded from output/test-Nathaniel_Smalley___Still_I_Rise-analysis.json
 *   (336 beats, 8 sections, 234.12 s — see src/lib/stillIRiseTiming.ts)
 * - lib/timing.ts lookups are frame-accurate (getSectionAtTime / getBeatNearTime /
 *   interpolateEnergy)
 * - sectionHelpers.ts palettes + energy-aware intensity per section
 */

import { Audio, AbsoluteFill, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { visualizeAudio, visualizeAudioWaveform, useWindowedAudioData } from "@remotion/media-utils";
import { StudioBackButton } from "./components/StudioBackButton";

// ─── Shared timing imports ───
import { clamp, mapRange } from "./lib/timing";
import { STILL_I_RISE_TIMING, STILL_I_RISE_DURATION_SECONDS } from "./lib/stillIRiseTiming";
import { useTimingContract } from "./hooks/useAnalyzedAudioData";

// ─── Section helpers ───
import { getSectionColors, getSectionIntensity } from "./lib/sectionHelpers";

const FPS = 30;
const DURATION_SECONDS = STILL_I_RISE_DURATION_SECONDS; // 234.12s from analysis
const DURATION_FRAMES = Math.ceil(FPS * DURATION_SECONDS);

// ─── Embedded timing contract for Still I Rise ───
// Generated from the real GPU audio analysis (tools/analyze_and_sync.py) —
// see src/lib/stillIRiseTiming.ts. (Replaces the earlier hand-guessed
// inline contract with empty beats/energyCurve.)

interface LyricLine { start: number; end: number; text: string; section: string; }

// Lyric timings from LRC (ground truth for when singer actually says each line)
// Source: output/audio/NeoCortext - Still I Rise.lrc
const lyrics: LyricLine[] = [
  { start: 7.56, end: 13.40, text: "Midnight hums in shades of blue", section: "INTRO" },
  { start: 13.40, end: 37.76, text: "A map unwritten, waiting to be drawn anew", section: "INTRO" },
  { start: 37.76, end: 42.36, text: "I walk where the streetlight loses its name", section: "VERSE" },
  { start: 42.36, end: 47.24, text: "Learning the language of a different rain", section: "VERSE" },
  { start: 47.24, end: 52.60, text: "Each wrong turn leaves a mark on my sleeve", section: "VERSE" },
  { start: 52.60, end: 56.76, text: "Proof of the roads I was scared to believe", section: "VERSE" },
  { start: 56.76, end: 59.52, text: "The horizon moves, so I move with it too", section: "VERSE" },
  { start: 59.52, end: 61.80, text: "Past all the rules that never came true", section: "VERSE" },
  { start: 61.80, end: 64.40, text: "I wear the unknown like a second skin", section: "VERSE" },
  { start: 64.40, end: 67.48, text: "Keeping one small match alive in the wind", section: "VERSE" },
  { start: 67.48, end: 72.40, text: "Still I rise before the fade", section: "VERSE" },
  { start: 72.40, end: 76.64, text: "Still I chase the light I made", section: "VERSE" },
  { start: 76.64, end: 81.56, text: "Out on the edge where tomorrow waits", section: "VERSE" },
  { start: 81.56, end: 106.08, text: "I'm becoming what tomorrow makes", section: "VERSE" },
  { start: 106.08, end: 108.76, text: "Deep in the fog, I found a steadier hand", section: "VERSE" },
  { start: 108.76, end: 110.76, text: "Every river redrew where I stand", section: "VERSE" },
  { start: 110.76, end: 113.36, text: "I keep small hours like coins in my coat", section: "VERSE" },
  { start: 113.36, end: 115.64, text: "Warm from the crossing, enough to stay afloat", section: "VERSE" },
  { start: 115.64, end: 118.12, text: "They watched from the shore while I learned to swim", section: "VERSE" },
  { start: 118.12, end: 120.72, text: "Now even the tide has changed its hymn", section: "VERSE" },
  { start: 120.72, end: 123.00, text: "Softer than thunder, clear as the glass", section: "VERSE" },
  { start: 123.00, end: 126.28, text: "I build what will stay when the old days pass", section: "VERSE" },
  { start: 126.28, end: 131.20, text: "Still I rise before the fade", section: "VERSE" },
  { start: 131.20, end: 135.44, text: "Still I chase the light I made", section: "VERSE" },
  { start: 135.44, end: 140.32, text: "Out on the edge where tomorrow waits", section: "VERSE" },
  { start: 140.32, end: 168.48, text: "I'm becoming what tomorrow makes", section: "VERSE" },
  { start: 168.48, end: 173.08, text: "I thought the map had to tell me where", section: "BRIDGE" },
  { start: 173.08, end: 177.64, text: "But dawn found my footprints already there", section: "BRIDGE" },
  { start: 177.64, end: 180.08, text: "No finish line, no hand to hold", section: "BRIDGE" },
  { start: 180.08, end: 204.60, text: "Just my own fire against the cold", section: "BRIDGE" },
  { start: 204.60, end: 209.44, text: "Still I rise before the fade", section: "CHORUS" },
  { start: 209.44, end: 213.76, text: "Still I chase the light I made", section: "CHORUS" },
  { start: 213.76, end: 218.64, text: "Out on the edge where tomorrow waits", section: "CHORUS" },
  { start: 218.64, end: 222.14, text: "I'm becoming what tomorrow makes", section: "CHORUS" },
];
// Transition times from LRC section boundaries (ground truth musical structure)
const transitionTimes = [37.68, 168.40, 204.52];

const EASE_ENTER = Easing.bezier(0, 0, 0.2, 1);

const LYRIC_KEYWORDS = {
  rain: ["rain", "rain."], fog: ["fog", "fog,"], fire: ["fire", "fire,"],
  match: ["match", "match,"], rise: ["rise", "rise.", "rise —"],
  map: ["map", "map,"], footprints: ["footprints", "footprints,"],
  river: ["river", "river,"], horizon: ["horizon", "horizon,"],
  wind: ["wind", "wind."], swim: ["swim", "swim."],
  dawn: ["dawn", "dawn,"], cold: ["cold", "cold."],
};
const getVisualMode = (text: string): string[] => {
  const words = text.toLowerCase().split(/\s+/);
  const modes: string[] = [];
  for (const [mode, triggers] of Object.entries(LYRIC_KEYWORDS)) {
    if (words.some(w => triggers.includes(w))) modes.push(mode);
  }
  return modes;
};

/* ── Seeded pseudo-random for consistent particle positions ── */
const seededRandom = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export const StillIRiseV7Composition: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const { audioData, dataOffsetInSeconds } = useWindowedAudioData({ src: staticFile("still-i-rise.mp3"), frame, fps, windowInSeconds: 30 });

  const spectrum = audioData ? visualizeAudio({ fps, frame, audioData, numberOfSamples: 128, optimizeFor: "speed", dataOffsetInSeconds }) : new Array(128).fill(0);
  const waveform = audioData ? visualizeAudioWaveform({ fps, frame, audioData, numberOfSamples: 280, windowInSeconds: 0.6, dataOffsetInSeconds }) : new Array(280).fill(0);

  const bass = spectrum.slice(0, 12).reduce((a, b) => a + b, 0) / 12 || 0;
  const lowMid = spectrum.slice(12, 28).reduce((a, b) => a + b, 0) / 16 || 0;
  const mid = spectrum.slice(28, 52).reduce((a, b) => a + b, 0) / 24 || 0;
  const high = spectrum.slice(52, 80).reduce((a, b) => a + b, 0) / 28 || 0;
  const energy = (bass * 0.4 + lowMid * 0.25 + mid * 0.2 + high * 0.15);

  const t = frame / fps;

  // ─── Timing contract: real analysis data (sections/beats/energy) ───
  const timing = useTimingContract(STILL_I_RISE_TIMING);
  const currentSection = timing.section;
  const sectionType = currentSection?.type || "intro";
  const sectionEnergy = timing.sectionEnergy; // analyzed section energy 0..1
  const contractEnergyScale = timing.contractEnergy; // interpolated curve 0..1
  // Frame-accurate beat proximity from the 336 analyzed beats (0.1 s window).
  const isBeat = timing.isBeat;
  const sinceBeat = timing.sinceBeat;
  // Live spectrum (real-time) blended with analyzed energy curve (structure):
  // spectrum reacts to the actual audio in this frame, the curve guarantees
  // correct macro-dynamics even when windowed FFT data lags.
  const blendedEnergy = clamp(energy * 0.6 + timing.contractEnergy * 0.4, 0, 1);

  const currentLyric = lyrics.find((l) => t >= l.start && t < l.end) ?? lyrics[0];
  const lyricProgress = currentLyric ? (t - currentLyric.start) / (currentLyric.end - currentLyric.start) : 0;
  // ─── Section helpers: canonical palettes + energy-aware intensity ───
  // Palette from sectionHelpers (section-specific colors), intensity blends
  // the section map with the *analyzed* section energy + energy curve so
  // visuals react to the real dynamics of the track.
  const sectionColors = getSectionColors(currentLyric.section);
  const palette = {
    primary: sectionColors.base,
    secondary: sectionColors.energy,
    glow: sectionColors.glow + "b3", // ~70% alpha
    bg: "hsl(230 45% 3%)",
    accent: sectionColors.glow,
    warm: sectionColors.energy,
  };
  const paletteIntensity = getSectionIntensity(currentLyric.section); // 0.4–1.6 map
  const sectionIntensity = clamp(
    0.5 * paletteIntensity + 0.3 * sectionEnergy + 0.2 * contractEnergyScale,
    0.2,
    1.6,
  );
  const isChorus = currentLyric.section.includes("CHORUS");
  const isVerse = currentLyric.section.includes("VERSE");
  const isBridge = currentLyric.section.includes("BRIDGE");
  const isIntro = currentLyric.section.includes("INTRO");

  // ─── Frame-accurate beat pulse (replaces manual `bass > 0.35 && frame % 15` check) ───
  // On the analyzed beat onset the pulse springs from 0; `sinceBeat` keeps the
  // decay phase aligned to the real beat grid instead of an arbitrary mod-15.
  const beatPhase = isBeat ? 0 : sinceBeat;
  const beatPulse = isBeat || sinceBeat < 0.25
    ? spring({
        frame: Math.round(beatPhase * fps),
        fps,
        durationInFrames: 8,
        config: { damping: 12, stiffness: 200, mass: 0.5 },
      })
    : 0;

  // ─── Beat-triggered burst (flash + particle explosion on beat onset) ───
  const beatBurst = isBeat ? 1.0 : Math.max(0, 1 - sinceBeat * 4); // fast decay
  // Downbeat (every 4th beat) gets a bigger burst
  const isDownbeat = isBeat && currentSection && timing.beat?.isDownbeat;
  const downbeatFlash = isDownbeat ? 1.0 : 0;

  const visualModes = getVisualMode(currentLyric.text);
  const hasRain = visualModes.includes("rain") || (isVerse && t < 47);
  const hasFog = visualModes.includes("fog") || (isVerse && t >= 97);
  const hasFire = visualModes.includes("fire") || visualModes.includes("match") || isBridge;
  const hasRise = visualModes.includes("rise") || isChorus;

  let wipeProgress = 0;
  let activeTransition = -1;
  for (let i = 0; i < transitionTimes.length; i++) {
    const s = transitionTimes[i];
    const e = s + 0.9;
    if (t >= s && t < e) { wipeProgress = (t - s) / 0.9; activeTransition = i; break; }
  }
  const wipeX = interpolate(wipeProgress, [0, 1], [-width, width * 2], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_ENTER });

  const words = currentLyric.text.split(" ");

  /* ── Camera movement (dynamic Ken Burns + energy-reactive) ── */
  // Chorus: faster push-in, more shake. Verse: slow drift. Bridge: intimate close-up.
  const camSpeed = isChorus ? 0.08 : isBridge ? 0.02 : 0.04;
  const camZoom = 1.0 + Math.sin(t * camSpeed) * 0.04 + blendedEnergy * 0.06 + (isChorus ? 0.05 : 0);
  const camRotate = Math.sin(t * 0.015) * (isChorus ? 1.5 : 0.6);
  // Parallax offset driven by bass (handheld feel)
  const camPanX = Math.sin(t * 0.07) * 10 + bass * 15;
  const camPanY = Math.cos(t * 0.05) * 8;

  /* ── Aurora (richer, deeper) ── */
  const auroraShift1 = Math.sin(t * 0.06) * 25;
  const auroraShift2 = Math.cos(t * 0.04) * 18;

  /* ── Central element (reactive to beat burst + energy) ── */
  const flameIntensity = hasFire ? 1.0 : hasRise ? 0.85 : isIntro ? 0.4 : 0.6;
  const flameSize = (140 + bass * 80 + blendedEnergy * 60 + beatBurst * 40) * flameIntensity;
  const flameFlicker = Math.sin(t * 8.3) * 0.06 + Math.sin(t * 13.7) * 0.04;
  const flameY = hasRise ? interpolate(lyricProgress, [0, 1], [0, -40], { extrapolateRight: "clamp" }) : 0;
  const flameScale = 1 + bass * 0.25 + beatPulse * 0.15 + beatBurst * 0.1;
  // Color shift on beat (brighter, more saturated)
  const flameHueShift = beatBurst * 20;

  /* ── Fog ── */
  const fogOpacity = hasFog ? 0.35 + high * 0.15 : isVerse ? 0.12 : 0.05;

  /* ── Terrain mesh ── */
  const terrainRows = 12;
  const terrainCols = 40;
  const terrainWidth = width * 1.2;
  const terrainBaseY = height * 0.78;

  /* ── Dense particles (reduced count for memory) ── */
  const particleCount = (isChorus ? 60 : isVerse ? 40 : isBridge ? 35 : 25) + Math.round(beatBurst * 20);
  const particleDirection = hasRise ? -1 : hasRain ? 1 : 0;

  /* ── Light shafts ── */
  const shaftCount = isChorus ? 8 : 5;

  /* ── Vertical spectrum ── */
  const spectrumCount = 48;
  const spectrumBars = spectrum.slice(0, spectrumCount);

  /* ── Transition ── */
  const isTransitioning = activeTransition !== -1;
  const chromaOffset = isTransitioning ? interpolate(wipeProgress, [0, 0.5, 1], [0, 6, 0]) : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "#020408", fontFamily: "'Space Grotesk', sans-serif", overflow: "hidden" }}>
      <Audio src={staticFile("still-i-rise.mp3")} />
      <StudioBackButton />

      {/* ═══ LAYER 1: DEEP BACKGROUND ═══ */}
      <AbsoluteFill style={{ transform: `scale(${camZoom}) rotate(${camRotate}deg) translate(${camPanX}px, ${camPanY}px)`, transformOrigin: "50% 45%" }}>
        {/* Base gradient */}
        <div style={{ position: "absolute", inset: -100, background: `radial-gradient(ellipse 140% 100% at 50% 45%, ${palette.bg} 0%, #020408 60%)` }} />

        {/* Aurora curtains (4 layers with depth) */}
        <div style={{
          position: "absolute", inset: -50,
          background: `linear-gradient(${140 + Math.sin(t * 0.05) * 20}deg, transparent 10%, ${palette.glow} 30%, transparent 50%)`,
          opacity: 0.18 + bass * 0.12,
          transform: `translateX(${auroraShift1}px) translateY(${auroraShift2}px)`,
          filter: "blur(20px)", mixBlendMode: "screen",
        }} />
        <div style={{
          position: "absolute", inset: -50,
          background: `linear-gradient(${220 + Math.cos(t * 0.04) * 15}deg, transparent 15%, ${palette.accent} 35%, transparent 55%)`,
          opacity: 0.12 + mid * 0.08,
          transform: `translateX(${-auroraShift2}px) translateY(${auroraShift1 * 0.7}px)`,
          filter: "blur(25px)", mixBlendMode: "screen",
        }} />
        <div style={{
          position: "absolute", inset: -50,
          background: `radial-gradient(ellipse 100% 60% at ${50 + Math.sin(t * 0.03) * 20}% ${42 + Math.cos(t * 0.02) * 8}%, ${palette.glow} 0%, transparent 55%)`,
          opacity: 0.08 + blendedEnergy * 0.06,
          filter: "blur(30px)", mixBlendMode: "screen",
        }} />
        <div style={{
          position: "absolute", inset: -50,
          background: `conic-gradient(from ${t * 5}deg at 50% 45%, transparent 0deg, ${palette.glow} 30deg, transparent 60deg, ${palette.accent} 120deg, transparent 150deg, ${palette.glow} 240deg, transparent 270deg, ${palette.warm} 330deg, transparent 360deg)`,
          opacity: 0.04 + bass * 0.03,
          filter: "blur(35px)", mixBlendMode: "screen",
        }} />
      </AbsoluteFill>

      {/* ═══ LAYER 1.5: BEAT FLASH (full-screen flash on beat onset) ═══ */}
      {beatBurst > 0.01 && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          <div style={{
            position: "absolute", inset: 0,
            background: `radial-gradient(circle at 50% 45%, ${palette.glow}${Math.round(beatBurst * 40).toString(16).padStart(2, '0')} 0%, transparent 60%)`,
            mixBlendMode: "screen",
          }} />
          {downbeatFlash > 0.5 && (
            <div style={{
              position: "absolute", inset: 0,
              background: `radial-gradient(circle at 50% 45%, rgba(255,255,255,${downbeatFlash * 0.15}) 0%, transparent 40%)`,
            }} />
          )}
        </AbsoluteFill>
      )}

      {/* ═══ LAYER 2: LIGHT SHAFTS (volumetric) ═══ */}
      <AbsoluteFill style={{ pointerEvents: "none", transform: `scale(${camZoom}) rotate(${camRotate}deg)`, transformOrigin: "50% 45%" }}>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          <defs>
            <radialGradient id="shaftGrad" cx="50%" cy="45%" r="60%">
              <stop offset="0%" stopColor={palette.primary} stopOpacity="0.3" />
              <stop offset="100%" stopColor={palette.primary} stopOpacity="0" />
            </radialGradient>
            <filter id="shaftBlur"><feGaussianBlur stdDeviation="8" /></filter>
          </defs>
          {Array.from({ length: shaftCount }).map((_, i) => {
            const angle = (i / shaftCount) * 360 + t * 2;
            const rad = (angle * Math.PI) / 180;
            const cx = width / 2;
            const cy = height * 0.45;
            const length = 500 + blendedEnergy * 300 + Math.sin(t * 0.5 + i) * 80;
            const width2 = 25 + bass * 15 + Math.sin(t * 1.2 + i * 2) * 8;
            const x1 = cx + Math.cos(rad) * (flameSize * 0.4);
            const y1 = cy + Math.sin(rad) * (flameSize * 0.4);
            const x2 = cx + Math.cos(rad) * length;
            const y2 = cy + Math.sin(rad) * length;
            return (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={i % 2 === 0 ? palette.primary : palette.accent}
                strokeWidth={width2}
                opacity={0.06 + blendedEnergy * 0.04 + Math.sin(t * 0.8 + i * 1.5) * 0.02}
                strokeLinecap="round"
                filter="url(#shaftBlur)"
              />
            );
          })}
        </svg>
      </AbsoluteFill>

      {/* ═══ LAYER 3: FOG / ATMOSPHERE ═══ */}
      <AbsoluteFill style={{ pointerEvents: "none", transform: `scale(${camZoom})`, transformOrigin: "50% 45%" }}>
        <div style={{
          position: "absolute", inset: 0,
          background: `radial-gradient(ellipse 180% 120% at 50% 55%, rgba(150,180,210,${fogOpacity}) 0%, transparent 55%)`,
          filter: "blur(40px)", mixBlendMode: "screen",
        }} />
        {hasFog && (
          <div style={{
            position: "absolute", inset: 0,
            background: `linear-gradient(180deg, transparent 20%, rgba(120,150,190,${0.15 + high * 0.08}) 50%, transparent 80%)`,
            filter: "blur(55px)", mixBlendMode: "screen",
            transform: `translateX(${Math.sin(t * 0.15) * 50}px)`,
          }} />
        )}
      </AbsoluteFill>

      {/* ═══ LAYER 4: TERRAIN MESH (3D landscape) ═══ */}
      <AbsoluteFill style={{ pointerEvents: "none", transform: `scale(${camZoom}) rotate(${camRotate}deg) translate(${camPanX}px, ${camPanY}px)`, transformOrigin: "50% 45%" }}>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          <defs>
            <linearGradient id="terrainGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={palette.primary} stopOpacity="0.6" />
              <stop offset="100%" stopColor={palette.secondary} stopOpacity="0.1" />
            </linearGradient>
          </defs>
          {Array.from({ length: terrainRows }).map((_, row) => {
            const rowProgress = row / terrainRows;
            const y = terrainBaseY + row * (height * 0.02);
            const perspective = 0.3 + rowProgress * 0.7;
            const points: string[] = [];
            for (let col = 0; col <= terrainCols; col++) {
              const x = (col / terrainCols) * terrainWidth - (terrainWidth - width) / 2;
              const wavePhase = t * 2 + col * 0.15 + row * 0.3;
              const waveAmp = (15 + bass * 25) * perspective;
              const wave = Math.sin(wavePhase) * waveAmp * Math.sin(col / terrainCols * Math.PI);
              const py = y + wave;
              points.push(`${x},${py}`);
            }
            return (
              <polyline
                key={row}
                points={points.join(" ")}
                fill="none"
                stroke={row % 3 === 0 ? palette.primary : palette.accent}
                strokeWidth={1 + perspective * 1.5}
                opacity={0.15 + perspective * 0.25 + bass * 0.1}
              />
            );
          })}
        </svg>
      </AbsoluteFill>

      {/* ═══ LAYER 5: VERTICAL SPECTRUM BARS ═══ */}
      <AbsoluteFill style={{ pointerEvents: "none", transform: `scale(${camZoom})`, transformOrigin: "50% 45%" }}>
        <div style={{
          position: "absolute",
          bottom: height * 0.12,
          left: width * 0.1,
          right: width * 0.1,
          height: height * 0.25,
          display: "flex",
          alignItems: "flex-end",
          gap: 2,
        }}>
          {spectrumBars.map((val, i) => {
            const barHeight = val * height * 0.22 * sectionIntensity;
            const barWidth = (width * 0.8) / spectrumCount - 2;
            const hue = mapRange(i, 0, spectrumCount, 180, 320);
            return (
              <div key={i} style={{
                width: barWidth,
                height: barHeight,
                background: `linear-gradient(to top, hsla(${hue}, 80%, 60%, 0.7), hsla(${hue}, 80%, 80%, 0.3))`,
                borderRadius: "2px 2px 0 0",
                boxShadow: `0 0 ${4 + val * 8}px hsla(${hue}, 80%, 60%, ${0.3 + val * 0.4})`,
              }} />
            );
          })}
        </div>
      </AbsoluteFill>

      {/* ═══ LAYER 6: DENSE PARTICLE FIELD ═══ */}
      <AbsoluteFill style={{ pointerEvents: "none", transform: `scale(${camZoom})`, transformOrigin: "50% 45%" }}>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          {Array.from({ length: particleCount }).map((_, i) => {
            const seed = i * 1.618;
            const baseX = seededRandom(seed) * width;
            const baseY = seededRandom(seed + 100) * height;
            const size = 1 + seededRandom(seed + 200) * 3;
            const speed = 0.3 + seededRandom(seed + 300) * 0.7;
            const depth = seededRandom(seed + 400); // 0=far, 1=near
            
            const moveX = Math.sin(t * speed + seed) * 30 * depth;
            const moveY = particleDirection * t * 20 * speed + Math.cos(t * speed * 0.5 + seed) * 15;
            const x = (baseX + moveX) % width;
            const y = (baseY + moveY) % height;
            
            const opacity = 0.2 + depth * 0.5 + bass * 0.3;
            const blur = 0; // No blur (performance)
            
            return (
              <circle
                key={i}
                cx={x < 0 ? x + width : x}
                cy={y < 0 ? y + height : y}
                r={size * (0.5 + depth * 0.5)}
                fill={i % 5 === 0 ? palette.warm : palette.accent}
                opacity={opacity}
                filter={blur > 0.5 ? `blur(${blur}px)` : undefined}
              />
            );
          })}
        </svg>
      </AbsoluteFill>

      {/* ═══ LAYER 7: DUAL WAVEFORM ═══ */}
      <AbsoluteFill style={{ pointerEvents: "none", transform: `scale(${camZoom})`, transformOrigin: "50% 45%" }}>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          <defs>
            <filter id="waveGlow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          {/* Lower waveform */}
          <path
            d={`M 0 ${height * 0.88} ${waveform.slice(0, 140).map((v, i) => `L ${(i / 140) * width} ${height * 0.88 + v * height * 0.08}`).join(" ")} L ${width} ${height * 0.88}`}
            fill="none" stroke={palette.primary} strokeWidth="2" opacity="0.5" filter="url(#waveGlow)"
          />
          {/* Upper mirrored waveform */}
          <path
            d={`M 0 ${height * 0.22} ${waveform.slice(0, 140).map((v, i) => `L ${(i / 140) * width} ${height * 0.22 - v * height * 0.05}`).join(" ")} L ${width} ${height * 0.22}`}
            fill="none" stroke={palette.accent} strokeWidth="1.5" opacity="0.3" filter="url(#waveGlow)"
          />
        </svg>
      </AbsoluteFill>

      {/* ═══ LAYER 8: CENTRAL FLAME + RINGS ═══ */}
      <AbsoluteFill style={{ pointerEvents: "none", transform: `scale(${camZoom}) rotate(${camRotate}deg) translate(${camPanX}px, ${camPanY}px)`, transformOrigin: "50% 45%" }}>
        <div style={{
          position: "absolute",
          left: "50%",
          top: "45%",
          transform: `translate(-50%, -50%) translateY(${flameY}px) scale(${flameScale})`,
        }}>
          {/* Energy field */}
          <div style={{
            position: "absolute",
            width: flameSize * 2.5,
            height: flameSize * 2.5,
            left: -flameSize * 1.25,
            top: -flameSize * 1.25,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${palette.glow} 0%, transparent 70%)`,
            opacity: 0.15 + energy * 0.1,
            filter: "blur(20px)",
          }} />
          
          {/* SVG rings */}
          <svg width={flameSize * 3} height={flameSize * 3} style={{ position: "absolute", left: -flameSize * 1.5, top: -flameSize * 1.5 }}>
            <defs>
              <filter id="ringGlow"><feGaussianBlur stdDeviation="2" /></filter>
            </defs>
            {[0, 1, 2].map((i) => {
              const r = flameSize * (0.6 + i * 0.25);
              const rotation = t * (15 + i * 8) * (i % 2 === 0 ? 1 : -1);
              const dashOffset = t * 30 * (i % 2 === 0 ? 1 : -1);
              return (
                <g key={i} transform={`rotate(${rotation} ${flameSize * 1.5} ${flameSize * 1.5})`}>
                  <circle
                    cx={flameSize * 1.5} cy={flameSize * 1.5} r={r}
                    fill="none"
                    stroke={i === 0 ? palette.primary : i === 1 ? palette.accent : palette.warm}
                    strokeWidth={1.5 + bass * 1}
                    strokeDasharray={`${10 + i * 5} ${15 + i * 8}`}
                    strokeDashoffset={dashOffset}
                    opacity={0.4 + energy * 0.3}
                    filter="url(#ringGlow)"
                  />
                </g>
              );
            })}
          </svg>
          
          {/* Central orb */}
          <div style={{
            width: flameSize * 2,
            height: flameSize * 2,
            borderRadius: "50%",
            background: `radial-gradient(circle at 40% 40%, ${palette.warm} 0%, ${palette.primary} 40%, ${palette.secondary} 70%, transparent 100%)`,
            boxShadow: `0 0 ${30 + bass * 40}px ${palette.glow}, 0 0 ${60 + bass * 60}px ${palette.primary}40`,
            opacity: 0.9 + flameFlicker,
            transform: `scale(${1 + beatPulse * 0.1})`,
          }} />
        </div>
      </AbsoluteFill>

      {/* ═══ LAYER 9: LYRIC TEXT ═══ */}
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{
          position: "absolute",
          top: "12%",
          left: "10%",
          right: "10%",
          textAlign: "center",
        }}>
          <div style={{
            fontSize: isChorus ? 52 : isBridge ? 42 : 36,
            fontWeight: isChorus ? 700 : 500,
            color: "#fff",
            textShadow: `0 0 20px ${palette.glow}, 0 0 40px ${palette.primary}40`,
            lineHeight: 1.4,
            letterSpacing: "0.02em",
          }}>
            {words.map((word, i) => {
              const wordProgress = interpolate(lyricProgress, [i / words.length, (i + 1) / words.length], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
              const wordOpacity = interpolate(wordProgress, [0, 0.3, 0.7, 1], [0.3, 1, 1, 0.6]);
              const wordScale = interpolate(wordProgress, [0, 0.5, 1], [0.95, 1.05, 1]);
              return (
                <span key={i} style={{
                  display: "inline-block",
                  opacity: wordOpacity,
                  transform: `scale(${wordScale})`,
                  margin: "0 6px",
                }}>
                  {word}
                </span>
              );
            })}
          </div>
        </div>
      </AbsoluteFill>

      {/* ═══ LAYER 10: SCANLINES + VIGNETTE + CHROMATIC ═══ */}
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {/* Scanlines */}
        <div style={{
          position: "absolute", inset: 0,
          background: `repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)`,
          opacity: 0.4,
        }} />
        {/* Deep vignette */}
        <div style={{
          position: "absolute", inset: 0,
          background: `radial-gradient(ellipse 70% 65% at 50% 50%, transparent 0%, rgba(0,0,0,0.6) 100%)`,
        }} />
        {/* Chromatic aberration on transitions */}
        {isTransitioning && (
          <div style={{
            position: "absolute", inset: 0,
            boxShadow: `inset ${chromaOffset}px 0 0 rgba(255,0,0,0.1), inset ${-chromaOffset}px 0 0 rgba(0,0,255,0.1)`,
          }} />
        )}
      </AbsoluteFill>

      {/* ═══ LAYER 12: TRANSITION WIPE ═══ */}
      {activeTransition !== -1 && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          <div style={{
            position: "absolute", inset: 0,
            background: `linear-gradient(100deg, transparent 40%, ${palette.glow} 48%, white 50%, ${palette.glow} 52%, transparent 60%)`,
            opacity: interpolate(wipeProgress, [0, 0.5, 1], [0, 0.25, 0]),
            transform: `translateX(${wipeX - width}px)`,
          }} />
        </AbsoluteFill>
      )}

      {/* ═══ LAYER 13: SECTION INDICATOR ═══ */}
      <div style={{
        position: "absolute",
        bottom: 20,
        left: 20,
        fontSize: 11,
        color: palette.primary,
        opacity: 0.5,
        fontFamily: "monospace",
      }}>
        {sectionType.toUpperCase()} | {Math.round(sectionIntensity * 100)}% | {Math.round(bass * 100)}b
      </div>
    </AbsoluteFill>
  );
};

export const StillIRiseV7Duration = DURATION_FRAMES;
export const StillIRiseV7Fps = FPS;
