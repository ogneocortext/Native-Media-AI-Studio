/* eslint-disable @remotion/no-background-image, @remotion/non-pure-animation */
import {
  AbsoluteFill,
  Audio,
  Img,
  Easing,
  Composition,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { StudioBackButton } from "./components/StudioBackButton";
import {
  useWindowedAudioData,
  visualizeAudio,
  visualizeAudioWaveform,
  createSmoothSvgPath,
} from "@remotion/media-utils";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";
import React from "react";

// ─────────────────────────────────────────────────────────────
// The Signal — 136 BPM Progressive Trance — 242.32s (7269f @30fps)
// Librosa: 528 beats, 8 sections energy-mapped. Storyboard: docs/STORYBOARD_SignalBreakingThroughNoise.md
// Prompt: infinite dawn landscape, electric blue horizon, supersaw, minor-key arpeggiator
// ─────────────────────────────────────────────────────────────
const FPS = 30;
const DURATION_SECONDS = 242.32;
const DURATION_FRAMES = Math.ceil(DURATION_SECONDS * FPS); // 7269

type LyricLine = { start: number; end: number; text: string; section: string };
const lyricBlocks: { start: number; end: number; lines: string[]; section: string }[] = [
  {
    start: 0,
    end: 30.5,
    section: "INTRO",
    lines: [
      "I used to stand at the edge of everything I knew",
      "Watching the old world fade into a different kind of blue",
      "I drew my maps in silence, traced the lines with borrowed light",
      "And somewhere in the static I found something worth the fight",
    ],
  },
  {
    start: 30.5,
    end: 60.36,
    section: "VERSE 01",
    lines: [
      "The city changed around me and the code rewrote the sky",
      "But I was learning how to breathe inside the reason why",
      "Every door that closed behind me opened something new",
      "I built myself from frequencies I never thought I knew",
    ],
  },
  {
    start: 60.36,
    end: 90.79,
    section: "CHORUS 01",
    lines: [
      "I am the signal breaking through the noise",
      "I am the light that finds the dark and makes a choice",
      "Static in my veins but I am not afraid",
      "I am the frequency",
      "I am the frequency",
    ],
  },
  {
    start: 90.79,
    end: 121.24,
    section: "CHORUS 02",
    lines: [
      "I am the signal breaking through the noise",
      "I am the light that finds the dark and makes a choice",
      "Static in my veins but I am not afraid",
      "I am the frequency",
      "I am the frequency",
    ],
  },
  {
    start: 121.24,
    end: 151.45,
    section: "BREAKDOWN",
    lines: ["Still here", "Still moving", "Still drawing the map", "Still here", "Still moving", "Through the light and back"],
  },
  {
    start: 151.45,
    end: 181.67,
    section: "CHORUS 03 — PEAK",
    lines: [
      "I am the signal breaking through the noise",
      "I am the light that finds the dark and makes a choice",
      "Static in my veins but I am not afraid",
      "I am the frequency",
      "I am the frequency",
    ],
  },
  {
    start: 181.67,
    end: 212.04,
    section: "BUILD-UP",
    lines: ["Rising", "Rising", "Let it break through", "Rising", "Rising", "Let it take you"],
  },
  {
    start: 212.04,
    end: 242.32,
    section: "FINAL TRANSMISSION",
    lines: [
      "The borrowed light became my own, the grief became a song",
      "And everything I thought I lost was where I still belong",
      "Not the version that was promised, not the life I thought I'd find",
      "But something real and present and entirely mine",
    ],
  },
];
const lyrics: LyricLine[] = lyricBlocks.flatMap((b) => {
  const per = (b.end - b.start) / b.lines.length;
  return b.lines.map((text, i) => ({ start: b.start + i * per, end: b.start + (i + 1) * per, text, section: b.section }));
});
const transitionTimes = [30.5, 60.36, 90.79, 121.24, 151.45, 181.67, 212.04];
const PALETTE = {
  intro: "hsl(218 92% 66%)", // electric blue horizon
  verse: "hsl(205 85% 66%)",
  chorus: "hsl(258 92% 66%)",
  chorusPeak: "hsl(36 92% 62%)", // supersaw gold peak
  breakdown: "hsl(28 72% 62%)",
  outro: "hsl(36 84% 64%)",
};
const getSectionColor = (section: string, bassMix: number, isPeak: boolean) => {
  if (section.includes("PEAK")) return PALETTE.chorusPeak;
  if (section.includes("CHORUS")) return isPeak || bassMix > 0.45 ? PALETTE.chorusPeak : PALETTE.chorus;
  if (section.includes("BREAKDOWN") || section.includes("BUILD")) return PALETTE.breakdown;
  if (section.includes("INTRO")) return PALETTE.intro;
  if (section.includes("FINAL")) return PALETTE.outro;
  return bassMix > 0.3 ? "hsl(212 85% 68%)" : PALETTE.verse;
};
const EASE_ENTER = Easing.bezier(0, 0, 0.2, 1);

type Props = {
  visualSrc?: string;
  visualStyle?: "bars" | "waveform" | "circular" | "particles";
  colorScheme?: "neon" | "fire" | "ocean" | "monochrome";
};

export const MyComposition = () => {
  return (
    <Composition
      id="SignalBreakingThroughNoise"
      component={SignalPro}
      durationInFrames={DURATION_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{
        visualSrc: "",
        visualStyle: "bars" as const,
        colorScheme: "neon" as const,
      }}
    />
  );
};
export const MyComponent: React.FC<Props> = () => <SignalPro />;

export const SignalPro: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
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
    ? visualizeAudioWaveform({ fps, frame, audioData, numberOfSamples: 280, windowInSeconds: 0.6, dataOffsetInSeconds })
    : new Array(280).fill(0);
  const low = spectrum.slice(0, 10);
  const bass = low.reduce((a, b) => a + b, 0) / low.length || 0;
  const mid = spectrum.slice(10, 28).reduce((a, b) => a + b, 0) / 18 || 0;
  const high = spectrum.slice(28, 52).reduce((a, b) => a + b, 0) / 24 || 0;
  const bassPulse = interpolate(bass, [0, 0.6], [1, 1.35], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const beatSpring = spring({ frame: bass > 0.32 ? frame % 14 : 0, fps, config: { damping: 18, stiffness: 180, mass: 0.6 } }); // 136 BPM → ~13.2f per beat
  const crystalSpring = spring({ frame: frame % 45, fps, config: { damping: 22, stiffness: 90 } });
  const physicsJitter = (beatSpring - 0.5) * 0.06 + bass * 0.08;
  const t = frame / fps;
  const progress = frame / DURATION_FRAMES;
  const currentLyric = lyrics.find((l) => t >= l.start && t < l.end) ?? lyrics[0];
  const lyricProgress = currentLyric ? (t - currentLyric.start) / (currentLyric.end - currentLyric.start) : 0;
  const isPeak = currentLyric.section.includes("PEAK") || t >= 151.45 && t < 181.67;
  const glowColor = getSectionColor(currentLyric.section, bass + mid, isPeak);
  const isChorus = currentLyric.section.includes("CHORUS");
  const isVerse = currentLyric.section.includes("VERSE");
  const isBreakdown = currentLyric.section.includes("BREAKDOWN") || currentLyric.section.includes("BUILD");
  const isIntro = currentLyric.section.includes("INTRO");
  const isOutro = currentLyric.section.includes("FINAL");
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
  const wipeX = interpolate(wipeProgress, [0, 1], [-900, 2700], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_ENTER,
  });
  const words = currentLyric.text.split(" ");
  const camX = isChorus ? Math.sin(t * 0.22) * 10 + bass * 14 : isVerse ? Math.sin(t * 0.14) * 8 : Math.sin(t * 0.08) * 4;
  const camY = isBreakdown ? Math.cos(t * 0.18) * 6 : Math.cos(t * 0.12) * 5;
  const camScale = isChorus ? 1.02 + bass * 0.03 : isIntro ? 0.985 + progress * 0.03 : 1.01 + bass * 0.015;
  const wavePath = createSmoothSvgPath({
    points: waveform.map((y, i) => ({
      x: (i / (waveform.length - 1)) * width,
      y: height * 0.585 + y * 92 * (0.55 + bass * 1.1),
    })),
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#070a13", fontFamily: "Space Grotesk, sans-serif", overflow: "hidden" }}>
      <Audio src={staticFile("signal.mp3")} />
      <StudioBackButton />

      {/* ——— Dawn horizon — scenery with electric blue infinite landscape ——— */}
      <AbsoluteFill style={{ transform: `scale(${camScale}) translate(${camX}px, ${camY}px)` }}>
        <Img
          src={staticFile("blender-scenery.png")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: isBreakdown
              ? "brightness(0.68) contrast(1.08) saturate(0.72) blur(0.6px)"
              : isChorus
                ? `brightness(${0.94 + mid * 0.13}) saturate(1.1) contrast(1.06)`
                : `brightness(${0.88 + mid * 0.11}) contrast(1.04)`,
            opacity: isIntro ? 0.62 : isOutro ? 0.68 : 0.74,
          }}
        />
        {/* Dawn gradient — electric blue → warm gold on peak */}
        <AbsoluteFill
          style={{
            background: isPeak
              ? `linear-gradient(180deg, transparent 32%, hsla(36 92% 62% / 0.18) 78%, hsla(240 30% 6% / 0.45) 100%), radial-gradient(900px 600px at 52% 18%, ${glowColor}18 0%, transparent 58%)`
              : `linear-gradient(180deg, transparent 38%, hsla(240 30% 6% / 0.55) 88%), radial-gradient(900px 600px at 52% 38%, ${glowColor}14 0%, transparent 58%)`,
          }}
        />
        {/* Supersaw chord wash — subtle arpeggiator drift */}
        <AbsoluteFill
          style={{
            opacity: isChorus ? 0.16 + bass * 0.12 : isBreakdown ? 0.05 : 0.09,
            background: `radial-gradient(600px 400px at 12% 18%, ${glowColor} 0%, transparent 55%), radial-gradient(500px 380px at 88% 82%, hsl(218 92% 66% / 0.9) 0%, transparent 58%)`,
            transform: `translate(${Math.sin(t * 0.07) * 10}px, ${Math.cos(t * 0.06) * 6}px)`,
          }}
        />
      </AbsoluteFill>

      {/* Film texture — paper fiber + burlap, dawn haze */}
      <AbsoluteFill
        style={{
          opacity: isBreakdown ? 0.075 : 0.045,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.92' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.35'/%3E%3C/svg%3E")`,
          transform: `translate(${Math.sin(t * 0.9) * 0.6}px, ${Math.cos(t * 0.7) * 0.4}px)`,
        } as React.CSSProperties}
      />
      <AbsoluteFill
        style={{
          opacity: 0.035,
          mixBlendMode: "overlay",
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 300 300' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='p'%3E%3CfeTurbulence baseFrequency='0.65' numOctaves='4'/%3E%3CfeColorMatrix values='1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0.55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23p)'/%3E%3C/svg%3E")`,
          transform: `scale(1.2)`,
        } as React.CSSProperties}
      />
      <AbsoluteFill
        style={{
          opacity: isVerse ? 0.025 : 0.015,
          mixBlendMode: "soft-light",
          background: `repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 14px), repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 14px)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: glowColor,
          opacity: interpolate(bass > 0.36 ? 1 : 0, [0, 1], [0, isChorus ? 0.05 : 0.03]),
          mixBlendMode: "soft-light",
        }}
      />
      {/* Signal motes — 18 drifting particles like supersaw sparkle */}
      <AbsoluteFill style={{ pointerEvents: "none", opacity: isChorus ? 0.42 : isIntro ? 0.18 : 0.28 }}>
        {Array.from({ length: 18 }).map((_, i) => {
          const px = (i * 137.5 + frame * (0.12 + (i % 3) * 0.04)) % width;
          const py = 140 + Math.sin(t * 0.22 + i) * 40 + (i % 4) * 88 + high * 22;
          const sz = 1.2 + (i % 5) * 0.7 + bass * 2.2;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: px,
                top: py,
                width: sz,
                height: sz,
                borderRadius: 999,
                background: glowColor,
                opacity: 0.18 + (i % 3) * 0.08 + bass * 0.12,
                boxShadow: `0 0 8px ${glowColor}`,
                transform: `translateY(${Math.sin(t * 0.6 + i) * 6}px)`,
              }}
            />
          );
        })}
      </AbsoluteFill>

      {/* ——— Character — dawn silhouette, frequency-formed ——— */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "71%",
            width: 420,
            height: 90,
            background: "radial-gradient(ellipse at center, rgba(0,0,0,0.62) 0%, transparent 68%)",
            transform: `translate(-50%, -50%) scale(${0.88 + bass * 0.14 + physicsJitter},1)`,
            filter: "blur(7px)",
            opacity: 0.92,
          }}
        />
        <Img
          src={staticFile("blender-character.png")}
          style={{
            position: "absolute",
            left: isChorus ? "48%" : isVerse ? "52%" : "50%",
            top: isChorus ? "48%" : "50%",
            width: isChorus ? 620 : isIntro ? 500 : 560,
            height: isChorus ? 780 : isIntro ? 640 : 720,
            objectFit: "contain",
            transform: `translate(-50%, -50%) translate(${Math.sin(t * 0.45 + (isChorus ? 1 : 0)) * 10 + bass * 12 + physicsJitter * 28}px, ${Math.cos(t * 0.32) * 6 + crystalSpring * 2}px) scale(${0.97 + bass * 0.09 + physicsJitter * 0.04}) rotate(${physicsJitter * 1.2}deg)`,
            filter: `drop-shadow(0 22px 32px rgba(0,0,0,0.62)) drop-shadow(0 0 20px ${glowColor}60) brightness(${1 + high * 0.2}) contrast(1.04)`,
            opacity: 0.97,
          }}
        />
        <Img
          src={staticFile("blender-character.png")}
          aria-hidden
          style={{
            position: "absolute",
            left: isChorus ? "48%" : isVerse ? "52%" : "50%",
            top: "86.5%",
            width: isChorus ? 620 : isIntro ? 500 : 560,
            height: 320,
            objectFit: "contain",
            objectPosition: "top",
            transform: `translate(-50%, -50%) scale(${0.97 + bass * 0.06}, -0.42) translateY(48px)`,
            opacity: 0.11,
            filter: "blur(2.2px) brightness(0.9)",
            WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 78%)",
            maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 78%)",
          } as React.CSSProperties}
        />
      </AbsoluteFill>

      {/* Props — map for “maps/frequencies”, city-code light */}
      <AbsoluteFill style={{ opacity: isVerse ? 0.82 : isBreakdown ? 0.42 : isOutro ? 0.55 : 0.28, filter: isChorus ? "blur(1.2px)" : "none" }}>
        <Img
          src={staticFile("blender-props.png")}
          style={{
            position: "absolute",
            right: isChorus ? 88 : 72,
            bottom: isChorus ? 182 : 148,
            width: isChorus ? 360 : 420,
            height: isChorus ? 240 : 280,
            objectFit: "contain",
            transform: `scale(${1 + mid * 0.04}) rotate(${Math.sin(t * 0.14) * 0.9}deg)`,
            filter: "drop-shadow(0 10px 22px rgba(0,0,0,0.45))",
          }}
        />
      </AbsoluteFill>

      {/* ——— Three.js — frequency crystal (supersaw = layered icosahedron) ——— */}
      <AbsoluteFill style={{ opacity: isChorus ? 0.94 : isIntro ? 0.52 : isBreakdown ? 0.0 : 0.76 }}>
        <ThreeCanvas width={width} height={height} style={{ backgroundColor: "transparent" }}>
          <ambientLight intensity={0.48} />
          <directionalLight position={[4, 7, 5]} intensity={1.15} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005} />
          <directionalLight position={[-4, 3, -2]} intensity={0.55} color={glowColor} />
          <pointLight position={[-4, -2, 3]} intensity={0.72} color={glowColor} />
          <group
            scale={bassPulse * 0.88 * (1 + physicsJitter * 0.08)}
            rotation={[t * 0.22 + crystalSpring * 0.04, t * 0.5 + bass * 0.4 + physicsJitter * 0.5, physicsJitter * 0.12]}
            position={[isChorus ? 0.62 : -1.08, isChorus ? 0.22 : 0.36, 0] as unknown as THREE.Vector3}
          >
            <mesh castShadow receiveShadow>
              <icosahedronGeometry args={[0.95, 0]} />
              <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={0.32 + high * 0.55} metalness={0.88} roughness={0.14} envMapIntensity={1.15} />
            </mesh>
            <mesh castShadow>
              <icosahedronGeometry args={[0.985, 1]} />
              <meshBasicMaterial color={glowColor} wireframe transparent opacity={0.13} />
            </mesh>
            <mesh scale={0.505} castShadow>
              <octahedronGeometry args={[0.8, 0]} />
              <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.88} metalness={0.12} roughness={0.08} transparent opacity={0.94} />
            </mesh>
          </group>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.88, 0]}>
            <planeGeometry args={[14, 14]} />
            <meshStandardMaterial color="#0d1220" metalness={0.92} roughness={0.11} envMapIntensity={0.85} transparent opacity={0.92} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.85, 0]}>
            <ringGeometry args={[1.08 + bass * 0.6, 1.21 + bass * 0.6, 64]} />
            <meshBasicMaterial color={glowColor} transparent opacity={0.15 + bass * 0.19} side={THREE.DoubleSide} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.845, 0]}>
            <circleGeometry args={[0.92 + bass * 0.22, 64]} />
            <meshBasicMaterial color="white" transparent opacity={0.045 + bass * 0.06} side={THREE.DoubleSide} />
          </mesh>
        </ThreeCanvas>
      </AbsoluteFill>

      {/* Waveform — thin arpeggiator line */}
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: isChorus ? 0.85 : isBreakdown ? 0.38 : 0.62 }}>
        <path d={wavePath} fill="none" stroke={glowColor} strokeWidth={isChorus ? 1.7 : 1.2} opacity={0.88} style={{ filter: `drop-shadow(0 0 8px ${glowColor})` }} />
      </svg>

      {/* Bento — 136 BPM meta + 32-bar spectrum (only verse/chorus) */}
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-end", padding: 28, pointerEvents: "none" }}>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-end", opacity: isBreakdown ? 0.0 : 1, transform: `translateY(${isBreakdown ? 12 : 0}px)`, transition: "opacity 0.4s, transform 0.4s" } as React.CSSProperties}>
          <div
            style={{
              width: 280,
              height: 140,
              borderRadius: 22,
              background: "rgba(18,22,34,0.72)",
              backdropFilter: "blur(18px)",
              WebkitBackdropFilter: "blur(18px)",
              border: "1px solid rgba(255,255,255,0.09)",
              padding: 18,
              boxShadow: "0 10px 32px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.06)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div style={{ fontFamily: "DM Mono, monospace", fontSize: 10, letterSpacing: "0.18em", color: "rgba(255,255,255,0.56)" }}>
              136 BPM • PROGRESSIVE TRANCE • {Math.floor((t % 8) + 1)}/8 BEAT
            </div>
            <div style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 13, fontWeight: 600, color: "white", lineHeight: 1.2 }}>
              {currentLyric.section}
              <br />
              <span style={{ color: glowColor, fontWeight: 400, fontSize: 11 }}>{currentLyric.text.slice(0, 30)}…</span>
            </div>
            <div style={{ width: "100%", height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ width: `${progress * 100}%`, height: "100%", background: glowColor, boxShadow: `0 0 8px ${glowColor}` }} />
            </div>
          </div>
          <div
            style={{
              width: 420,
              height: 140,
              borderRadius: 22,
              background: "rgba(18,22,34,0.62)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: "1px solid rgba(255,255,255,0.08)",
              padding: "14px 16px 12px",
              boxShadow: "0 10px 32px rgba(0,0,0,0.38)",
              display: "flex",
              alignItems: "flex-end",
              gap: 3,
            }}
          >
            {spectrum
              .filter((_, i) => i % 2 === 0)
              .slice(0, 32)
              .map((v, i) => {
                const db = v > 0 ? 20 * Math.log10(v) : -100;
                const scaled = Math.max(0, (db + 60) / 60);
                const h = 8 + scaled * 86 + (i < 8 ? bass * 16 : 0);
                const isB = i < 6;
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      height: h,
                      backgroundColor: isB ? glowColor : i < 14 ? "rgba(255,255,255,0.92)" : `hsla(${isChorus ? 258 : 205} 70% 76% / 0.85)`,
                      opacity: isB ? 0.95 : 0.72,
                      borderRadius: 6,
                      boxShadow: isB ? `0 0 10px ${glowColor}90` : "none",
                      transformOrigin: "bottom",
                    }}
                  />
                );
              })}
          </div>
        </div>
      </AbsoluteFill>

      {/* Wipe transition — blender-transition.png diagonal */}
      {activeTransition !== -1 && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(100deg, transparent 42%, ${glowColor} 49%, white 50%, ${glowColor} 51.5%, transparent 62%)`,
              opacity: interpolate(wipeProgress, [0, 0.5, 1], [0, 0.22, 0]),
              transform: `translateX(${wipeX - 1200}px)`,
            }}
          />
          <Img
            src={staticFile("blender-transition.png")}
            style={{
              position: "absolute",
              left: wipeX,
              top: "50%",
              width: 1200,
              height: 180,
              objectFit: "contain",
              transform: "translateY(-50%) rotate(14deg) scale(1.1)",
              opacity: interpolate(wipeProgress, [0, 0.12, 0.88, 1], [0, 1, 1, 0]),
              filter: `drop-shadow(0 0 24px ${glowColor}) brightness(1.25)`,
            }}
          />
        </AbsoluteFill>
      )}

      {/* HUD */}
      <div
        style={{
          position: "absolute",
          top: 32,
          left: 32,
          right: 32,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "DM Mono, monospace",
          fontSize: 11,
          letterSpacing: "0.16em",
          color: "rgba(154,182,200,0.82)",
          opacity: 0.92,
        }}
      >
        <span
          style={{
            background: "rgba(12,16,26,0.62)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.07)",
            padding: "7px 12px",
            borderRadius: 99,
          }}
        >
          NEOCORTEXT — THE SIGNAL • 136 BPM • INFINITE DAWN
        </span>
        <span
          style={{
            background: "rgba(12,16,26,0.62)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.07)",
            padding: "7px 12px",
            borderRadius: 99,
          }}
        >
          {String(Math.floor(t / 60)).padStart(2, "0")}:{(Math.floor(t % 60) + "").padStart(2, "0")} / 04:02 • {currentLyric.section}
        </span>
      </div>

      {/* Lyrics — act-specific typography: intro pill, verse editorial, chorus hero, bridge VHS, outro ghost */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
        {isChorus ? (
          <div style={{ textAlign: "center", transform: `scale(${0.99 + bass * 0.045})` }}>
            <div
              style={{
                display: "flex",
                gap: 18,
                justifyContent: "center",
                fontSize: 88,
                fontWeight: 800,
                letterSpacing: "-0.04em",
                lineHeight: 1,
                fontFamily: "Space Grotesk, sans-serif",
                color: "white",
                textShadow: `0 0 32px ${glowColor}66`,
              }}
            >
              {"SIGNAL".split("").map((ch, i) => (
                <span
                  key={i}
                  style={{
                    display: "inline-block",
                    transform: `translateY(${Math.sin(t * 3.2 + i * 0.55) * (2 + bass * 6)}px)`,
                    opacity: 0.96,
                  }}
                >
                  {ch}
                </span>
              ))}
              <span style={{ width: 18 }} />
              {"NOISE".split("").map((ch, i) => (
                <span
                  key={i}
                  style={{
                    display: "inline-block",
                    color: glowColor,
                    WebkitTextStroke: `1.2px ${glowColor}`,
                    transform: `translateY(${Math.sin(t * 3.2 + i * 0.55 + 2) * (2 + bass * 6)}px)`,
                  }}
                >
                  {ch}
                </span>
              ))}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 38,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "#eef6ff",
                fontFamily: "Space Grotesk, sans-serif",
                textShadow: `0 0 18px ${glowColor}55`,
              }}
            >
              BREAKING THROUGH
            </div>
            <div style={{ marginTop: 18, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", maxWidth: 760 }}>
              {words.map((w, i) => {
                const wStart = i / words.length;
                const wEnd = (i + 1) / words.length;
                const active = lyricProgress >= wStart && lyricProgress < wEnd;
                const appeared = lyricProgress >= wEnd;
                return (
                  <span
                    key={i}
                    style={{
                      fontFamily: "DM Mono, monospace",
                      fontSize: 13,
                      letterSpacing: "0.18em",
                      color: appeared ? "rgba(255,255,255,0.92)" : active ? glowColor : "rgba(255,255,255,0.32)",
                      transform: `translateY(${active ? -2 : 0}px)`,
                      textShadow: active ? `0 0 10px ${glowColor}` : "none",
                    }}
                  >
                    {w}
                  </span>
                );
              })}
            </div>
            <div style={{ marginTop: 10, fontFamily: "DM Mono, monospace", fontSize: 10, letterSpacing: "0.16em", color: "rgba(255,255,255,0.42)" }}>
              {isPeak ? "PEAK • SUPERSAW • 0.923→1.0" : "CHORUS • FOUR-ON-THE-FLOOR"}
            </div>
          </div>
        ) : isBreakdown ? (
          <div style={{ textAlign: "center", maxWidth: 700 }}>
            <div
              style={{
                display: "inline-block",
                background: "rgba(16,18,22,0.68)",
                backdropFilter: "blur(18px)",
                WebkitBackdropFilter: "blur(18px)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 22,
                padding: "28px 42px 22px",
                boxShadow: "0 14px 36px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.06)",
              }}
            >
              <div style={{ fontFamily: "DM Mono, monospace", fontSize: 11, letterSpacing: "0.22em", color: glowColor, opacity: 0.9, marginBottom: 12 }}>
                BREAKDOWN — WHISPERED MALE • 0.282
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                {words.map((w, i) => {
                  const wStart = i / words.length;
                  const wEnd = (i + 1) / words.length;
                  const active = lyricProgress >= wStart && lyricProgress < wEnd;
                  const appeared = lyricProgress >= wEnd;
                  return (
                    <span
                      key={i}
                      style={{
                        fontFamily: "Space Grotesk, sans-serif",
                        fontSize: 26,
                        fontWeight: active ? 700 : 500,
                        color: appeared ? "white" : active ? glowColor : "rgba(255,255,255,0.42)",
                        transform: `translateY(${active ? -3 : 0}px) scale(${active ? 1.06 : 1})`,
                        textShadow: active ? `0 0 12px ${glowColor}88` : "none",
                      }}
                    >
                      {w}
                    </span>
                  );
                })}
              </div>
              <div style={{ width: "100%", height: 2, background: "rgba(255,255,255,0.08)", borderRadius: 99, marginTop: 16, overflow: "hidden" }}>
                <div style={{ width: `${lyricProgress * 100}%`, height: "100%", background: glowColor, boxShadow: `0 0 8px ${glowColor}` }} />
              </div>
            </div>
          </div>
        ) : isOutro ? (
          <div style={{ textAlign: "center", maxWidth: 860 }}>
            <div style={{ fontFamily: "DM Mono, monospace", fontSize: 11, letterSpacing: "0.22em", color: glowColor, opacity: 0.72, marginBottom: 14 }}>
              FINAL TRANSMISSION — 0.794 • RESOLVE
            </div>
            <div style={{ display: "flex", gap: 9, justifyContent: "center", flexWrap: "wrap" }}>
              {words.map((w, i) => {
                const wStart = i / words.length;
                const active = lyricProgress >= wStart && lyricProgress < (i + 1) / words.length;
                return (
                  <span
                    key={i}
                    style={{
                      fontFamily: "Space Grotesk, sans-serif",
                      fontSize: 22,
                      fontWeight: active ? 700 : 400,
                      color: active ? glowColor : "rgba(238,246,255,0.72)",
                      opacity: active ? 1 : 0.62,
                      textShadow: active ? `0 0 14px ${glowColor}88` : "none",
                    }}
                  >
                    {w}
                  </span>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", maxWidth: 820, padding: "0 24px" }}>
            <div
              style={{
                display: "inline-block",
                background: isIntro ? "rgba(18,22,34,0.45)" : "rgba(18,22,34,0.58)",
                backdropFilter: "blur(18px)",
                WebkitBackdropFilter: "blur(18px)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 24,
                padding: isIntro ? "22px 32px 18px" : "22px 32px 18px",
                boxShadow: "0 14px 36px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.06)",
              }}
            >
              <div style={{ fontFamily: "DM Mono, monospace", fontSize: 11, letterSpacing: "0.22em", color: glowColor, opacity: 0.9, marginBottom: 10 }}>
                {currentLyric.section} — {isVerse ? "VERSE • INTIMATE" : isIntro ? "INTRO • DAWN" : "VERSE"}
              </div>
              <div style={{ display: "flex", gap: 9, justifyContent: "center", flexWrap: "wrap" }}>
                {words.map((w, i) => {
                  const wStart = i / words.length;
                  const wEnd = (i + 1) / words.length;
                  const active = lyricProgress >= wStart && lyricProgress < wEnd;
                  const appeared = lyricProgress >= wEnd;
                  return (
                    <span
                      key={i}
                      style={{
                        fontFamily: "Space Grotesk, sans-serif",
                        fontSize: isIntro ? 18 : 19,
                        fontWeight: active ? 700 : 500,
                        color: appeared ? "white" : active ? glowColor : "rgba(255,255,255,0.42)",
                        transform: `translateY(${active ? -3 : 0}px) scale(${active ? 1.06 : 1})`,
                        textShadow: active ? `0 0 12px ${glowColor}88` : "none",
                      }}
                    >
                      {w}
                    </span>
                  );
                })}
              </div>
              <div style={{ width: "100%", height: 2, background: "rgba(255,255,255,0.08)", borderRadius: 99, marginTop: 16, overflow: "hidden" }}>
                <div style={{ width: `${lyricProgress * 100}%`, height: "100%", background: glowColor, boxShadow: `0 0 8px ${glowColor}`, transform: `scaleY(${1 + bass * 0.5})`, transformOrigin: "left" }} />
              </div>
            </div>
            <div style={{ marginTop: 14, fontFamily: "DM Mono, monospace", fontSize: 10, letterSpacing: "0.16em", color: "rgba(255,255,255,0.42)" }}>
              {Math.round(progress * 100)}% • {currentLyric.section} • {isIntro ? "BORROWED LIGHT" : "FREQUENCIES"}
            </div>
          </div>
        )}
      </AbsoluteFill>

      <div
        style={{
          position: "absolute",
          bottom: 18,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: "DM Mono, monospace",
          fontSize: 10,
          letterSpacing: "0.14em",
          color: "rgba(255,255,255,0.32)",
          pointerEvents: "none",
        }}
      >
        BLENDER • THREE.JS • FFMPEG • REMOTION • 136 BPM • PROGRESSIVE TRANCE • INFINITE DAWN • ELECTRIC BLUE HORIZON
      </div>
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, rgba(0,0,0,0.42) 0%, transparent 10%, transparent 90%, rgba(0,0,0,0.45) 100%), radial-gradient(ellipse at center, transparent 68%, rgba(0,0,0,0.52) 100%)`,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 0,
          borderTop: isChorus ? "0px solid transparent" : "18px solid rgba(0,0,0,0.82)",
          opacity: 0.92,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 0,
          borderBottom: isChorus ? "0px solid transparent" : "18px solid rgba(0,0,0,0.82)",
          opacity: 0.92,
        }}
      />
    </AbsoluteFill>
  );
};
export const SignalDuration = DURATION_FRAMES;
export const SignalFps = FPS;
