import { Audio, AbsoluteFill, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { visualizeAudio, visualizeAudioWaveform, useWindowedAudioData } from "@remotion/media-utils";
import { StudioBackButton } from "./components/StudioBackButton";

const FPS = 30;
const DURATION_SECONDS = 234;
const DURATION_FRAMES = FPS * DURATION_SECONDS;

interface LyricLine { start: number; end: number; text: string; section: string; }

const lyricBlocks = [
  { start: 0, end: 18, section: "INTRO", lines: ["Midnight hums in shades of blue", "A map unwritten, waiting to be drawn anew"] },
  { start: 18, end: 47, section: "VERSE 01", lines: ["I walk where the streetlight loses its name", "Learning the language of a different rain", "Each wrong turn leaves a mark on my sleeve", "Proof of the roads I was scared to believe"] },
  { start: 47, end: 67, section: "VERSE 01", lines: ["The horizon moves, so I move with it too", "Past all the rules that never came true", "I wear the unknown like a second skin", "Keeping one small match alive in the wind"] },
  { start: 67, end: 88, section: "CHORUS", lines: ["Still I rise before the fade", "Still I chase the light I made", "Out on the edge where tomorrow waits", "I'm becoming what tomorrow makes"] },
  { start: 97, end: 115, section: "VERSE 02", lines: ["Deep in the fog, I found a steadier hand", "Every river redrew where I stand", "I keep small hours like coins in my coat", "Warm from the crossing, enough to stay afloat"] },
  { start: 115, end: 124, section: "VERSE 02", lines: ["They watched from the shore while I learned to swim", "Now even the tide has changed its hymn", "Softer than thunder, clear as the glass", "I build what will stay when the old days pass"] },
  { start: 124, end: 145, section: "CHORUS", lines: ["Still I rise before the fade", "Still I chase the light I made", "Out on the edge where tomorrow waits", "I'm becoming what tomorrow makes"] },
  { start: 145, end: 179, section: "BRIDGE", lines: ["I thought the map had to tell me where", "But dawn found my footprints already there", "No finish line, no hand to hold", "Just my own fire against the cold"] },
  { start: 179, end: 204, section: "BRIDGE", lines: ["No finish line, no hand to hold", "Just my own fire against the cold", "I thought the map had to tell me where", "But dawn found my footprints already there"] },
  { start: 204, end: 231, section: "FINAL CHORUS", lines: ["Still I rise before the fade", "Still I chase the light I made", "Out on the edge where tomorrow waits", "I'm becoming what tomorrow makes", "Still I rise — still I rise"] },
];
const lyrics: LyricLine[] = lyricBlocks.flatMap((b) => {
  const per = (b.end - b.start) / b.lines.length;
  return b.lines.map((text, i) => ({ start: b.start + i * per, end: b.start + (i + 1) * per, text, section: b.section }));
});
const transitionTimes = [67, 124, 145, 204];

const PALETTE = {
  chorus: { primary: "#a855f7", secondary: "#7c3aed", glow: "hsla(270,90%,65%,0.8)", bg: "hsl(270 60% 5%)", accent: "#c084fc", warm: "#e879f9" },
  verse: { primary: "#38bdf8", secondary: "#0ea5e9", glow: "hsla(199,90%,60%,0.7)", bg: "hsl(210 50% 4%)", accent: "#7dd3fc", warm: "#34d399" },
  bridge: { primary: "#f59e0b", secondary: "#d97706", glow: "hsla(38,92%,55%,0.7)", bg: "hsl(35 50% 4%)", accent: "#fcd34d", warm: "#fb923c" },
  intro: { primary: "#06b6d4", secondary: "#0891b2", glow: "hsla(189,90%,50%,0.6)", bg: "hsl(195 50% 3%)", accent: "#67e8f9", warm: "#22d3ee" },
};
const getSectionPalette = (section: string) => {
  if (section.includes("FINAL CHORUS")) return PALETTE.chorus;
  if (section.includes("CHORUS")) return PALETTE.chorus;
  if (section.includes("BRIDGE")) return PALETTE.bridge;
  if (section.includes("INTRO")) return PALETTE.intro;
  return PALETTE.verse;
};

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

export const StillIRiseComposition: React.FC = () => {
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
  const progress = frame / DURATION_FRAMES;
  const currentLyric = lyrics.find((l) => t >= l.start && t < l.end) ?? lyrics[0];
  const lyricProgress = currentLyric ? (t - currentLyric.start) / (currentLyric.end - currentLyric.start) : 0;
  const palette = getSectionPalette(currentLyric.section);
  const isChorus = currentLyric.section.includes("CHORUS");
  const isVerse = currentLyric.section.includes("VERSE");
  const isBridge = currentLyric.section.includes("BRIDGE");
  const isIntro = currentLyric.section.includes("INTRO");
  const isFinal = currentLyric.section.includes("FINAL");

  const beatPulse = bass > 0.35 ? spring({ frame: frame % 15, fps, config: { damping: 12, stiffness: 200, mass: 0.5 } }) : 0;
  const sectionIntensity = isChorus ? 1.0 : isBridge ? 0.85 : isIntro ? 0.5 : 0.75;

  const visualModes = getVisualMode(currentLyric.text);
  const hasRain = visualModes.includes("rain") || (isVerse && t < 47);
  const hasFog = visualModes.includes("fog") || (isVerse && t >= 97);
  const hasFire = visualModes.includes("fire") || visualModes.includes("match") || isBridge;
  const hasRise = visualModes.includes("rise") || isChorus;
  const hasMap = visualModes.includes("map") || isIntro || (isVerse && t < 30);
  const hasHorizon = visualModes.includes("horizon") || (isVerse && t >= 47 && t < 67);
  const hasRiver = visualModes.includes("river") || (isVerse && t >= 97 && t < 115);
  const hasDawn = visualModes.includes("dawn") || (isBridge && t >= 195);

  let wipeProgress = 0;
  let activeTransition = -1;
  for (let i = 0; i < transitionTimes.length; i++) {
    const s = transitionTimes[i];
    const e = s + 0.9;
    if (t >= s && t < e) { wipeProgress = (t - s) / 0.9; activeTransition = i; break; }
  }
  const wipeX = interpolate(wipeProgress, [0, 1], [-width, width * 2], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_ENTER });

  const words = currentLyric.text.split(" ");

  /* ── Camera movement (subtle zoom + rotation) ── */
  const camZoom = 1.0 + Math.sin(t * 0.04) * 0.02 + energy * 0.03;
  const camRotate = Math.sin(t * 0.015) * 0.8;

  /* ── Aurora (richer, deeper) ── */
  const auroraHue = interpolate(energy, [0, 1], [180, 280]);
  const auroraShift1 = Math.sin(t * 0.06) * 25;
  const auroraShift2 = Math.cos(t * 0.04) * 18;

  /* ── Central element ── */
  const flameIntensity = hasFire ? 1.0 : hasRise ? 0.85 : isIntro ? 0.4 : 0.6;
  const flameSize = (140 + bass * 80 + energy * 60) * flameIntensity;
  const flameFlicker = Math.sin(t * 8.3) * 0.06 + Math.sin(t * 13.7) * 0.04;
  const flameY = hasRise ? interpolate(lyricProgress, [0, 1], [0, -40], { extrapolateRight: "clamp" }) : 0;
  const flameScale = 1 + bass * 0.25 + beatPulse * 0.15;

  /* ── Fog ── */
  const fogOpacity = hasFog ? 0.35 + high * 0.15 : isVerse ? 0.12 : 0.05;

  /* ── Terrain mesh ── */
  const terrainRows = 12;
  const terrainCols = 40;
  const terrainWidth = width * 1.2;
  const terrainBaseY = height * 0.78;

  /* ── Dense particles ── */
  const particleCount = isChorus ? 120 : isVerse ? 90 : isBridge ? 80 : 50;
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
      <AbsoluteFill style={{ transform: `scale(${camZoom}) rotate(${camRotate}deg)`, transformOrigin: "50% 45%" }}>
        {/* Base gradient */}
        <div style={{ position: "absolute", inset: -100, background: `radial-gradient(ellipse 140% 100% at 50% 45%, ${palette.bg} 0%, #020408 60%)` }} />

        {/* Aurora curtains (4 layers with depth) */}
        <div style={{
          position: "absolute", inset: -50,
          background: `linear-gradient(${140 + Math.sin(t * 0.05) * 20}deg, transparent 10%, ${palette.glow} 30%, transparent 50%)`,
          opacity: 0.18 + bass * 0.12,
          transform: `translateX(${auroraShift1}px) translateY(${auroraShift2}px)`,
          filter: "blur(60px)", mixBlendMode: "screen",
        }} />
        <div style={{
          position: "absolute", inset: -50,
          background: `linear-gradient(${220 + Math.cos(t * 0.04) * 15}deg, transparent 15%, ${palette.accent} 35%, transparent 55%)`,
          opacity: 0.12 + mid * 0.08,
          transform: `translateX(${-auroraShift2}px) translateY(${auroraShift1 * 0.7}px)`,
          filter: "blur(80px)", mixBlendMode: "screen",
        }} />
        <div style={{
          position: "absolute", inset: -50,
          background: `radial-gradient(ellipse 100% 60% at ${50 + Math.sin(t * 0.03) * 20}% ${42 + Math.cos(t * 0.02) * 8}%, ${palette.glow} 0%, transparent 55%)`,
          opacity: 0.08 + energy * 0.06,
          filter: "blur(100px)", mixBlendMode: "screen",
        }} />
        <div style={{
          position: "absolute", inset: -50,
          background: `conic-gradient(from ${t * 5}deg at 50% 45%, transparent 0deg, ${palette.glow} 30deg, transparent 60deg, ${palette.accent} 120deg, transparent 150deg, ${palette.glow} 240deg, transparent 270deg, ${palette.warm} 330deg, transparent 360deg)`,
          opacity: 0.04 + bass * 0.03,
          filter: "blur(130px)", mixBlendMode: "screen",
        }} />
      </AbsoluteFill>

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
            const length = 500 + energy * 300 + Math.sin(t * 0.5 + i) * 80;
            const width2 = 25 + bass * 15 + Math.sin(t * 1.2 + i * 2) * 8;
            const x1 = cx + Math.cos(rad) * (flameSize * 0.4);
            const y1 = cy + Math.sin(rad) * (flameSize * 0.4);
            const x2 = cx + Math.cos(rad) * length;
            const y2 = cy + Math.sin(rad) * length;
            return (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={i % 2 === 0 ? palette.primary : palette.accent}
                strokeWidth={width2}
                opacity={0.06 + energy * 0.04 + Math.sin(t * 0.8 + i * 1.5) * 0.02}
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
      <AbsoluteFill style={{ pointerEvents: "none", transform: `scale(${camZoom}) rotate(${camRotate}deg)`, transformOrigin: "50% 45%" }}>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          <defs>
            <linearGradient id="terrainFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={palette.primary} stopOpacity="0.25" />
              <stop offset="60%" stopColor={palette.secondary} stopOpacity="0.08" />
              <stop offset="100%" stopColor="#020408" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="terrainStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={palette.primary} stopOpacity="0.1" />
              <stop offset="50%" stopColor={palette.accent} stopOpacity="0.5" />
              <stop offset="100%" stopColor={palette.primary} stopOpacity="0.1" />
            </linearGradient>
          </defs>
          {Array.from({ length: terrainRows }).map((_, row) => {
            const rowProgress = row / (terrainRows - 1);
            const perspectiveScale = 0.3 + rowProgress * 0.7;
            const yBase = terrainBaseY + row * 18 * perspectiveScale;
            const amplitude = (15 + bass * 25) * perspectiveScale;
            const points: string[] = [];
            const fillPoints: string[] = [];
            for (let col = 0; col <= terrainCols; col++) {
              const colProgress = col / terrainCols;
              const x = (colProgress - 0.5) * terrainWidth;
              const screenX = width / 2 + x * perspectiveScale;
              const wave1 = Math.sin(colProgress * 6 + t * 1.5 + row * 0.4) * amplitude;
              const wave2 = Math.sin(colProgress * 10 + t * 0.8 + row * 0.7) * amplitude * 0.4;
              const audioWave = (spectrum[Math.floor(colProgress * 64)] || 0) * amplitude * 1.5;
              const y = yBase + wave1 + wave2 - audioWave;
              points.push(`${col === 0 ? "M" : "L"}${screenX},${y}`);
              fillPoints.push(`${col === 0 ? "M" : "L"}${screenX},${y}`);
            }
            fillPoints.push(`L${width / 2 + terrainWidth * 0.6},${height + 20}`);
            fillPoints.push(`L${width / 2 - terrainWidth * 0.6},${height + 20}`);
            fillPoints.push("Z");
            const lineOpacity = 0.12 + rowProgress * 0.3 + bass * 0.1;
            return (
              <g key={row}>
                <path d={fillPoints.join(" ")} fill="url(#terrainFill)" opacity={lineOpacity * 0.4} />
                <path d={points.join(" ")} fill="none" stroke="url(#terrainStroke)"
                  strokeWidth={0.8 + perspectiveScale * 0.6}
                  opacity={lineOpacity}
                />
              </g>
            );
          })}
        </svg>
      </AbsoluteFill>

      {/* ═══ LAYER 5: VERTICAL SPECTRUM (perspective) ═══ */}
      <AbsoluteFill style={{ pointerEvents: "none", transform: `scale(${camZoom})`, transformOrigin: "50% 45%" }}>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          <defs>
            <filter id="barGlow"><feGaussianBlur stdDeviation="3" result="blur" /><feComposite in="SourceGraphic" in2="blur" operator="over" /></filter>
          </defs>
          {spectrumBars.map((v, i) => {
            const x = (i / spectrumCount) * width;
            const barHeight = v * height * 0.35 * sectionIntensity;
            const barWidth = width / spectrumCount * 0.65;
            const hue = interpolate(i, [0, spectrumCount], [185, 310]);
            const lightness = 50 + v * 25;
            const barOpacity = 0.4 + v * 0.4;
            return (
              <g key={i}>
                {/* Main bar */}
                <rect
                  x={x + barWidth * 0.175}
                  y={terrainBaseY - barHeight}
                  width={barWidth}
                  height={barHeight}
                  rx={barWidth * 0.3}
                  fill={`hsl(${hue} 75% ${lightness}%)`}
                  opacity={barOpacity}
                  filter="url(#barGlow)"
                />
                {/* Reflection */}
                <rect
                  x={x + barWidth * 0.175}
                  y={terrainBaseY}
                  width={barWidth}
                  height={barHeight * 0.3}
                  rx={barWidth * 0.3}
                  fill={`hsl(${hue} 75% ${lightness}%)`}
                  opacity={barOpacity * 0.15}
                />
              </g>
            );
          })}
        </svg>
      </AbsoluteFill>

      {/* ═══ LAYER 6: DENSE PARTICLE FIELD ═══ */}
      <AbsoluteFill style={{ pointerEvents: "none", transform: `scale(${camZoom})`, transformOrigin: "50% 45%" }}>
        {Array.from({ length: particleCount }).map((_, i) => {
          const seed = i * 137.508;
          const depthLayer = seededRandom(seed + 0.1); // 0=far, 1=near
          const size = 1.5 + depthLayer * 4 + seededRandom(seed + 0.2) * 2;
          const opacity = (0.15 + depthLayer * 0.4 + energy * 0.15) * sectionIntensity;
          const blur = (1 - depthLayer) * 3; // far particles are blurrier
          const speed = 0.3 + depthLayer * 1.5;

          let px: number, py: number;
          if (particleDirection === -1) {
            const baseY = seededRandom(seed + 0.3) * height;
            py = ((baseY + (t - 180) * speed * 30) % (height + 100)) - 50;
            px = seededRandom(seed + 0.4) * width + Math.sin(t * 0.3 + seed) * 20;
          } else if (particleDirection === 1) {
            const baseY = seededRandom(seed + 0.3) * height;
            py = ((baseY + t * speed * 40) % (height + 100)) - 50;
            px = seededRandom(seed + 0.4) * width + Math.sin(t * 0.2 + seed) * 15;
          } else {
            px = seededRandom(seed + 0.4) * width + Math.cos(t * 0.2 + seed * 0.5) * (15 + depthLayer * 10);
            py = seededRandom(seed + 0.3) * height + Math.sin(t * 0.25 + seed) * (10 + depthLayer * 8);
          }

          const isWarm = hasFire || isBridge;
          const hue = isWarm ? 30 + seededRandom(seed + 0.5) * 25 : 185 + seededRandom(seed + 0.5) * 40;

          return (
            <div key={i} style={{
              position: "absolute", left: px - size / 2, top: py - size / 2,
              width: size, height: size, borderRadius: "50%",
              backgroundColor: `hsla(${hue}, 75%, 70%, ${opacity})`,
              boxShadow: `0 0 ${4 + bass * 3}px hsla(${hue}, 70%, 60%, ${opacity * 0.5})`,
              filter: blur > 0.5 ? `blur(${blur}px)` : undefined,
            }} />
          );
        })}
      </AbsoluteFill>

      {/* ═══ LAYER 7: CENTRAL ELEMENT (organic, layered) ═══ */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", pointerEvents: "none", transform: `scale(${camZoom})`, transformOrigin: "50% 45%" }}>
        {/* Outer energy field */}
        <div style={{
          position: "absolute", width: flameSize * 4, height: flameSize * 4, borderRadius: "50%",
          background: `radial-gradient(circle, ${palette.glow} 0%, transparent 55%)`,
          opacity: (0.12 + bass * 0.08) * flameIntensity,
          filter: "blur(60px)", mixBlendMode: "screen",
          transform: `scale(${flameScale}) translateY(${flameY}px)`,
        }} />
        {/* Rotating rings */}
        <svg width={flameSize * 3} height={flameSize * 3} style={{
          position: "absolute",
          opacity: (0.2 + mid * 0.15) * flameIntensity,
          transform: `scale(${flameScale}) translateY(${flameY}px)`,
        }}>
          <circle cx={flameSize * 1.5} cy={flameSize * 1.5} r={flameSize * 0.8}
            fill="none" stroke={palette.primary} strokeWidth={1}
            strokeDasharray="8 12" opacity={0.4}
            transform={`rotate(${t * 15} ${flameSize * 1.5} ${flameSize * 1.5})`}
          />
          <circle cx={flameSize * 1.5} cy={flameSize * 1.5} r={flameSize * 1.1}
            fill="none" stroke={palette.accent} strokeWidth={0.8}
            strokeDasharray="5 18" opacity={0.3}
            transform={`rotate(${-t * 10} ${flameSize * 1.5} ${flameSize * 1.5})`}
          />
        </svg>
        {/* Mid glow */}
        <div style={{
          position: "absolute", width: flameSize * 2.2, height: flameSize * 2.2, borderRadius: "50%",
          background: `radial-gradient(circle at 48% 42%, ${palette.primary}99 0%, ${palette.secondary}44 40%, transparent 70%)`,
          opacity: (0.5 + bass * 0.2) * flameIntensity,
          filter: "blur(20px)", mixBlendMode: "screen",
          transform: `scale(${flameScale * (1 + flameFlicker * 0.3)}) translateY(${flameY}px)`,
        }} />
        {/* Core */}
        <div style={{
          position: "absolute", width: flameSize, height: flameSize * 1.2,
          borderRadius: `${47 + Math.sin(t * 11) * 5}% ${53 + Math.sin(t * 7.3) * 4}% ${49 + Math.sin(t * 15) * 6}% ${51 + Math.sin(t * 9.1) * 5}%`,
          background: `radial-gradient(ellipse at 48% 42%, rgba(255,255,255,0.95) 0%, ${palette.primary} 20%, ${palette.secondary}55 50%, transparent 75%)`,
          opacity: (0.8 + bass * 0.15) * flameIntensity,
          transform: `scale(${flameScale}) translateY(${flameY}px)`,
          boxShadow: `0 0 ${40 + bass * 30}px ${palette.glow}, 0 0 ${80 + bass * 60}px ${palette.glow}`,
        }} />
        {/* Inner bright */}
        <div style={{
          position: "absolute", width: flameSize * 0.2, height: flameSize * 0.2, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.98) 0%, transparent 60%)",
          opacity: (0.7 + high * 0.3) * flameIntensity,
          transform: `translateY(${flameY - 6}px)`,
        }} />
        {/* Beat pulse */}
        {beatPulse > 0.01 && (
          <div style={{
            position: "absolute", width: flameSize * 2.5, height: flameSize * 2.5, borderRadius: "50%",
            border: `1.5px solid ${palette.primary}`,
            opacity: interpolate(beatPulse, [0, 1], [0.5, 0]),
            transform: `scale(${1 + beatPulse * 0.8}) translateY(${flameY}px)`,
            boxShadow: `0 0 12px ${palette.glow}`,
          }} />
        )}
      </AbsoluteFill>

      {/* ═══ LAYER 8: HORIZON LINE ═══ */}
      {hasHorizon && (
        <AbsoluteFill style={{ pointerEvents: "none", transform: `scale(${camZoom})`, transformOrigin: "50% 45%" }}>
          <div style={{
            position: "absolute", left: 0, right: 0, top: terrainBaseY - 2, height: 2,
            background: `linear-gradient(90deg, transparent 5%, ${palette.primary}88 25%, ${palette.primary}dd 50%, ${palette.primary}88 75%, transparent 95%)`,
            opacity: 0.7 + bass * 0.2,
            boxShadow: `0 0 25px ${palette.glow}, 0 0 80px ${palette.glow}`,
          }} />
        </AbsoluteFill>
      )}

      {/* ═══ LAYER 9: RIVER WAVES ═══ */}
      {hasRiver && (
        <AbsoluteFill style={{ pointerEvents: "none", transform: `scale(${camZoom})`, transformOrigin: "50% 45%" }}>
          <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
            {Array.from({ length: 5 }).map((_, i) => {
              const yBase = terrainBaseY - 60 - i * 18;
              const points = Array.from({ length: 60 }).map((_, j) => {
                const x = (j / 59) * width;
                const y = yBase + Math.sin(x * 0.005 + t * (0.6 + i * 0.1) + i * 1.2) * (12 + i * 3);
                return `${j === 0 ? "M" : "L"}${x},${y}`;
              }).join(" ");
              return (
                <path key={i} d={points} fill="none" stroke={palette.primary}
                  strokeWidth={2 - i * 0.3} opacity={0.3 - i * 0.04}
                  strokeLinecap="round" filter={`blur(${i * 0.4}px)`}
                />
              );
            })}
          </svg>
        </AbsoluteFill>
      )}

      {/* ═══ LAYER 10: TRACE LINES ═══ */}
      {hasMap && (
        <AbsoluteFill style={{ pointerEvents: "none", transform: `scale(${camZoom})`, transformOrigin: "50% 45%" }}>
          <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
            {Array.from({ length: 10 }).map((_, i) => {
              const yBase = height * 0.2 + (i / 10) * height * 0.4;
              const dashOffset = interpolate(progress, [0, 1], [3000, 0], { extrapolateRight: "clamp" });
              const points = Array.from({ length: 40 }).map((_, j) => {
                const x = (j / 39) * width;
                const y = yBase + Math.sin(x * 0.003 + t * 0.2 + i * 0.7) * (15 + (i % 3) * 8);
                return `${j === 0 ? "M" : "L"}${x},${y}`;
              }).join(" ");
              return (
                <path key={i} d={points} fill="none" stroke={palette.primary}
                  strokeWidth={0.6 + (i % 2) * 0.3}
                  opacity={0.08 + (i % 3) * 0.03}
                  strokeDasharray="3000" strokeDashoffset={dashOffset}
                />
              );
            })}
          </svg>
        </AbsoluteFill>
      )}

      {/* ═══ LAYER 11: WAVEFORM (dual, deeper) ═══ */}
      <AbsoluteFill style={{ pointerEvents: "none", transform: `scale(${camZoom})`, transformOrigin: "50% 45%" }}>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          <defs>
            <linearGradient id="waveGradLower" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={palette.primary} stopOpacity="0.1" />
              <stop offset="50%" stopColor={palette.accent} stopOpacity="0.6" />
              <stop offset="100%" stopColor={palette.primary} stopOpacity="0.1" />
            </linearGradient>
            <linearGradient id="waveGradUpper" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={palette.warm} stopOpacity="0.05" />
              <stop offset="50%" stopColor={palette.warm} stopOpacity="0.35" />
              <stop offset="100%" stopColor={palette.warm} stopOpacity="0.05" />
            </linearGradient>
          </defs>
          {/* Lower waveform */}
          <path d={`M0,${terrainBaseY + 35} ` + waveform.map((v, i) => `L${(i / waveform.length) * width},${terrainBaseY + 35 + v * height * 0.12 * sectionIntensity}`).join(" ")} fill="none" stroke="url(#waveGradLower)" strokeWidth={2.5} opacity={0.6 + energy * 0.3} />
          {/* Upper waveform (mirrored, fainter) */}
          <path d={`M0,${height * 0.22} ` + waveform.map((v, i) => `L${(i / waveform.length) * width},${height * 0.22 - v * height * 0.08 * sectionIntensity}`).join(" ")} fill="none" stroke="url(#waveGradUpper)" strokeWidth={1.8} opacity={0.35 + energy * 0.2} />
        </svg>
      </AbsoluteFill>

      {/* ═══ LAYER 12: LYRIC TYPOGRAPHY ═══ */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", pointerEvents: "none", transform: `scale(${camZoom})`, transformOrigin: "50% 45%" }}>
        <div style={{ position: "relative", width: width * 0.72, textAlign: "center", marginTop: -height * 0.08 }}>
          <div style={{
            fontSize: isChorus ? 46 : 34, fontWeight: 700,
            color: "white", letterSpacing: "0.02em", lineHeight: 1.4,
            textShadow: `0 0 30px ${palette.glow}, 0 0 60px ${palette.glow}, 0 3px 10px rgba(0,0,0,0.6)`,
          }}>
            {words.map((word, i) => {
              const wordStart = i / words.length;
              const wordVisible = lyricProgress >= wordStart;
              const wordOpacity = wordVisible ? interpolate(lyricProgress, [wordStart, wordStart + 0.08], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
              return (
                <span key={i} style={{
                  opacity: wordOpacity, display: "inline-block", marginRight: 10,
                  transform: wordVisible ? "translateY(0)" : "translateY(8px)",
                }}>
                  {word}
                </span>
              );
            })}
          </div>
          <div style={{
            fontSize: 12, fontWeight: 400, letterSpacing: "0.18em",
            color: palette.primary, marginTop: 16, textTransform: "uppercase",
            opacity: interpolate(lyricProgress, [0, 0.05, 0.9, 1], [0, 0.7, 0.7, 0]),
            textShadow: `0 0 12px ${palette.glow}`,
          }}>
            {currentLyric.section}
          </div>
        </div>
      </AbsoluteFill>

      {/* ═══ LAYER 13: TRANSITION WIPE ═══ */}
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

      {/* ═══ LAYER 14: POST-PROCESSING ═══ */}
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {/* Deep vignette */}
        <div style={{
          position: "absolute", inset: 0,
          background: `radial-gradient(ellipse 60% 55% at 50% 48%, transparent 40%, rgba(0,0,0,0.7) 100%)`,
        }} />
        {/* Film grain */}
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E")`,
          opacity: 0.35 + bass * 0.1,
          mixBlendMode: "overlay",
        }} />
        {/* Letterbox */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 16, background: "rgba(0,0,0,0.8)", opacity: isChorus ? 0.2 : 0.7 }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 16, background: "rgba(0,0,0,0.8)", opacity: isChorus ? 0.2 : 0.7 }} />
        {/* Chromatic aberration on transitions */}
        {isTransitioning && chromaOffset > 0.5 && (
          <>
            <div style={{ position: "absolute", inset: 0, background: "rgba(255,0,50,0.04)", transform: `translateX(${chromaOffset}px)`, mixBlendMode: "screen" }} />
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,50,255,0.04)", transform: `translateX(${-chromaOffset}px)`, mixBlendMode: "screen" }} />
          </>
        )}
        {/* Scanline overlay */}
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: "repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)",
          opacity: 0.4,
        }} />
      </AbsoluteFill>

      {/* ═══ LAYER 15: FOOTER ═══ */}
      <div style={{
        position: "absolute", bottom: 5, left: 0, right: 0, textAlign: "center",
        fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: "0.14em",
        color: "rgba(255,255,255,0.2)", pointerEvents: "none",
      }}>
        REMOTION • 97.5 BPM • Bb MAJOR • TERRAIN • DEPTH
      </div>
    </AbsoluteFill>
  );
};

export const StillIRiseDuration = DURATION_FRAMES;
export const StillIRiseFps = FPS;
