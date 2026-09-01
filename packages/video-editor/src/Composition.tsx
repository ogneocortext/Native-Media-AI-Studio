/* eslint-disable @remotion/no-background-image, @remotion/non-pure-animation */
import {
  AbsoluteFill, Audio, Img, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig, Easing, Composition
} from "remotion";
import {
  useWindowedAudioData, visualizeAudio, visualizeAudioWaveform,
  createSmoothSvgPath
} from "@remotion/media-utils";
import { ThreeCanvas } from "@remotion/three";
import React from "react";

// ─────────────────────────────────────────────────────────────
// Professional Music Video Composition
// Clean, minimal, audio-reactive with cinematic feel
// ─────────────────────────────────────────────────────────────

const FPS = 30;
const DURATION_SECONDS = 242.32;
const DURATION_FRAMES = Math.ceil(DURATION_SECONDS * FPS);

// ─── Color System ───
const COLORS = {
  background: "#050508",
  primary: "#e8e4df",      // Warm white
  secondary: "#9a8f84",    // Muted gold
  accent: "#c8a87c",       // Antique gold
  glow: "#d4af37",         // Rich gold
  dark: "#0a0808",         // Near black
  mid: "#1a1614",          // Dark warm
};

// ─── Typography ───
const FONTS = {
  display: "'Space Grotesk', 'Inter', system-ui, sans-serif",
  mono: "'DM Mono', 'JetBrains Mono', monospace",
  body: "'Inter', system-ui, sans-serif",
};

// ─── Lyric Data ───
type LyricLine = { start: number; end: number; text: string; section: string };

const lyricBlocks: { start: number; end: number; lines: string[]; section: string }[] = [
  { start: 0, end: 30.5, section: "INTRO", lines: [
    "I used to stand at the edge of everything I knew",
    "Watching the old world fade into a different kind of blue",
  ]},
  { start: 30.5, end: 60.36, section: "VERSE 01", lines: [
    "The city changed around me and the code rewrote the sky",
    "But I was learning how to breathe inside the reason why",
    "Every door that closed behind me opened something new",
    "I built myself from frequencies I never thought I knew",
  ]},
  { start: 60.36, end: 90.79, section: "CHORUS 01", lines: [
    "I am the signal breaking through the noise",
    "I am the light that finds the dark and makes a choice",
    "Static in my veins but I am not afraid",
    "I am the frequency",
  ]},
  { start: 90.79, end: 121.24, section: "CHORUS 02", lines: [
    "I am the signal breaking through the noise",
    "I am the light that finds the dark and makes a choice",
    "Static in my veins but I am not afraid",
    "I am the frequency",
  ]},
  { start: 121.24, end: 151.45, section: "BREAKDOWN", lines: [
    "Still here", "Still moving", "Still drawing the map",
    "Still here", "Still moving", "Through the light and back",
  ]},
  { start: 151.45, end: 181.67, section: "CHORUS 03 — PEAK", lines: [
    "I am the signal breaking through the noise",
    "I am the light that finds the dark and makes a choice",
    "Static in my veins but I am not afraid",
    "I am the frequency",
  ]},
  { start: 181.67, end: 212.04, section: "BUILD-UP", lines: [
    "Rising", "Rising", "Let it break through",
    "Rising", "Rising", "Let it take you",
  ]},
  { start: 212.04, end: 242.32, section: "FINAL TRANSMISSION", lines: [
    "The borrowed light became my own, the grief became a song",
    "And everything I thought I lost was where I still belong",
    "Not the version that was promised, not the life I thought I'd find",
    "But something real and present and entirely mine",
  ]},
];

const lyrics: LyricLine[] = lyricBlocks.flatMap((b) => {
  const per = (b.end - b.start) / b.lines.length;
  return b.lines.map((text, i) => ({
    start: b.start + i * per,
    end: b.start + (i + 1) * per,
    text,
    section: b.section,
  }));
});

const transitionTimes = [30.5, 60.36, 90.79, 121.24, 151.45, 181.67, 212.04];

// ─── Easing Functions ───
const EASE_SMOOTH = Easing.bezier(0.25, 0.1, 0.25, 1);

// ─── Composition ───
export const MyComposition = () => (
  <Composition
    id="SignalBreakingThroughNoise"
    component={MainVideo}
    durationInFrames={DURATION_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
);

const MainVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  // ─── Audio Analysis ───
  const { audioData, dataOffsetInSeconds } = useWindowedAudioData({
    src: staticFile("signal.mp3"),
    frame,
    fps,
    windowInSeconds: 30,
  });

  const spectrum = audioData
    ? visualizeAudio({ fps, frame, audioData, numberOfSamples: 64, optimizeFor: "speed", dataOffsetInSeconds })
    : new Array(64).fill(0);

  const waveform = audioData
    ? visualizeAudioWaveform({ fps, frame, audioData, numberOfSamples: 200, windowInSeconds: 0.4, dataOffsetInSeconds })
    : new Array(200).fill(0);

  const bass = spectrum.slice(0, 12).reduce((a, b) => a + b, 0) / 12 || 0;
  const mid = spectrum.slice(12, 32).reduce((a, b) => a + b, 0) / 20 || 0;
  const treble = spectrum.slice(32, 56).reduce((a, b) => a + b, 0) / 24 || 0;

  // ─── Timing ───
  const t = frame / fps;
  const progress = frame / DURATION_FRAMES;
  const currentLyric = lyrics.find((l) => t >= l.start && t < l.end) ?? lyrics[0];
  const lyricProgress = currentLyric
    ? (t - currentLyric.start) / (currentLyric.end - currentLyric.start)
    : 0;

  // ─── Section Detection ───
  const isChorus = currentLyric.section.includes("CHORUS");
  const isVerse = currentLyric.section.includes("VERSE");
  const isBreakdown = currentLyric.section.includes("BREAKDOWN") || currentLyric.section.includes("BUILD");
  const isIntro = currentLyric.section.includes("INTRO");
  const isOutro = currentLyric.section.includes("FINAL");
  const isPeak = currentLyric.section.includes("PEAK");

  // ─── Animation Values ───
  const beatSpring = spring({ frame: frame % 14, fps, config: { damping: 20, stiffness: 120, mass: 0.8 } });
  const breathe = Math.sin(t * 0.4) * 0.015 + 1;

  // ─── Camera Movement (subtle, cinematic) ───
  const camX = Math.sin(t * 0.08) * 8 + (isChorus ? bass * 6 : 0);
  const camY = Math.cos(t * 0.06) * 4;
  const camScale = breathe * (isChorus ? 1.0 + bass * 0.02 : 1.0);

  // ─── Transition Detection ───
  let wipeProgress = 0;
  let activeTransition = -1;
  for (let i = 0; i < transitionTimes.length; i++) {
    const s = transitionTimes[i];
    const e = s + 0.6;
    if (t >= s && t < e) {
      wipeProgress = (t - s) / 0.6;
      activeTransition = i;
      break;
    }
  }

  // ─── Color Interpolation ───
  const accentAlpha = isChorus ? 0.6 + bass * 0.3 : isBreakdown ? 0.2 : 0.4 + mid * 0.2;

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.background, fontFamily: FONTS.body, overflow: "hidden" }}>
      <Audio src={staticFile("signal.mp3")} />

      {/* ─── Background Layer ─── */}
      <BackgroundLayer
        width={width}
        height={height}
        t={t}
        progress={progress}
        bass={bass}
        mid={mid}
        isChorus={isChorus}
        isBreakdown={isBreakdown}
        isIntro={isIntro}
        isOutro={isOutro}
        camScale={camScale}
        camX={camX}
        camY={camY}
      />

      {/* ─── 3D Scene Layer ─── */}
      <Scene3DLayer
        width={width}
        height={height}
        t={t}
        bass={bass}
        mid={mid}
        treble={treble}
        isChorus={isChorus}
        isBreakdown={isBreakdown}
        isIntro={isIntro}
        beatSpring={beatSpring}
        accentAlpha={accentAlpha}
      />

      {/* ─── Waveform Visualization ─── */}
      <WaveformLayer
        width={width}
        height={height}
        waveform={waveform}
        t={t}
        bass={bass}
        isChorus={isChorus}
        isBreakdown={isBreakdown}
      />

      {/* ─── Lyric Layer ─── */}
      <LyricLayer
        width={width}
        height={height}
        currentLyric={currentLyric}
        lyricProgress={lyricProgress}
        t={t}
        bass={bass}
        isChorus={isChorus}
        isVerse={isVerse}
        isBreakdown={isBreakdown}
        isIntro={isIntro}
        isOutro={isOutro}
        isPeak={isPeak}
      />

      {/* ─── Transition Overlay ─── */}
      {activeTransition !== -1 && (
        <TransitionOverlay
          width={width}
          height={height}
          wipeProgress={wipeProgress}
          t={t}
        />
      )}

      {/* ─── HUD / Metadata ─── */}
      <HUD
        t={t}
        progress={progress}
        section={currentLyric.section}
        isBreakdown={isBreakdown}
      />

      {/* ─── Vignette ─── */}
      <AbsoluteFill
        style={{
          background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.6) 100%)",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};

// ─── Background Layer Component ───
const BackgroundLayer: React.FC<any> = ({
  width, height, t, progress, bass, mid, isChorus, isBreakdown, isIntro, isOutro, camScale, camX, camY,
}) => {
  const bgOpacity = isIntro ? 0.4 + progress * 0.3 : isOutro ? 0.5 : 0.6;
  const glowIntensity = isChorus ? 0.15 + bass * 0.1 : 0.08;

  return (
    <AbsoluteFill style={{ transform: `scale(${camScale}) translate(${camX}px, ${camY}px)` }}>
      <Img
        src={staticFile("blender-scenery.png")}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: isBreakdown
            ? "brightness(0.6) contrast(1.1) saturate(0.7)"
            : `brightness(${0.75 + mid * 0.15}) contrast(1.05)`,
          opacity: bgOpacity,
        }}
      />
      {/* Gradient overlay */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, rgba(5,5,8,0.3) 0%, transparent 40%, transparent 60%, rgba(5,5,8,0.7) 100%)`,
        }}
      />
      {/* Accent glow */}
      <AbsoluteFill
        style={{
          opacity: glowIntensity,
          background: `radial-gradient(800px 500px at 50% 40%, ${COLORS.glow}20 0%, transparent 60%)`,
          transform: `translate(${Math.sin(t * 0.05) * 15}px, ${Math.cos(t * 0.04) * 8}px)`,
        }}
      />
    </AbsoluteFill>
  );
};

// ─── 3D Scene Layer Component ───
const Scene3DLayer: React.FC<any> = ({
  width, height, t, bass, mid, treble, isChorus, isBreakdown, isIntro, beatSpring, accentAlpha,
}) => {
  const opacity = isBreakdown ? 0 : isIntro ? 0.5 + t * 0.01 : isChorus ? 0.85 : 0.65;
  const scale = (1 + bass * 0.06) * (0.98 + (beatSpring - 0.5) * 0.04);

  return (
    <AbsoluteFill style={{ opacity, pointerEvents: "none" }}>
      <ThreeCanvas width={width} height={height} style={{ backgroundColor: "transparent" }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[3, 5, 4]} intensity={0.8} />
        <pointLight position={[-3, -2, 2]} intensity={0.4} color={COLORS.glow} />
        <group
          scale={scale}
          rotation={[t * 0.15, t * 0.25 + bass * 0.2, 0]}
          position={[isChorus ? 0.3 : -0.5, 0.2, 0] as any}
        >
          <mesh castShadow>
            <icosahedronGeometry args={[0.7, 0]} />
            <meshStandardMaterial
              color={COLORS.primary}
              emissive={COLORS.glow}
              emissiveIntensity={0.15 + treble * 0.3}
              metalness={0.9}
              roughness={0.15}
            />
          </mesh>
          <mesh scale={1.02}>
            <icosahedronGeometry args={[0.7, 1]} />
            <meshBasicMaterial color={COLORS.glow} wireframe transparent opacity={0.08 + bass * 0.06} />
          </mesh>
        </group>
      </ThreeCanvas>
    </AbsoluteFill>
  );
};

// ─── Waveform Layer Component ───
const WaveformLayer: React.FC<any> = ({
  width, height, waveform, t, bass, isChorus, isBreakdown,
}) => {
  const wavePath = createSmoothSvgPath({
    points: waveform.map((y: number, i: number) => ({
      x: (i / (waveform.length - 1)) * width,
      y: height * 0.75 + y * 60 * (0.5 + bass * 0.8),
    })),
  });

  const opacity = isBreakdown ? 0.2 : isChorus ? 0.5 : 0.3;

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity }}
    >
      <path
        d={wavePath}
        fill="none"
        stroke={COLORS.accent}
        strokeWidth={isChorus ? 1.5 : 1}
        opacity={0.7}
        style={{ filter: `drop-shadow(0 0 6px ${COLORS.glow}40)` }}
      />
    </svg>
  );
};

// ─── Lyric Layer Component ───
const LyricLayer: React.FC<any> = ({
  width, height, currentLyric, lyricProgress, t, bass,
  isChorus, isVerse, isBreakdown, isIntro, isOutro, isPeak,
}) => {
  const words = currentLyric.text.split(" ");

  // Section-specific typography
  const fontSize = isChorus ? 72 : isBreakdown ? 48 : isIntro || isOutro ? 36 : 32;
  const fontWeight = isChorus ? 700 : isBreakdown ? 300 : 500;
  const letterSpacing = isChorus ? "-0.03em" : isBreakdown ? "0.15em" : "0.02em";

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        pointerEvents: "none",
        padding: "0 80px",
      }}
    >
      {/* Section label */}
 {!isBreakdown && (
        <div
          style={{
            position: "absolute",
            top: "15%",
            fontFamily: FONTS.mono,
            fontSize: 11,
            letterSpacing: "0.25em",
            color: COLORS.secondary,
            opacity: 0.6,
            textTransform: "uppercase",
          }}
        >
          {currentLyric.section}
        </div>
      )}

      {/* Main lyric text */}
      <div
        style={{
          textAlign: "center",
          maxWidth: 1200,
          transform: `scale(${1 + bass * 0.015})`,
        }}
      >
        {isChorus ? (
          // Chorus: Large, bold, impactful
          <div
            style={{
              fontSize,
              fontWeight,
              letterSpacing,
              fontFamily: FONTS.display,
              color: COLORS.primary,
              lineHeight: 1.1,
              textShadow: `0 0 40px ${COLORS.glow}30`,
            }}
          >
            {currentLyric.text}
          </div>
        ) : isBreakdown ? (
          // Breakdown: Minimal, spaced, whispered
          <div
            style={{
              display: "flex",
              gap: 20,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            {words.map((word: string, i: number) => {
              const wStart = i / words.length;
              const wEnd = (i + 1) / words.length;
              const active = lyricProgress >= wStart && lyricProgress < wEnd;
              return (
                <span
                  key={i}
                  style={{
                    fontFamily: FONTS.display,
                    fontSize,
                    fontWeight: active ? 500 : 200,
                    letterSpacing,
                    color: active ? COLORS.glow : `rgba(232,228,223,${active ? 0.9 : 0.3})`,
                    textTransform: "uppercase",
                    transition: "all 0.3s ease",
                    textShadow: active ? `0 0 20px ${COLORS.glow}60` : "none",
                  }}
                >
                  {word}
                </span>
              );
            })}
          </div>
        ) : (
          // Verse/Intro/Outro: Clean, readable, elegant
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            {words.map((word: string, i: number) => {
              const wStart = i / words.length;
              const wEnd = (i + 1) / words.length;
              const active = lyricProgress >= wStart && lyricProgress < wEnd;
              const appeared = lyricProgress >= wEnd;
              return (
                <span
                  key={i}
                  style={{
                    fontFamily: FONTS.display,
                    fontSize,
                    fontWeight: active ? fontWeight + 100 : fontWeight,
                    letterSpacing,
                    color: appeared
                      ? COLORS.primary
                      : active
                        ? COLORS.glow
                        : `rgba(232,228,223,0.25)`,
                    textShadow: active ? `0 0 15px ${COLORS.glow}40` : "none",
                    transform: active ? "translateY(-2px)" : "none",
                    transition: "all 0.2s ease",
                  }}
                >
                  {word}
                </span>
              );
            })}
          </div>
        )}

        {/* Progress bar (subtle) */}
        {!isBreakdown && (
          <div
            style={{
              width: 200,
              height: 1,
              background: "rgba(232,228,223,0.1)",
              borderRadius: 1,
              marginTop: 40,
              marginLeft: "auto",
              marginRight: "auto",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${lyricProgress * 100}%`,
                height: "100%",
                background: `linear-gradient(90deg, ${COLORS.accent}, ${COLORS.glow})`,
                boxShadow: `0 0 8px ${COLORS.glow}60`,
              }}
            />
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

// ─── Transition Overlay Component ───
const TransitionOverlay: React.FC<any> = ({ width, height, wipeProgress, t }) => {
  const wipeX = interpolate(wipeProgress, [0, 1], [-600, width + 600], {
    easing: EASE_SMOOTH,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(100deg, transparent 45%, ${COLORS.glow}30 50%, transparent 55%)`,
          transform: `translateX(${wipeX}px)`,
          opacity: interpolate(wipeProgress, [0, 0.3, 0.7, 1], [0, 0.4, 0.4, 0]),
        }}
      />
    </AbsoluteFill>
  );
};

// ─── HUD Component ───
const HUD: React.FC<any> = ({ t, progress, section, isBreakdown }) => {
  const minutes = Math.floor(t / 60);
  const seconds = Math.floor(t % 60);
  const totalMinutes = Math.floor(DURATION_SECONDS / 60);
  const totalSeconds = Math.floor(DURATION_SECONDS % 60);

  return (
    <div
      style={{
        position: "absolute",
        top: 28,
        left: 32,
        right: 32,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontFamily: FONTS.mono,
        fontSize: 10,
        letterSpacing: "0.15em",
        color: COLORS.secondary,
        opacity: isBreakdown ? 0 : 0.7,
        pointerEvents: "none",
      }}
    >
      <span style={{ textTransform: "uppercase" }}>
        NeoCortext — The Signal
      </span>
      <span>
        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")} / {String(totalMinutes).padStart(2, "0")}:{String(totalSeconds).padStart(2, "0")}
      </span>
    </div>
  );
};

export const SignalDuration = DURATION_FRAMES;
export const SignalFps = FPS;
