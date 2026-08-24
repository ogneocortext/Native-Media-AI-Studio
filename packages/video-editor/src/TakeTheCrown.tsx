/* eslint-disable @remotion/no-background-image, @remotion/non-pure-animation */
import { AbsoluteFill, Audio, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { useWindowedAudioData, visualizeAudio, visualizeAudioWaveform, createSmoothSvgPath } from "@remotion/media-utils";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";
import React from "react";

const FPS = 30;
const DURATION_SECONDS = 124.0;
const DURATION_FRAMES = Math.ceil(DURATION_SECONDS * FPS);
const BPM = 152;
const BEAT_FRAMES = (60 / BPM) * FPS; // ~11.8f
const REMASTERED = "take-the-crown-remastered.mp3";
const STEMS = { drums: "stems/drums.mp3", bass: "stems/bass.mp3", vocals: "stems/vocals.mp3", other: "stems/other.mp3" } as const;

type LyricLine = { start: number; end: number; text: string; section: string };
const lyricBlocks: { start: number; end: number; lines: string[]; section: string }[] = [
  { start: 0, end: 30, section: "INTRO", lines: [] },
  { start: 30, end: 40.5, section: "DROP", lines: ["Step out the shadow", "Burn it to the ground", "Watch the new king", "Take the crown"] },
  { start: 40.5, end: 60.3, section: "VERSE", lines: [
    "Used to let the doubt creep up in the mind",
    "Used to leave the best parts of me behind",
    "Look in the mirror, face the ghost",
    "Do what scares you the most",
    "Sweat on the wheel, grip on the edge",
    "Pushed every limit right over the ledge",
    "I took the pain and I made it a tool",
    "Nobody's victim, nobody's fool",
  ] },
  { start: 87, end: 105.5, section: "DROP", lines: [
    "Rising from the ash",
    "Pedal to the floor",
    "I ain't holding back",
    "Not anymore",
    "Burn it to the ground",
    "Watch the new king",
    "Take the crown",
    "Yeah we take the crown",
  ] },
];
const lyrics: LyricLine[] = lyricBlocks.flatMap((b) => {
  if (!b.lines.length) return [];
  const per = (b.end - b.start) / b.lines.length;
  return b.lines.map((text, i) => ({ start: b.start + i * per, end: b.start + (i + 1) * per, text, section: b.section }));
});
const transitionTimes = [30, 40.5, 87];
const PALETTE = { drop: "hsl(42 92% 60%)", verse: "hsl(198 88% 62%)", intro: "hsl(30 70% 46%)" };
const getSectionColor = (section: string, bassMix: number) => {
  if (section.includes("DROP")) return PALETTE.drop;
  if (section.includes("INTRO")) return PALETTE.intro;
  return bassMix > 0.3 ? "hsl(205 85% 64%)" : PALETTE.verse;
};
const EASE_ENTER = Easing.bezier(0, 0, 0.2, 1);
const SPIKES = 6;
export const TakeTheCrownComposition: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const win = { fps, frame, windowInSeconds: 30 } as const;
  const { audioData, dataOffsetInSeconds } = useWindowedAudioData({ src: staticFile(REMASTERED), ...win });
  const drumsAudio = useWindowedAudioData({ src: staticFile(STEMS.drums), ...win });
  const bassAudio = useWindowedAudioData({ src: staticFile(STEMS.bass), ...win });
  const vocalsAudio = useWindowedAudioData({ src: staticFile(STEMS.vocals), ...win });
  const otherAudio = useWindowedAudioData({ src: staticFile(STEMS.other), ...win });
  const spectrum = audioData ? visualizeAudio({ fps, frame, audioData, numberOfSamples: 64, optimizeFor: "speed", dataOffsetInSeconds }) : new Array(64).fill(0);
  const waveform = audioData ? visualizeAudioWaveform({ fps, frame, audioData, numberOfSamples: 280, windowInSeconds: 0.6, dataOffsetInSeconds }) : new Array(280).fill(0);
  const stemSpec = (d: typeof drumsAudio, n: number) => d.audioData ? visualizeAudio({ fps, frame, audioData: d.audioData, numberOfSamples: n, optimizeFor: "speed", dataOffsetInSeconds: d.dataOffsetInSeconds }) : new Array(n).fill(0);
  const drums = stemSpec(drumsAudio, 32);
  const bassSp = stemSpec(bassAudio, 16);
  const vocalsSp = stemSpec(vocalsAudio, 32);
  const otherSp = stemSpec(otherAudio, 32);
  const drumsEnergy = drums.reduce((a, b) => a + b, 0) / drums.length || 0;
  const bassEnergy = bassSp.reduce((a, b) => a + b, 0) / bassSp.length || 0;
  const vocalsEnergy = vocalsSp.reduce((a, b) => a + b, 0) / vocalsSp.length || 0;
  const otherEnergy = otherSp.reduce((a, b) => a + b, 0) / otherSp.length || 0;
  const low = spectrum.slice(0, 10);
  const bass = low.reduce((a, b) => a + b, 0) / low.length || 0;
  const mid = spectrum.slice(10, 28).reduce((a, b) => a + b, 0) / 18 || 0;
  const high = spectrum.slice(28, 52).reduce((a, b) => a + b, 0) / 24 || 0;
  const _bassPulse = interpolate(bass, [0, 0.6], [1, 1.4], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  void _bassPulse;
  // Stem-driven signals: drums -> crown pulse, bass -> ground rings, vocals -> lyric emphasis, other -> ember haze
  const drumPulse = interpolate(drumsEnergy, [0, 0.5], [1, 1.5], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const _vocalPush = interpolate(vocalsEnergy, [0, 0.4], [1, 1.12], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  void _vocalPush;
  const beatSpring = spring({ frame: drumsEnergy > 0.22 ? frame % Math.round(BEAT_FRAMES) : 0, fps, config: { damping: 18, stiffness: 200, mass: 0.6 } });
  const crownSpring = spring({ frame: frame % 60, fps, config: { damping: 22, stiffness: 90 } });
  const physicsJitter = (beatSpring - 0.5) * 0.06 + drumsEnergy * 0.09;
  const t = frame / fps;
  const progress = frame / DURATION_FRAMES;
  const currentLyric = lyrics.find((l) => t >= l.start && t < l.end);
  const lyricProgress = currentLyric ? (t - currentLyric.start) / (currentLyric.end - currentLyric.start) : 0;
  const beatFlash = drumsEnergy > 0.26 ? 1 : 0;
  const glowColor = getSectionColor(currentLyric ? currentLyric.section : "INTRO", bass + mid);
  const isDrop = currentLyric ? currentLyric.section.includes("DROP") : false;
  const isVerse = currentLyric ? currentLyric.section.includes("VERSE") : false;
  const isIntro = !currentLyric || currentLyric.section.includes("INTRO");
  const isOutro = t >= 105.5;
  let wipeProgress = 0; let activeTransition = -1;
  for (let i = 0; i < transitionTimes.length; i++) { const s = transitionTimes[i]; const e = s + 0.9; if (t >= s && t < e) { wipeProgress = (t - s) / 0.9; activeTransition = i; break; } }
  const wipeX = interpolate(wipeProgress, [0, 1], [-900, 2700], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_ENTER });
  const words = currentLyric ? currentLyric.text.split(" ") : [];
  const camX = isDrop ? Math.sin(t * 0.24) * 10 + drumsEnergy * 20 : isVerse ? Math.sin(t * 0.15) * 8 : Math.sin(t * 0.08) * 4;
  const camY = isDrop ? Math.cos(t * 0.2) * 6 : Math.cos(t * 0.12) * 5;
  const camScale = isDrop ? 1.02 + drumsEnergy * 0.06 : isIntro ? 0.97 + progress * 0.035 : 1.01 + bass * 0.02;
  const emberCount = isDrop ? 34 : isVerse ? 18 : 10;
  const wavePath = createSmoothSvgPath({ points: waveform.map((y, i) => ({ x: (i / (waveform.length - 1)) * width, y: height * 0.58 + y * 96 * (0.5 + bass * 1.2) })) });
  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0706", fontFamily: "Space Grotesk, sans-serif", overflow: "hidden" }}>
      <Audio src={staticFile(REMASTERED)} />
      <AbsoluteFill style={{ transform: `scale(${camScale}) translate(${camX}px, ${camY}px)`, opacity: isOutro ? interpolate(t, [105.5, 116], [1, 0.45]) : 1 }}>
        <Img src={staticFile("crown-cover.png")} style={{ width: "100%", height: "100%", objectFit: "cover", filter: isDrop ? `brightness(${0.62 + mid * 0.18}) saturate(1.25) contrast(1.1) hue-rotate(6deg)` : `brightness(${0.5 + mid * 0.12}) saturate(1.15) contrast(1.06)`, opacity: isIntro ? 0.5 : 0.66 }} />
        <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(10,7,6,0.5) 0%, transparent 45%, rgba(10,7,6,0.78) 92%), radial-gradient(900px 620px at 50% 40%, ${glowColor}1c 0%, transparent 60%)` }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: isDrop ? 0.2 + bass * 0.14 : isVerse ? 0.1 : 0.08, mixBlendMode: "screen", pointerEvents: "none" }}>
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(640px 420px at 50% 22%, ${glowColor} 0%, transparent 55%), radial-gradient(520px 400px at 14% 84%, hsl(14 92% 58% / 0.85) 0%, transparent 58%), radial-gradient(480px 380px at 88% 80%, hsl(48 92% 60% / 0.7) 0%, transparent 56%)`, transform: `translate(${Math.sin(t * 0.07) * 10}px, ${Math.cos(t * 0.06) * 6}px)` }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: isDrop ? 0.07 : 0.05, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.92' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.35'/%3E%3C/svg%3E")`, transform: `translate(${Math.sin(t * 0.9) * 0.6}px, ${Math.cos(t * 0.7) * 0.4}px)` } as React.CSSProperties} />
      <AbsoluteFill style={{ background: glowColor, opacity: interpolate(beatFlash, [0, 1], [0, isDrop ? 0.055 : 0.03]), mixBlendMode: "soft-light", pointerEvents: "none" }} />
      <AbsoluteFill style={{ pointerEvents: "none", opacity: isDrop ? 0.55 : isVerse ? 0.32 : 0.18 }}>
        {Array.from({ length: emberCount }).map((_, i) => {
          const px = (i * 137.5 + frame * (0.14 + (i % 3) * 0.05)) % width;
          const rise = (frame * (0.5 + (i % 4) * 0.13) + i * 37) % (height * 0.9);
          const py = height - 60 - rise + Math.sin(t * 0.6 + i) * 8;
          const sz = 1.6 + (i % 5) * 1.1 + drumsEnergy * 2.6 + otherEnergy * 1.4;
          const warm = i % 2 === 0 ? glowColor : "hsl(14 92% 58%)";
          return <div key={i} style={{ position: "absolute", left: px, top: py, width: sz, height: sz, borderRadius: 999, background: warm, opacity: 0.2 + (i % 3) * 0.09 + bass * 0.12, boxShadow: `0 0 9px ${warm}`, transform: `translateX(${Math.sin(t * 0.4 + i * 1.7) * 14}px)` }} />;
        })}
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ position: "absolute", left: "50%", top: "70%", width: 440, height: 100, background: "radial-gradient(ellipse at center, rgba(0,0,0,0.68) 0%, transparent 70%)", transform: `translate(-50%, -50%) scale(${0.88 + bass * 0.16 + physicsJitter},1)`, filter: "blur(8px)", opacity: 0.94 }} />
        <ThreeCanvas width={width} height={height} style={{ backgroundColor: "transparent" }}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[4, 7, 5]} intensity={1.2} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005} />
          <directionalLight position={[-4, 3, -2]} intensity={0.6} color={glowColor} />
          <pointLight position={[-4, -2, 3]} intensity={0.8} color={glowColor} />
          <pointLight position={[0, 2.4, 1.5]} intensity={1.5 + high * 2} color="#ffb347" distance={7} />
          <group scale={drumPulse * 0.98 * (1 + physicsJitter * 0.05)} rotation={[t * 0.12 + crownSpring * 0.03, t * 0.34 + drumsEnergy * 0.4 + physicsJitter * 0.4, physicsJitter * 0.1]} position={[0, 0.35, 0]}>
            <mesh castShadow><cylinderGeometry args={[1.06, 1.18, 0.6, 48]} /><meshStandardMaterial color="#c99a33" metalness={0.92} roughness={0.16} envMapIntensity={1.2} /></mesh>
            <mesh castShadow><torusGeometry args={[1.24, 0.065, 16, 56]} /><meshStandardMaterial color="#ffd76a" metalness={0.95} roughness={0.12} emissive={glowColor} emissiveIntensity={0.3 + high * 0.45 + bassEnergy * 0.3} /></mesh>
            <mesh position={[0, 0.42, 0]}><torusGeometry args={[1.03, 0.05, 16, 48]} /><meshStandardMaterial color="#f5c14e" metalness={0.9} roughness={0.18} emissive={glowColor} emissiveIntensity={0.2 + drumsEnergy * 0.35} /></mesh>
            {Array.from({ length: SPIKES }).map((_, i) => {
              const a = (i / SPIKES) * Math.PI * 2;
              const x = Math.cos(a) * 1.02;
              const z = Math.sin(a) * 1.02;
              return (
                <group key={i} position={[x, 0.28, z]} rotation={[Math.cos(a) * -0.32, 0, Math.sin(a) * 0.32]}>
                  <mesh castShadow><coneGeometry args={[0.19, 0.95, 6]} /><meshStandardMaterial color="#e8b23c" metalness={0.88} roughness={0.2} emissive="#ffcf6e" emissiveIntensity={0.25 + drumsEnergy * 0.5} /></mesh>
                </group>
              );
            })}
            <mesh position={[0, 1.15, 0]} castShadow><sphereGeometry args={[0.3, 28, 28]} /><meshStandardMaterial color="#fff3c4" emissive="#ffe9a0" emissiveIntensity={0.75 + high * 0.5 + vocalsEnergy * 0.6} metalness={0.3} roughness={0.08} /></mesh>
            <mesh position={[0, -0.32, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[1.22, 0.04, 12, 64]} /><meshBasicMaterial color={glowColor} transparent opacity={0.3 + bass * 0.22} /></mesh>
          </group>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.88, 0]} receiveShadow><planeGeometry args={[16, 16]} /><meshStandardMaterial color="#120a06" metalness={0.9} roughness={0.14} envMapIntensity={0.9} transparent opacity={0.94} /></mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.85, 0]}><ringGeometry args={[1.25 + bassEnergy * 1.1, 1.42 + bassEnergy * 1.1, 64]} /><meshBasicMaterial color={glowColor} transparent opacity={0.16 + bassEnergy * 0.28} side={THREE.DoubleSide} /></mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.84, 0]}><circleGeometry args={[1.06 + bassEnergy * 0.4, 64]} /><meshBasicMaterial color="#ffb347" transparent opacity={0.05 + bassEnergy * 0.1} side={THREE.DoubleSide} /></mesh>
        </ThreeCanvas>
      </AbsoluteFill>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: isDrop ? 0.9 : 0.62 }}>
        <path d={wavePath} fill="none" stroke={glowColor} strokeWidth={isDrop ? 1.8 : 1.2} opacity={0.9} style={{ filter: `drop-shadow(0 0 8px ${glowColor})` }} />
      </svg>
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-end", padding: 28, pointerEvents: "none" }}>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-end" }}>
          <div style={{ width: 280, height: 140, borderRadius: 22, background: "rgba(20,12,8,0.72)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,0.09)", padding: 18, boxShadow: "0 10px 32px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div style={{ fontFamily: "DM Mono, monospace", fontSize: 10, letterSpacing: "0.18em", color: "rgba(255,255,255,0.56)" }}>152 BPM • E MAJOR • 3.6 LU</div>
            <div style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 13, fontWeight: 600, color: "white", lineHeight: 1.2 }}>{currentLyric ? currentLyric.section : "INTRO"}<br /><span style={{ color: glowColor, fontWeight: 400, fontSize: 11 }}>{currentLyric ? currentLyric.text.slice(0, 30) : "Crown rising…"}</span></div>
            <div style={{ width: "100%", height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 99, overflow: "hidden" }}><div style={{ width: `${progress * 100}%`, height: "100%", background: glowColor, boxShadow: `0 0 8px ${glowColor}` }} /></div>
          </div>
          <div style={{ width: 420, height: 140, borderRadius: 22, background: "rgba(20,12,8,0.62)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px 12px", boxShadow: "0 10px 32px rgba(0,0,0,0.38)", display: "flex", alignItems: "flex-end", gap: 3 }}>
            {spectrum.filter((_, i) => i % 2 === 0).slice(0, 32).map((v, i) => {
              const db = v > 0 ? 20 * Math.log10(v) : -100;
              const scaled = Math.max(0, (db + 60) / 60);
              const h = 8 + scaled * 88 + (i < 8 ? bass * 18 : 0);
              const isB = i < 6;
              return <div key={i} style={{ flex: 1, height: h, backgroundColor: isB ? glowColor : i < 14 ? "rgba(255,255,255,0.92)" : "hsla(42 90% 68% / 0.85)", opacity: isB ? 0.95 : 0.72, borderRadius: 6, boxShadow: isB ? `0 0 10px ${glowColor}90` : "none", transformOrigin: "bottom" }} />;
            })}
          </div>
        </div>
      </AbsoluteFill>
      {activeTransition !== -1 && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          <div style={{ position: "absolute", inset: 0, background: `linear-gradient(100deg, transparent 42%, ${glowColor} 49%, white 50%, ${glowColor} 51.5%, transparent 62%)`, opacity: interpolate(wipeProgress, [0, 0.5, 1], [0, 0.24, 0]), transform: `translateX(${wipeX - 1200}px)` }} />
          <div style={{ position: "absolute", left: wipeX, top: "50%", width: 1200, height: 180, objectFit: "contain", transform: "translateY(-50%) rotate(14deg) scale(1.1)", opacity: interpolate(wipeProgress, [0, 0.12, 0.88, 1], [0, 1, 1, 0]), background: `linear-gradient(180deg, ${glowColor} 0%, transparent 100%)`, WebkitMaskImage: "linear-gradient(90deg, transparent, black 12%, black 88%, transparent)", maskImage: "linear-gradient(90deg, transparent, black 12%, black 88%, transparent)" }} />
        </AbsoluteFill>
      )}
      <div style={{ position: "absolute", top: 32, left: 32, right: 32, display: "flex", justifyContent: "space-between", fontFamily: "DM Mono, monospace", fontSize: 11, letterSpacing: "0.16em", color: "rgba(232,200,150,0.82)", opacity: 0.92 }}>
        <span style={{ background: "rgba(16,10,6,0.62)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.07)", padding: "7px 12px", borderRadius: 99 }}>NATHANIEL SMALLEY — TAKE THE CROWN</span>
        <span style={{ background: "rgba(16,10,6,0.62)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.07)", padding: "7px 12px", borderRadius: 99 }}>{String(Math.floor(t / 60)).padStart(2, "0")}:{(Math.floor(t % 60) + "").padStart(2, "0")} / 02:04 • {currentLyric ? currentLyric.section : "INTRO"}</span>
      </div>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
        {isDrop ? (
          <div style={{ textAlign: "center", transform: `scale(${0.99 + bass * 0.05 + vocalsEnergy * 0.06})` }}>
            <div style={{ display: "flex", gap: 14, justifyContent: "center", fontSize: 92, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, fontFamily: "Space Grotesk, sans-serif", color: "white", textShadow: `0 0 36px ${glowColor}77` }}>
              {"TAKE".split("").map((ch, i) => (<span key={i} style={{ display: "inline-block", transform: `translateY(${Math.sin(t * 3.4 + i * 0.55) * (2 + drumsEnergy * 9)}px)`, opacity: 0.96 }}>{ch}</span>))}
              <span style={{ width: 16 }} />
              {"THE".split("").map((ch, i) => (<span key={i} style={{ display: "inline-block", color: "#fff3c4", transform: `translateY(${Math.sin(t * 3.4 + i * 0.55 + 2) * (2 + drumsEnergy * 9)}px)` }}>{ch}</span>))}
            </div>
            <div style={{ marginTop: 6, display: "flex", gap: 10, justifyContent: "center", fontSize: 76, fontWeight: 800, letterSpacing: "-0.03em", color: glowColor, WebkitTextStroke: `1.2px ${glowColor}`, lineHeight: 0.9 }}>CROWN</div>
            <div style={{ marginTop: 18, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", maxWidth: 800 }}>
              {words.map((w, i) => { const wStart = i / words.length; const wEnd = (i + 1) / words.length; const active = lyricProgress >= wStart && lyricProgress < wEnd; const appeared = lyricProgress >= wEnd; return (<span key={i} style={{ fontFamily: "DM Mono, monospace", fontSize: 13, letterSpacing: "0.18em", color: appeared ? "rgba(255,255,255,0.92)" : active ? glowColor : "rgba(255,255,255,0.32)", transform: `translateY(${active ? -2 : 0}px)`, textShadow: active ? `0 0 10px ${glowColor}` : "none", transition: "all 0.18s ease" }}>{w}</span>); })}
            </div>
          </div>
        ) : isVerse ? (
          <div style={{ textAlign: "center", maxWidth: 860, padding: "0 24px" }}>
            <div style={{ display: "inline-block", background: "rgba(20,12,8,0.6)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 24, padding: "22px 32px 18px", boxShadow: "0 14px 36px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
              <div style={{ fontFamily: "DM Mono, monospace", fontSize: 11, letterSpacing: "0.22em", color: glowColor, opacity: 0.9, marginBottom: 10 }}>VERSE</div>
              <div style={{ display: "flex", gap: 9, justifyContent: "center", flexWrap: "wrap" }}>
                {words.map((w, i) => { const wStart = i / words.length; const wEnd = (i + 1) / words.length; const active = lyricProgress >= wStart && lyricProgress < wEnd; const appeared = lyricProgress >= wEnd; return (<span key={i} style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 20, fontWeight: active ? 700 : 500, color: appeared ? "white" : active ? glowColor : "rgba(255,255,255,0.42)", transform: `translateY(${active ? -3 : 0}px) scale(${active ? 1.06 : 1})`, textShadow: active ? `0 0 12px ${glowColor}88` : "none", transition: "all 0.16s cubic-bezier(0.34,1.56,0.64,1)" }}>{w}</span>); })}
              </div>
              <div style={{ width: "100%", height: 2, background: "rgba(255,255,255,0.08)", borderRadius: 99, marginTop: 16, overflow: "hidden" }}><div style={{ width: `${lyricProgress * 100}%`, height: "100%", background: glowColor, boxShadow: `0 0 8px ${glowColor}`, transform: `scaleY(${1 + bass * 0.5})`, transformOrigin: "left" }} /></div>
            </div>
            <div style={{ marginTop: 14, fontFamily: "DM Mono, monospace", fontSize: 10, letterSpacing: "0.16em", color: "rgba(255,255,255,0.42)" }}>{Math.round(progress * 100)}% • VERSE</div>
          </div>
        ) : (
          <div style={{ textAlign: "center", maxWidth: 700, padding: "0 24px", opacity: isOutro ? interpolate(t, [105.5, 116], [1, 0]) : 1 }}>
            <div style={{ display: "inline-block", background: "rgba(16,10,6,0.5)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 24, padding: "26px 40px", boxShadow: "0 14px 36px rgba(0,0,0,0.42)" }}>
              <div style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 40, fontWeight: 800, letterSpacing: "-0.02em", color: "white", lineHeight: 1.1 }}>TAKE THE CROWN</div>
              <div style={{ marginTop: 10, fontFamily: "DM Mono, monospace", fontSize: 11, letterSpacing: "0.24em", color: glowColor }}>{isOutro ? "OUTRO — RISE COMPLETE" : "NATHANIEL SMALLEY"}</div>
            </div>
            <div style={{ marginTop: 16, fontFamily: "DM Mono, monospace", fontSize: 10, letterSpacing: "0.16em", color: "rgba(255,255,255,0.42)" }}>{Math.round(progress * 100)}% • 152 BPM • E MAJOR</div>
          </div>
        )}
      </AbsoluteFill>
      <div style={{ position: "absolute", bottom: 18, left: 0, right: 0, textAlign: "center", fontFamily: "DM Mono, monospace", fontSize: 10, letterSpacing: "0.14em", color: "rgba(255,255,255,0.42)", pointerEvents: "none" }}>BLENDER • THREE.JS • FFMPEG • REMOTION • GPU • 152 BPM • E MAJOR • CORONATION</div>
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,0.45) 0%, transparent 10%, transparent 90%, rgba(0,0,0,0.5) 100%), radial-gradient(ellipse at center, transparent 66%, rgba(0,0,0,0.55) 100%)`, pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 0, borderTop: isDrop ? "0px solid transparent" : "20px solid rgba(0,0,0,0.85)", opacity: 0.94 }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 0, borderBottom: isDrop ? "0px solid transparent" : "20px solid rgba(0,0,0,0.85)", opacity: 0.94 }} />
    </AbsoluteFill>
  );
};
export const TakeTheCrownDuration = DURATION_FRAMES;
export const TakeTheCrownFps = FPS;