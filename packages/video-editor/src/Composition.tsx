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
  { id: "S01", name: "INTRO", start: 0, end: 30.5, energy: 0.20, palette: { primary: "#6aa9d6", secondary: "#4a8ab8", glow: "#818cf8" }, typography: { size: 11, weight: 400, family: "DM Mono, monospace", spacing: "0.2em" }, camera: { scale: 0.985, speed: 0.015 } },
  { id: "S02", name: "VERSE_01", start: 30.5, end: 60.36, energy: 0.548, palette: { secondary: "#5ab8d4", primary: "#45a0c4", glow: "#60a5fa" }, typography: { size: 19, weight: 500, family: "Space Grotesk, sans-serif", spacing: "0.02em" }, camera: { scale: 1.0, speed: 0.08 } },
  { id: "S03", name: "CHORUS_01", start: 60.36, end: 90.79, energy: 0.923, palette: { primary: "#c084fc", secondary: "#a855f7", glow: "#d946ef" }, typography: { size: 88, weight: 800, family: "Space Grotesk, sans-serif", spacing: "-0.04em" }, camera: { scale: 1.02, speed: 0.12 } },
  { id: "S04", name: "CHORUS_02", start: 90.79, end: 121.24, energy: 0.923, palette: { primary: "#c084fc", secondary: "#a855f7", glow: "#d946ef" }, typography: { size: 88, weight: 800, family: "Space Grotesk, sans-serif", spacing: "-0.04em" }, camera: { scale: 1.04, speed: 0.12 } },
  { id: "S05", name: "BREAKDOWN", start: 121.24, end: 151.45, energy: 0.282, palette: { primary: "#b08a5a", secondary: "#8a7048", glow: "#f59e0b" }, typography: { size: 22, weight: 300, family: "DM Mono, monospace", spacing: "0.15em" }, camera: { scale: 1.0, speed: 0.0 } },
  { id: "S06", name: "CHORUS_03_PEAK", start: 151.45, end: 181.67, energy: 1.0, palette: { primary: "#fbbf24", secondary: "#f59e0b", glow: "#fcd34d" }, typography: { size: 92, weight: 800, family: "Space Grotesk, sans-serif", spacing: "-0.04em" }, camera: { scale: 1.03, speed: 0.15 } },
  { id: "S07", name: "BUILD_UP", start: 181.67, end: 212.04, energy: 0.84, palette: { primary: "#fbbf24", secondary: "#f59e0b", glow: "#fcd34d" }, typography: { size: 72, weight: 700, family: "Space Grotesk, sans-serif", spacing: "-0.03em" }, camera: { scale: 1.02, speed: 0.1 } },
  { id: "S08", name: "OUTRO", start: 212.04, end: 242.32, energy: 0.794, palette: { primary: "#fbbf24", secondary: "#d4a853", glow: "#fcd34d" }, typography: { size: 36, weight: 400, family: "Space Grotesk, sans-serif", spacing: "0.05em" }, camera: { scale: 0.99, speed: 0.01 } },
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
  const camScale = breathe * section.camera.scale * (isChorus ? 1 + bass * 0.05 : 1 + bass * 0.02);
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
      <BackgroundSection section={section} t={t} bass={bass} camScale={camScale} camX={camX} camY={camY} />

      {/* ─── 3D Scene ─── */}
      <Scene3DLayer section={section} t={t} bass={bass} mid={mid} treble={treble} beatSpring={beatSpring} width={width} height={height} isBeat={isBeat} />

      {/* ─── Waveform ─── */}
      <WaveformSection waveform={waveform} section={section} width={width} height={height} t={t} bass={bass} />

      {/* ─── Floating Particles ─── */}
      <ParticlesLayer t={t} bass={bass} isChorus={isChorus} isBreakdown={isBreakdown} isBeat={isBeat} beatSpring={beatSpring} section={section} />

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
const BackgroundSection: React.FC<any> = ({ section, t, bass, camScale, camX, camY }) => {
  return (
    <AbsoluteFill style={{ transform: `scale(${camScale}) translate(${camX}px, ${camY}px)` }}>
      {/* Base gradient - more vibrant */}
      <AbsoluteFill style={{ background: `linear-gradient(${t * 12}deg, #0a0a1a 0%, ${section.palette.primary}25 30%, #0d1025 60%, ${section.palette.secondary}15 100%)` }} />
      {/* Animated radial glow - responds to audio */}
      <AbsoluteFill style={{ opacity: 0.15 + bass * 0.15, background: `radial-gradient(700px 500px at ${50 + Math.sin(t * 0.1) * 15}% ${35 + Math.cos(t * 0.08) * 10}%, ${section.palette.glow}30 0%, transparent 55%)` }} />
      {/* Secondary accent glow */}
      <AbsoluteFill style={{ opacity: 0.1 + bass * 0.1, background: `radial-gradient(500px 400px at ${70 + Math.cos(t * 0.06) * 20}% ${65 + Math.sin(t * 0.05) * 15}%, ${section.palette.glow}20 0%, transparent 50%)` }} />
      {/* Subtle grid for depth */}
      <AbsoluteFill style={{ opacity: 0.04, backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`, backgroundSize: "60px 60px" }} />
    </AbsoluteFill>
  );
};

// ─── Particles Layer Component ───
const ParticlesLayer: React.FC<any> = ({ t, bass, isChorus, isBreakdown, isBeat, beatSpring, section }) => {
  const opacity = isBreakdown ? 0.2 : isChorus ? 0.6 : 0.4;
  const particleCount = isChorus ? 40 : 25;
  const beatBounce = isBeat ? (beatSpring - 0.5) * 10 : 0;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      {Array.from({ length: particleCount }).map((_, i) => {
        const speed = 0.2 + (i % 4) * 0.1;
        const size = 2 + (i % 3) * 1.5;
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
              opacity: 0.5 + (i % 3) * 0.25 + bass * 0.2,
              boxShadow: i % 3 === 0 ? `0 0 ${6 + bass * 12}px ${section.palette.glow}60` : "none",
              transform: `scale(${1 + (isBeat ? bass * 0.4 : 0)})`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ─── 3D Scene Section ───
const Scene3DLayer: React.FC<any> = ({ section, t, bass, mid, treble, beatSpring, width, height, isBeat }) => {
  const opacity = section.name === "BREAKDOWN" ? 0 : Math.min(1, section.energy + 0.3);
  const scale = (1 + bass * 0.1) * (0.96 + (beatSpring - 0.5) * 0.08) * (1 + (isBeat ? bass * 0.1 : 0));
  // Position: left side for intro/verse, center for chorus
  const posX = section.name === "INTRO" ? -3.5 : section.energy > 0.7 ? 0.5 : -2.5;
  const posY = 0.3 + Math.sin(t * 0.4) * 0.2 + (isBeat ? bass * 0.15 : 0);

  return (
    <AbsoluteFill style={{ opacity, pointerEvents: "none" }}>
      <ThreeCanvas width={width} height={height} style={{ backgroundColor: "transparent" }}>
        <ambientLight intensity={0.3 + section.energy * 0.4} />
        <directionalLight position={[3, 5, 4]} intensity={0.6 + section.energy * 0.5} />
        <pointLight position={[-3, -2, 2]} intensity={0.3 + treble * 0.4} color={section.palette.glow} />
        <pointLight position={[3, 2, -2]} intensity={0.2 + mid * 0.3} color={section.palette.primary} />
        <group scale={scale} rotation={[t * 0.15 + bass * 0.1, t * 0.25 + bass * 0.2, Math.sin(t * 0.2) * 0.05]} position={[posX, posY, -1] as any}>
          <mesh>
            <icosahedronGeometry args={[0.9, 0]} />
            <meshStandardMaterial color={section.palette.primary} emissive={section.palette.glow} emissiveIntensity={0.4 + treble * 0.6} metalness={0.85} roughness={0.12} />
          </mesh>
          <mesh scale={1.03}>
            <icosahedronGeometry args={[0.9, 1]} />
            <meshBasicMaterial color={section.palette.glow} wireframe transparent opacity={0.12 + bass * 0.1} />
          </mesh>
          {/* Inner glow core */}
          <mesh scale={0.45}>
            <sphereGeometry args={[0.6, 16, 16]} />
            <meshBasicMaterial color={section.palette.glow} transparent opacity={0.25 + bass * 0.3} />
          </mesh>
        </group>
      </ThreeCanvas>
    </AbsoluteFill>
  );
};

// ─── Waveform Section ───
const WaveformSection: React.FC<any> = ({ waveform, section, width, height, t, bass }) => {
  const wavePath = createSmoothSvgPath({
    points: waveform.map((y: number, i: number) => ({
      x: (i / (waveform.length - 1)) * width,
      y: height * 0.78 + y * 50 * (0.5 + bass * 0.8),
    })),
  });

  const opacity = section.name === "BREAKDOWN" ? 0.2 : section.energy > 0.8 ? 0.5 : 0.3;
  const strokeWidth = section.name.includes("CHORUS") ? 1.5 : 1;

  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity }}>
      <path d={wavePath} fill="none" stroke={section.palette.glow} strokeWidth={strokeWidth} opacity={0.6} />
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
      <div style={{ textAlign: "center", maxWidth: 1100 }}>
        {isChorus ? (
          // Chorus: Large hero text with split bounce animation
          <div style={{ fontSize: section.typography.size * typoScale, fontWeight: section.typography.weight, letterSpacing: section.typography.spacing, fontFamily: section.typography.family, color: "#ffffff", textShadow: `0 0 40px ${section.palette.glow}40`, transform: `scale(${1 + bass * 0.03})`, opacity: interpolate(lyricProgress, [0, 0.1], [0, 1]), transition: "opacity 0.3s" }}>
            {currentLyric.text.split("").map((ch: string, i: number) => (
              <span key={i} style={{ display: "inline-block", transform: `translateY(${Math.sin(t * 3 + i * 0.5) * (2 + bass * 5)}px)`, opacity: lyricProgress > i / currentLyric.text.length ? 1 : 0.3 }}>
                {ch === " " ? "\u00A0" : ch}
              </span>
            ))}
          </div>
        ) : isBreakdown ? (
          // Breakdown: Spaced minimal
          <div style={{ display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap" }}>
            {words.map((w: string, i: number) => {
              const active = lyricProgress >= i / words.length && lyricProgress < (i + 1) / words.length;
              return (
                <span key={i} style={{ fontFamily: section.typography.family, fontSize: section.typography.size * typoScale, fontWeight: active ? 500 : 200, letterSpacing: section.typography.spacing, color: active ? section.palette.glow : `rgba(255,255,255,${active ? 0.9 : 0.3})`, textTransform: "uppercase", textShadow: active ? `0 0 15px ${section.palette.glow}60` : "none" }}>
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
                <span key={i} style={{ fontFamily: section.typography.family, fontSize: section.typography.size * typoScale, fontWeight: active ? section.typography.weight + 100 : section.typography.weight, letterSpacing: section.typography.spacing, color: appeared ? "#ffffff" : active ? section.palette.glow : `rgba(255,255,255,0.25)`, textShadow: active ? `0 0 12px ${section.palette.glow}40` : "none", transform: active ? "translateY(-3px)" : "none", opacity: interpolate(lyricProgress, [i / words.length, i / words.length + 0.05], [0, 1]), transition: "all 0.2s ease" }}>
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
