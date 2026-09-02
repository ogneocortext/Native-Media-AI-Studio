/* eslint-disable @remotion/no-background-image, @remotion/non-pure-animation */
import {
  AbsoluteFill, Audio, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig, Easing, Composition
} from "remotion";
import {
  useWindowedAudioData, visualizeAudio, visualizeAudioWaveform,
  createSmoothSvgPath
} from "@remotion/media-utils";
import { ThreeCanvas } from "@remotion/three";
import React, { useRef } from "react";

// ─────────────────────────────────────────────────────────────
// Signal Breaking Through The Noise — Professional Composition
// Based on: docs/STORYBOARD_SignalBreakingThroughNoise.md
// 136 BPM Progressive Trance, 242.32s (7269f @30fps)
// ─────────────────────────────────────────────────────────────

const FPS = 30;
const DURATION_SECONDS = 242.32;
const DURATION_FRAMES = Math.ceil(DURATION_SECONDS * FPS);

// ─── Section Definitions (from storyboard) ───
type Section = {
  id: string;
  name: string;
  start: number;
  end: number;
  energy: number;
  palette: { primary: string; secondary: string; glow: string };
  typography: { size: number; weight: number; family: string; spacing: string };
  camera: { scale: number; speed: number };
};

const SECTIONS: Section[] = [
  { id: "S01", name: "INTRO", start: 0, end: 30.5, energy: 0.20, palette: { primary: "#38bdf8", secondary: "#0ea5e9", glow: "#22d3ee" }, typography: { size: 26, weight: 500, family: "DM Mono, monospace", spacing: "0.06em" }, camera: { scale: 0.995, speed: 0.03 } },
  { id: "S02", name: "VERSE_01", start: 30.5, end: 60.36, energy: 0.548, palette: { secondary: "#5ab8d4", primary: "#45a0c4", glow: "#60a5fa" }, typography: { size: 34, weight: 600, family: "Space Grotesk, sans-serif", spacing: "0.02em" }, camera: { scale: 1.0, speed: 0.08 } },
  { id: "S03", name: "CHORUS_01", start: 60.36, end: 90.79, energy: 0.923, palette: { primary: "#c084fc", secondary: "#a855f7", glow: "#d946ef" }, typography: { size: 88, weight: 800, family: "Space Grotesk, sans-serif", spacing: "-0.04em" }, camera: { scale: 1.02, speed: 0.12 } },
  { id: "S04", name: "CHORUS_02", start: 90.79, end: 121.24, energy: 0.923, palette: { primary: "#c084fc", secondary: "#a855f7", glow: "#d946ef" }, typography: { size: 88, weight: 800, family: "Space Grotesk, sans-serif", spacing: "-0.04em" }, camera: { scale: 1.04, speed: 0.12 } },
  { id: "S05", name: "BREAKDOWN", start: 121.24, end: 151.45, energy: 0.282, palette: { primary: "#b08a5a", secondary: "#8a7048", glow: "#f59e0b" }, typography: { size: 36, weight: 400, family: "DM Mono, monospace", spacing: "0.22em" }, camera: { scale: 1.0, speed: 0.0 } },
  { id: "S06", name: "CHORUS_03_PEAK", start: 151.45, end: 181.67, energy: 1.0, palette: { primary: "#fbbf24", secondary: "#f59e0b", glow: "#fcd34d" }, typography: { size: 92, weight: 800, family: "Space Grotesk, sans-serif", spacing: "-0.04em" }, camera: { scale: 1.03, speed: 0.15 } },
  { id: "S07", name: "BUILD_UP", start: 181.67, end: 212.04, energy: 0.84, palette: { primary: "#fbbf24", secondary: "#f59e0b", glow: "#fcd34d" }, typography: { size: 72, weight: 700, family: "Space Grotesk, sans-serif", spacing: "-0.03em" }, camera: { scale: 1.02, speed: 0.1 } },
  { id: "S08", name: "OUTRO", start: 212.04, end: 242.32, energy: 0.794, palette: { primary: "#fbbf24", secondary: "#d4a853", glow: "#fcd34d" }, typography: { size: 48, weight: 500, family: "Space Grotesk, sans-serif", spacing: "0.04em" }, camera: { scale: 0.99, speed: 0.01 } },
];

// ─── Lyric Data ───
type LyricLine = { start: number; end: number; text: string; section: string };

const lyricBlocks: { start: number; end: number; lines: string[]; section: string }[] = [
  { start: 0, end: 30.5, section: "INTRO", lines: ["I used to stand at the edge of everything I knew", "Watching the old world fade into a different kind of blue", "I drew my maps in silence, traced the lines with borrowed light", "And somewhere in the static I found something worth the fight"] },
  { start: 30.5, end: 60.36, section: "VERSE_01", lines: ["The city changed around me and the code rewrote the sky", "But I was learning how to breathe inside the reason why", "Every door that closed behind me opened something new", "I built myself from frequencies I never thought I knew"] },
  { start: 60.36, end: 90.79, section: "CHORUS_01", lines: ["I am the signal breaking through the noise", "I am the light that finds the dark and makes a choice", "Static in my veins but I am not afraid", "I am the frequency", "I am the frequency"] },
  { start: 90.79, end: 121.24, section: "CHORUS_02", lines: ["I am the signal breaking through the noise", "I am the light that finds the dark and makes a choice", "Static in my veins but I am not afraid", "I am the frequency", "I am the frequency"] },
  { start: 121.24, end: 151.45, section: "BREAKDOWN", lines: ["Still here", "Still moving", "Still drawing the map", "Still here", "Still moving", "Through the light and back"] },
  { start: 151.45, end: 181.67, section: "CHORUS_03_PEAK", lines: ["I am the signal breaking through the noise", "I am the light that finds the dark and makes a choice", "Static in my veins but I am not afraid", "I am the frequency", "I am the frequency"] },
  { start: 181.67, end: 212.04, section: "BUILD_UP", lines: ["Rising", "Rising", "Let it break through", "Rising", "Rising", "Let it take you"] },
  { start: 212.04, end: 242.32, section: "OUTRO", lines: ["The borrowed light became my own, the grief became a song", "And everything I thought I lost was where I still belong", "Not the version that was promised, not the life I thought I'd find", "But something real and present and entirely mine"] },
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

// ─── Easing ───
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
  const currentLyric = lyrics.find((l) => t >= l.start && l.end > t) ?? lyrics[0];
  const lyricProgress = currentLyric ? (t - currentLyric.start) / (currentLyric.end - currentLyric.start) : 0;

  // ─── Current Section ───
  const section = SECTIONS.find(s => t >= s.start && t < s.end) ?? SECTIONS[0];
  const isChorus = section.name.includes("CHORUS") || section.name === "BUILD_UP";
  const isBreakdown = section.name === "BREAKDOWN";

  // Scale up typography for better visibility
  const typoScale = 1.3;

  // ─── BPM-synced pulse (136 BPM) — deterministic clock, works even when
  // the spectral bass is quiet; sharp attack, fast decay per beat.
  const BPM = 136;
  const beatDur = 60 / BPM;
  const beatPhase = (t % beatDur) / beatDur;
  const beatPulse = Math.pow(1 - beatPhase, 2.5);
  const pulse = Math.min(1, bass * 0.7 + beatPulse * section.energy * 0.55);

  // ─── Beat Detection (rolling energy average) ───
  const bassEnergy = bass;
  const prevBassRef = useRef(0);
  const beatThreshold = 0.35;
  const minBeatGap = 0.15; // seconds
  const lastBeatTimeRef = useRef(0);
  const isBeat = bassEnergy > beatThreshold && (t - lastBeatTimeRef.current) > minBeatGap;
  if (isBeat) lastBeatTimeRef.current = t;
  prevBassRef.current = bassEnergy;

  // ─── Animation Values ───
  const beatSpring = spring({ frame: isBeat ? frame % 14 : frame % 14 - 14, fps, config: { damping: 12, stiffness: 200, mass: 0.5 } });
  const breathe = Math.sin(t * section.camera.speed * 2) * 0.015 + 1;
  const camScale = breathe * section.camera.scale * (1 + pulse * (isChorus ? 0.04 : 0.02));
  const camX = Math.sin(t * section.camera.speed) * (isChorus ? 15 : 8) + (isBeat ? bass * 5 : 0);
  const camY = Math.cos(t * section.camera.speed * 0.7) * 5;

  // ─── Transition Detection ───
  let wipeProgress = 0;
  let activeTransition = -1;
  for (let i = 0; i < transitionTimes.length; i++) {
    const s = transitionTimes[i];
    const e = s + 0.9;
    if (t >= s && t < e) {
      wipeProgress = (t - s) / 0.9;
      activeTransition = i;
      break;
    }
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "#050508", overflow: "hidden" }}>
      <Audio src={staticFile("signal.mp3")} />

      {/* ─── Background ─── */}
      <BackgroundSection section={section} t={t} bass={bass} pulse={pulse} camScale={camScale} camX={camX} camY={camY} />

      {/* ─── 3D Scene ─── */}
      <Scene3DLayer section={section} t={t} bass={bass} mid={mid} treble={treble} beatSpring={beatSpring} width={width} height={height} isBeat={isBeat} pulse={pulse} />

      {/* ─── Beat-synced pulse rings ─── */}
      <BeatRings section={section} t={t} isChorus={isChorus} isBreakdown={isBreakdown} />

      {/* ─── Waveform ─── */}
      <WaveformSection waveform={waveform} section={section} width={width} height={height} bass={bass} />

      {/* ─── Floating Particles ─── */}
      <ParticlesLayer t={t} bass={bass} isChorus={isChorus} isBreakdown={isBreakdown} isBeat={isBeat} beatSpring={beatSpring} pulse={pulse} section={section} />

      {/* ─── Lyrics ─── */}
      <LyricSection currentLyric={currentLyric} lyricProgress={lyricProgress} section={section} t={t} bass={bass} width={width} height={height} typoScale={typoScale} />

      {/* ─── Bento Boxes ─── */}
      {(isChorus || isBreakdown) && (
        <BentoSection spectrum={spectrum} section={section} t={t} progress={progress} width={width} height={height} bass={bass} />
      )}

      {/* ─── Transitions ─── */}
      {activeTransition !== -1 && <TransitionOverlay wipeProgress={wipeProgress} width={width} height={height} />}

      {/* ─── Vignette ─── */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.5) 100%)", pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};

// ─── Background Section ───
const BackgroundSection: React.FC<any> = ({ section, t, bass, pulse, camScale, camX, camY }) => {
  return (
    <AbsoluteFill style={{ transform: `scale(${camScale}) translate(${camX}px, ${camY}px)` }}>
      {/* Base gradient - vibrant, section-tinted */}
      <AbsoluteFill style={{ background: `linear-gradient(${t * 12}deg, #0a0a1a 0%, ${section.palette.primary}45 30%, #0d1025 60%, ${section.palette.secondary}30 100%)` }} />
      {/* Animated radial glow - responds to audio + BPM pulse */}
      <AbsoluteFill style={{ opacity: 0.3 + bass * 0.3 + pulse * 0.25, background: `radial-gradient(900px 650px at ${50 + Math.sin(t * 0.1) * 15}% ${35 + Math.cos(t * 0.08) * 10}%, ${section.palette.glow}55 0%, transparent 55%)` }} />
      {/* Secondary accent glow */}
      <AbsoluteFill style={{ opacity: 0.22 + bass * 0.2, background: `radial-gradient(650px 500px at ${70 + Math.cos(t * 0.06) * 20}% ${65 + Math.sin(t * 0.05) * 15}%, ${section.palette.glow}40 0%, transparent 50%)` }} />
      {/* Grid for depth */}
      <AbsoluteFill style={{ opacity: 0.08 + pulse * 0.05, backgroundImage: `linear-gradient(rgba(255,255,255,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.14) 1px, transparent 1px)`, backgroundSize: "80px 80px" }} />
      {/* Beat flash */}
      <AbsoluteFill style={{ opacity: pulse * 0.07 * section.energy, background: `radial-gradient(circle at 50% 50%, ${section.palette.glow} 0%, transparent 60%)` }} />
    </AbsoluteFill>
  );
};

// ─── Particles Layer Component ───
const ParticlesLayer: React.FC<any> = ({ t, bass, isChorus, isBreakdown, isBeat, beatSpring, pulse, section }) => {
  const opacity = isBreakdown ? 0.25 : isChorus ? 0.75 : 0.55;
  const particleCount = isChorus ? 45 : 30;
  const beatBounce = isBeat ? (beatSpring - 0.5) * 10 : 0;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      {Array.from({ length: particleCount }).map((_, i) => {
        const speed = 0.2 + (i % 4) * 0.1;
        const size = 2.5 + (i % 3) * 1.8;
        const startX = (i * 137.5) % 100;
        const startY = 12 + (i * 73) % 70;
        const x = (startX + t * speed * 3.5) % 110 - 5;
        const y = startY + Math.sin(t * 0.5 + i * 0.7) * 12 + beatBounce;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${y}%`,
              width: size * (1 + bass * 0.6),
              height: size * (1 + bass * 0.6),
              borderRadius: "50%",
              background: i % 3 === 0 ? section.palette.glow : section.palette.primary,
              opacity: 0.55 + (i % 3) * 0.2 + bass * 0.25,
              boxShadow: `0 0 ${8 + bass * 14 + pulse * 10}px ${section.palette.glow}70`,
              transform: `scale(${1 + (isBeat ? bass * 0.4 : 0)})`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ─── 3D Scene Section ───
const Scene3DLayer: React.FC<any> = ({ section, t, bass, mid, treble, beatSpring, width, height, isBeat, pulse }) => {
  const opacity = section.name === "BREAKDOWN" ? 0 : Math.min(1, section.energy + 0.5);
  const scale = (1 + bass * 0.12 + pulse * 0.05) * (0.96 + (beatSpring - 0.5) * 0.08);
  // Position: centered hero object; off to the side only in mid-energy sections
  const posX = section.name === "INTRO" ? -0.6 : section.energy > 0.7 ? 0.5 : -2;
  const posY = 0.2 + Math.sin(t * 0.4) * 0.2;

  return (
    <AbsoluteFill style={{ opacity, pointerEvents: "none" }}>
      <ThreeCanvas width={width} height={height} style={{ backgroundColor: "transparent" }}>
        <ambientLight intensity={0.5 + section.energy * 0.5} />
        <directionalLight position={[3, 5, 4]} intensity={0.9 + section.energy * 0.7} />
        <pointLight position={[-3, -2, 3]} intensity={2.2 + treble * 3.5} color={section.palette.glow} />
        <pointLight position={[3, 2, -2]} intensity={1.6 + mid * 2.5} color={section.palette.primary} />
        <group scale={scale} rotation={[t * 0.15 + bass * 0.1, t * 0.25 + bass * 0.2, Math.sin(t * 0.2) * 0.05]} position={[posX, posY, -1] as any}>
          <mesh>
            <icosahedronGeometry args={[0.9, 0]} />
            <meshStandardMaterial color={section.palette.primary} emissive={section.palette.glow} emissiveIntensity={0.8 + treble * 1.2 + pulse * 0.8} metalness={0.85} roughness={0.12} />
          </mesh>
          <mesh scale={1.03}>
            <icosahedronGeometry args={[0.9, 1]} />
            <meshBasicMaterial color={section.palette.glow} wireframe transparent opacity={0.25 + bass * 0.25 + pulse * 0.15} />
          </mesh>
          {/* Inner glow core */}
          <mesh scale={0.45}>
            <sphereGeometry args={[0.6, 16, 16]} />
            <meshBasicMaterial color={section.palette.glow} transparent opacity={0.35 + bass * 0.35 + pulse * 0.2} />
          </mesh>
          {/* Orbital ring */}
          <mesh rotation={[Math.PI / 2.15, t * 0.12, 0]}>
            <torusGeometry args={[1.7, 0.035, 10, 72]} />
            <meshBasicMaterial color={section.palette.glow} transparent opacity={0.45 + bass * 0.3} />
          </mesh>
          {/* Orbiting satellites */}
          {[0, 1, 2].map((i) => {
            const a = t * (0.6 + i * 0.22) + (i * Math.PI * 2) / 3;
            return (
              <mesh key={i} position={[Math.cos(a) * 1.7, Math.sin(a) * 0.5, Math.sin(a) * 1.2]}>
                <octahedronGeometry args={[0.12 + bass * 0.06, 0]} />
                <meshStandardMaterial color={section.palette.glow} emissive={section.palette.glow} emissiveIntensity={1.2} metalness={0.6} roughness={0.3} />
              </mesh>
            );
          })}
        </group>
      </ThreeCanvas>
    </AbsoluteFill>
  );
};

// ─── Beat-synced Pulse Rings ───
const phase = (t: number, dur: number) => (t % dur) / dur;

const BeatRings: React.FC<any> = ({ section, t, isChorus, isBreakdown }) => {
  if (isBreakdown) return null;
  const BPM = 136;
  const beatDur = 60 / BPM;
  const ringCount = isChorus ? 2 : 1;
  const fade = isChorus ? 1 : 0.5;
  return (
    <svg width="100%" height="100%" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {Array.from({ length: ringCount }).map((_, i) => {
        const p = (phase(t, beatDur) + i * 0.5) % 1;
        const r = 140 + p * 620;
        const opacity = (1 - p) * 0.3 * section.energy * fade;
        return (
          <circle key={i} cx="960" cy="540" r={r} fill="none" stroke={section.palette.glow} strokeWidth={2.5 * (1 - p) + 0.5} opacity={opacity} />
        );
      })}
    </svg>
  );
};

// ─── Waveform Section ───
const WaveformSection: React.FC<any> = ({ waveform, section, width, height, bass }) => {
  // Gate the "stray horizontal line" artifact: when the analysis window is
  // near-silent the waveform collapses to a flat line — hide it entirely.
  const maxAmp = waveform.reduce((m: number, y: number) => Math.max(m, Math.abs(y)), 0);
  if (maxAmp < 0.02) return null;

  const amp = 0.5 + bass * 0.9;
  const wavePath = createSmoothSvgPath({
    points: waveform.map((y: number, i: number) => ({
      x: (i / (waveform.length - 1)) * width,
      y: height * 0.82 + y * 60 * amp,
    })),
  });

  const opacity = section.name === "BREAKDOWN" ? 0.25 : section.energy > 0.8 ? 0.6 : 0.4;
  const strokeWidth = section.name.includes("CHORUS") ? 2 : 1.5;
  const uid = `waveGlow-${section.id}`;

  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <defs>
        <filter id={uid} x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <path d={wavePath} fill="none" stroke={section.palette.glow} strokeWidth={strokeWidth * 5} filter={`url(#${uid})`} opacity={opacity * 0.5} />
      <path d={wavePath} fill="none" stroke="#ffffff" strokeWidth={strokeWidth} opacity={opacity} />
    </svg>
  );
};

// ─── Lyric Section ───
const LyricSection: React.FC<any> = ({ currentLyric, lyricProgress, section, t, bass, width, height, typoScale }) => {
  const words = currentLyric.text.split(" ");
  const isChorus = section.name.includes("CHORUS") || section.name === "BUILD_UP";
  const isBreakdown = section.name === "BREAKDOWN";

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", pointerEvents: "none", padding: "0 100px" }}>
      {/* Soft scrim behind lyrics for legibility */}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(0,0,0,0.4) 0%, transparent 100%)", pointerEvents: "none" }} />
      <div style={{ textAlign: "center", maxWidth: 1100 }}>
        {isChorus ? (
          // Chorus: Large hero text with split bounce animation
          <div style={{ fontSize: section.typography.size * typoScale, fontWeight: section.typography.weight, letterSpacing: section.typography.spacing, fontFamily: section.typography.family, color: "#ffffff", textShadow: `0 4px 30px rgba(0,0,0,0.85), 0 0 70px ${section.palette.glow}90`, transform: `scale(${1 + bass * 0.05})`, opacity: interpolate(lyricProgress, [0, 0.1], [0, 1]), transition: "opacity 0.3s" }}>
            {/* Word-wrapped chars: each word is an atomic inline-block so lines never break mid-word */}
            {(() => {
              let charIdx = 0;
              const allWords = currentLyric.text.split(" ");
              return allWords.map((word: string, wi: number) => {
                const start = charIdx;
                charIdx += word.length + 1; // +1 consumes the space
                return (
                  <span key={wi} style={{ display: "inline-block", whiteSpace: "nowrap" }}>
                    {word.split("").map((ch: string, ci: number) => {
                      const i = start + ci;
                      return (
                        <span key={ci} style={{ display: "inline-block", transform: `translateY(${Math.sin(t * 3 + i * 0.5) * (2 + bass * 5)}px)`, opacity: lyricProgress > i / currentLyric.text.length ? 1 : 0.3 }}>
                          {ch}
                        </span>
                      );
                    })}
                    {wi < allWords.length - 1 ? "\u00A0" : null}
                  </span>
                );
              });
            })()}
          </div>
        ) : isBreakdown ? (
          // Breakdown: Spaced minimal
          <div style={{ display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap" }}>
            {words.map((w: string, i: number) => {
              const active = lyricProgress >= i / words.length && lyricProgress < (i + 1) / words.length;
              return (
                <span key={i} style={{ fontFamily: section.typography.family, fontSize: section.typography.size * typoScale, fontWeight: active ? 600 : 300, letterSpacing: section.typography.spacing, color: active ? section.palette.glow : `rgba(255,255,255,${active ? 0.9 : 0.35})`, textTransform: "uppercase", textShadow: active ? `0 2px 20px rgba(0,0,0,0.9), 0 0 20px ${section.palette.glow}80` : "0 2px 16px rgba(0,0,0,0.8)" }}>
                  {w}
                </span>
              );
            })}
          </div>
        ) : (
          // Verse/Intro/Outro: Clean readable with per-word animation
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            {words.map((w: string, i: number) => {
              const active = lyricProgress >= i / words.length && lyricProgress < (i + 1) / words.length;
              const appeared = lyricProgress >= (i + 1) / words.length;
              // Stagger animation based on word index
              return (
                <span key={i} style={{ fontFamily: section.typography.family, fontSize: section.typography.size * typoScale, fontWeight: active ? section.typography.weight + 200 : section.typography.weight, letterSpacing: section.typography.spacing, color: appeared ? "#ffffff" : active ? section.palette.glow : `rgba(255,255,255,0.4)`, textShadow: active ? `0 2px 20px rgba(0,0,0,0.9), 0 0 18px ${section.palette.glow}70` : "0 2px 16px rgba(0,0,0,0.8)", transform: active ? "translateY(-4px)" : "none", opacity: interpolate(lyricProgress, [i / words.length, i / words.length + 0.05], [0, 1]), transition: "all 0.2s ease" }}>
                  {w}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

// ─── Bento Section ───
const BentoSection: React.FC<any> = ({ spectrum, section, t, progress, width, height, bass }) => {
  const isBreakdown = section.name === "BREAKDOWN";
  const cardWidth = isBreakdown ? 280 : 420;
  const cardHeight = isBreakdown ? 100 : 140;
  const barCount = isBreakdown ? 16 : 32;

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-end", padding: 28, pointerEvents: "none" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-end" }}>
        {!isBreakdown && (
          <div style={{ width: 280, height: cardHeight, borderRadius: 20, background: "rgba(18,22,34,0.7)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)", padding: 16, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div style={{ fontFamily: "DM Mono, monospace", fontSize: 10, letterSpacing: "0.15em", color: "rgba(255,255,255,0.5)" }}>136 BPM • PROGRESSIVE TRANCE</div>
            <div style={{ width: "100%", height: 2, background: "rgba(255,255,255,0.1)", borderRadius: 1, overflow: "hidden" }}>
              <div style={{ width: `${progress * 100}%`, height: "100%", background: section.palette.glow }} />
            </div>
          </div>
        )}
        <div style={{ width: cardWidth, height: cardHeight, borderRadius: 20, background: "rgba(18,22,34,0.6)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)", padding: "12px 14px", display: "flex", alignItems: "flex-end", gap: 2 }}>
          {spectrum.filter((_: any, i: number) => i % (64 / barCount) === 0).slice(0, barCount).map((v: number, i: number) => {
            const h = 4 + v * 60 + (i < 8 ? bass * 12 : 0);
            return <div key={i} style={{ flex: 1, height: h, backgroundColor: i < 6 ? section.palette.glow : "rgba(255,255,255,0.8)", borderRadius: 4, opacity: i < 6 ? 0.9 : 0.6 }} />;
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Transition Overlay ───
const TransitionOverlay: React.FC<any> = ({ wipeProgress, width, height }) => {
  const wipeX = interpolate(wipeProgress, [0, 1], [-600, width + 600], { easing: EASE_SMOOTH, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(100deg, transparent 45%, rgba(255,255,255,0.15) 50%, transparent 55%)`, transform: `translateX(${wipeX}px)`, opacity: interpolate(wipeProgress, [0, 0.3, 0.7, 1], [0, 0.5, 0.5, 0]) }} />
    </AbsoluteFill>
  );
};

export const SignalDuration = DURATION_FRAMES;
export const SignalFps = FPS;
