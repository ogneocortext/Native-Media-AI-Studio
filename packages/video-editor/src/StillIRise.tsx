/* eslint-disable @remotion/no-background-image, @remotion/non-pure-animation */
import { AbsoluteFill, Audio, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { useWindowedAudioData, visualizeAudio, visualizeAudioWaveform, createSmoothSvgPath } from "@remotion/media-utils";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";
import React from "react";

const FPS = 30;
const DURATION_SECONDS = 234.12;
const DURATION_FRAMES = Math.ceil(DURATION_SECONDS * FPS);

type LyricLine = { start: number; end: number; text: string; section: string };
const lyricBlocks: { start: number; end: number; lines: string[]; section: string }[] = [
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
const PALETTE = { chorus: "hsl(258 92% 66%)", verse: "hsl(198 88% 62%)", bridge: "hsl(28 92% 60%)", intro: "hsl(220 70% 64%)" };
const getSectionColor = (section: string, bassMix: number) => {
  if (section.includes("CHORUS")) return PALETTE.chorus;
  if (section.includes("BRIDGE")) return PALETTE.bridge;
  if (section.includes("INTRO")) return PALETTE.intro;
  return bassMix > 0.3 ? "hsl(205 85% 64%)" : PALETTE.verse;
};
const EASE_ENTER = Easing.bezier(0, 0, 0.2, 1);
export const StillIRiseComposition: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const { audioData, dataOffsetInSeconds } = useWindowedAudioData({ src: staticFile("still-i-rise.mp3"), frame, fps, windowInSeconds: 30 });
  const spectrum = audioData ? visualizeAudio({ fps, frame, audioData, numberOfSamples: 64, optimizeFor: "speed", dataOffsetInSeconds }) : new Array(64).fill(0);
  const waveform = audioData ? visualizeAudioWaveform({ fps, frame, audioData, numberOfSamples: 280, windowInSeconds: 0.6, dataOffsetInSeconds }) : new Array(280).fill(0);
  const low = spectrum.slice(0, 10);
  const bass = low.reduce((a, b) => a + b, 0) / low.length || 0;
  const mid = spectrum.slice(10, 28).reduce((a, b) => a + b, 0) / 18 || 0;
  const high = spectrum.slice(28, 52).reduce((a, b) => a + b, 0) / 24 || 0;
  const bassPulse = interpolate(bass, [0, 0.6], [1, 1.35], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const beatSpring = spring({ frame: bass > 0.34 ? frame % 18 : 0, fps, config: { damping: 18, stiffness: 180, mass: 0.6 } });
  const crystalSpring = spring({ frame: frame % 45, fps, config: { damping: 22, stiffness: 90 } });
  const physicsJitter = (beatSpring - 0.5) * 0.06 + bass * 0.08;
  const t = frame / fps;
  const progress = frame / DURATION_FRAMES;
  const currentLyric = lyrics.find((l) => t >= l.start && t < l.end) ?? lyrics[0];
  const lyricProgress = currentLyric ? (t - currentLyric.start) / (currentLyric.end - currentLyric.start) : 0;
  const beatFlash = bass > 0.36 ? 1 : 0;
  const glowColor = getSectionColor(currentLyric.section, bass + mid);
  const isChorus = currentLyric.section.includes("CHORUS");
  const isVerse = currentLyric.section.includes("VERSE");
  const isBridge = currentLyric.section.includes("BRIDGE");
  const isIntro = currentLyric.section.includes("INTRO");
  let wipeProgress = 0; let activeTransition = -1;
  for (let i = 0; i < transitionTimes.length; i++) { const s = transitionTimes[i]; const e = s + 0.9; if (t >= s && t < e) { wipeProgress = (t - s) / 0.9; activeTransition = i; break; } }
  const wipeX = interpolate(wipeProgress, [0, 1], [-900, 2700], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_ENTER });
  const words = currentLyric.text.split(" ");
  const camX = isChorus ? Math.sin(t * 0.22) * 10 + bass * 14 : isVerse ? Math.sin(t * 0.14) * 8 : Math.sin(t * 0.08) * 4;
  const camY = isBridge ? Math.cos(t * 0.18) * 6 : Math.cos(t * 0.12) * 5;
  const camScale = isChorus ? 1.02 + bass * 0.03 : isIntro ? 0.99 + progress * 0.02 : 1.01 + bass * 0.015;
  const wavePath = createSmoothSvgPath({ points: waveform.map((y, i) => ({ x: (i / (waveform.length - 1)) * width, y: height * 0.58 + y * 92 * (0.55 + bass * 1.1) })) });
  return (
    <AbsoluteFill style={{ backgroundColor: "#070a13", fontFamily: "Space Grotesk, sans-serif", overflow: "hidden" }}>
      <Audio src={staticFile("still-i-rise.mp3")} />
      <AbsoluteFill style={{ transform: `scale(${camScale}) translate(${camX}px, ${camY}px)` }}>
        <Img src={staticFile("blender-scenery.png")} style={{ width: "100%", height: "100%", objectFit: "cover", filter: isBridge ? "brightness(0.72) contrast(1.08) saturate(0.78) blur(0.5px)" : isChorus ? `brightness(${0.92 + mid * 0.14}) saturate(1.08) contrast(1.06)` : `brightness(${0.86 + mid * 0.12}) contrast(1.04)`, opacity: isIntro ? 0.62 : 0.72 }} />
        <AbsoluteFill style={{ background: `linear-gradient(180deg, transparent 38%, hsla(240 30% 6% / 0.55) 88%), radial-gradient(900px 600px at 52% 38%, ${glowColor}14 0%, transparent 58%)` }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: isChorus ? 0.16 + bass * 0.12 : isBridge ? 0.06 : 0.09, mixBlendMode: "screen", pointerEvents: "none" }}>
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(600px 400px at 12% 18%, ${glowColor} 0%, transparent 55%), radial-gradient(500px 380px at 88% 82%, hsl(32 90% 62% / 0.9) 0%, transparent 58%)`, transform: `translate(${Math.sin(t * 0.07) * 10}px, ${Math.cos(t * 0.06) * 6}px)` }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: isBridge ? 0.075 : 0.045, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.92' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.35'/%3E%3C/svg%3E")`, transform: `translate(${Math.sin(t * 0.9) * 0.6}px, ${Math.cos(t * 0.7) * 0.4}px)` } as React.CSSProperties} />
      <AbsoluteFill style={{ opacity: 0.035, mixBlendMode: "overlay", pointerEvents: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 300 300' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='p'%3E%3CfeTurbulence baseFrequency='0.65' numOctaves='4'/%3E%3CfeColorMatrix values='1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0.55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23p)'/%3E%3C/svg%3E")`, transform: `scale(1.2)` } as React.CSSProperties} />
      <AbsoluteFill style={{ opacity: isVerse ? 0.025 : 0.015, mixBlendMode: "soft-light", pointerEvents: "none", background: `repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 14px), repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 14px)` }} />
      <AbsoluteFill style={{ background: glowColor, opacity: interpolate(beatFlash, [0, 1], [0, isChorus ? 0.05 : 0.03]), mixBlendMode: "soft-light", pointerEvents: "none" }} />
      <AbsoluteFill style={{ pointerEvents: "none", opacity: isChorus ? 0.42 : 0.28 }}>
        {Array.from({ length: 18 }).map((_, i) => {
          const px = (i * 137.5 + frame * (0.12 + (i % 3) * 0.04)) % width;
          const py = 140 + Math.sin(t * 0.22 + i) * 40 + (i % 4) * 88 + high * 22;
          const sz = 1.2 + (i % 5) * 0.7 + bass * 2.2;
          return <div key={i} style={{ position: "absolute", left: px, top: py, width: sz, height: sz, borderRadius: 999, background: glowColor, opacity: 0.18 + (i % 3) * 0.08 + bass * 0.12, boxShadow: `0 0 8px ${glowColor}`, transform: `translateY(${Math.sin(t * 0.6 + i) * 6}px)` }} />;
        })}
      </AbsoluteFill>
      <AbsoluteFill style={{ pointerEvents: "none", opacity: 0.14, mixBlendMode: "soft-light", background: `linear-gradient(180deg, ${isChorus ? "rgba(120,80,255,0.08)" : isBridge ? "rgba(255,120,40,0.06)" : "rgba(60,140,255,0.05)"} 0%, transparent 55%), linear-gradient(90deg, rgba(255,255,255,0.04) 0%, transparent 42%, rgba(0,0,0,0.12) 100%)` }} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ position: "absolute", left: "50%", top: "71%", width: 420, height: 90, background: "radial-gradient(ellipse at center, rgba(0,0,0,0.62) 0%, transparent 68%)", transform: `translate(-50%, -50%) scale(${0.88 + bass * 0.14 + physicsJitter},1)`, filter: "blur(7px)", opacity: 0.92 }} />
        <Img src={staticFile("blender-character.png")} style={{ position: "absolute", left: isChorus ? "48%" : isVerse ? "52%" : "50%", top: isChorus ? "48%" : "50%", width: isChorus ? 620 : isIntro ? 500 : 560, height: isChorus ? 780 : isIntro ? 640 : 720, objectFit: "contain", transform: `translate(-50%, -50%) translate(${Math.sin(t * 0.45 + (isChorus ? 1 : 0)) * 10 + bass * 12 + physicsJitter * 28}px, ${Math.cos(t * 0.32) * 6 + crystalSpring * 2}px) scale(${0.97 + bass * 0.09 + physicsJitter * 0.04}) rotate(${physicsJitter * 1.2}deg)`, filter: `drop-shadow(0 22px 32px rgba(0,0,0,0.62)) drop-shadow(0 0 20px ${glowColor}60) brightness(${1 + high * 0.2}) contrast(1.04)`, opacity: 0.97 }} />
        <Img src={staticFile("blender-character.png")} aria-hidden style={{ position: "absolute", left: isChorus ? "48%" : isVerse ? "52%" : "50%", top: "86.5%", width: isChorus ? 620 : isIntro ? 500 : 560, height: 320, objectFit: "contain", objectPosition: "top", transform: `translate(-50%, -50%) scale(${0.97 + bass * 0.06}, -0.42) translateY(48px)`, opacity: 0.11, filter: "blur(2.2px) brightness(0.9)", WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 78%)", maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 78%)" }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: isVerse ? 0.82 : isBridge ? 0.55 : 0.28, filter: isChorus ? "blur(1.2px)" : "none" }}>
        <Img src={staticFile("blender-props.png")} style={{ position: "absolute", right: isChorus ? 88 : 72, bottom: isChorus ? 182 : 148, width: isChorus ? 360 : 420, height: isChorus ? 240 : 280, objectFit: "contain", transform: `scale(${1 + mid * 0.04}) rotate(${Math.sin(t * 0.14) * 0.9}deg)`, filter: "drop-shadow(0 10px 22px rgba(0,0,0,0.45))" }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: isChorus ? 0.94 : isIntro ? 0.52 : 0.76 }}>
        <ThreeCanvas width={width} height={height} style={{ backgroundColor: "transparent" }}>
          <ambientLight intensity={0.48} />
          <directionalLight position={[4, 7, 5]} intensity={1.15} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005} />
          <directionalLight position={[-4, 3, -2]} intensity={0.55} color={glowColor} />
          <pointLight position={[-4, -2, 3]} intensity={0.72} color={glowColor} />
          <group scale={bassPulse * 0.88 * (1 + physicsJitter * 0.08)} rotation={[t * 0.22 + crystalSpring * 0.04, t * 0.5 + bass * 0.4 + physicsJitter * 0.5, physicsJitter * 0.12]} position={[isChorus ? 0.62 : -1.08, isChorus ? 0.22 : 0.36, 0]}>
            <mesh castShadow receiveShadow><icosahedronGeometry args={[0.95, 0]} /><meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={0.32 + high * 0.55} metalness={0.88} roughness={0.14} envMapIntensity={1.15} /></mesh>
            <mesh castShadow><icosahedronGeometry args={[0.985, 1]} /><meshBasicMaterial color={glowColor} wireframe transparent opacity={0.13} /></mesh>
            <mesh scale={0.505} castShadow><octahedronGeometry args={[0.8, 0]} /><meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.88} metalness={0.12} roughness={0.08} transparent opacity={0.94} /></mesh>
          </group>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.88, 0]} receiveShadow><planeGeometry args={[14, 14]} /><meshStandardMaterial color="#0d1220" metalness={0.92} roughness={0.11} envMapIntensity={0.85} transparent opacity={0.92} /></mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.85, 0]}><ringGeometry args={[1.08 + bass * 0.6, 1.21 + bass * 0.6, 64]} /><meshBasicMaterial color={glowColor} transparent opacity={0.15 + bass * 0.19} side={THREE.DoubleSide} /></mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.845, 0]}><circleGeometry args={[0.92 + bass * 0.22, 64]} /><meshBasicMaterial color="white" transparent opacity={0.045 + bass * 0.06} side={THREE.DoubleSide} /></mesh>
        </ThreeCanvas>
      </AbsoluteFill>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: isChorus ? 0.85 : 0.62 }}>
        <path d={wavePath} fill="none" stroke={glowColor} strokeWidth={isChorus ? 1.7 : 1.2} opacity={0.88} style={{ filter: `drop-shadow(0 0 8px ${glowColor})` }} />
      </svg>
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-end", padding: 28, pointerEvents: "none" }}>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-end" }}>
          <div style={{ width: 280, height: 140, borderRadius: 22, background: "rgba(18,22,34,0.72)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,0.09)", padding: 18, boxShadow: "0 10px 32px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div style={{ fontFamily: "DM Mono, monospace", fontSize: 10, letterSpacing: "0.18em", color: "rgba(255,255,255,0.56)" }}>99.4 BPM • Bb MAJOR • 8.4 LU</div>
            <div style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 13, fontWeight: 600, color: "white", lineHeight: 1.2 }}>{currentLyric.section}<br /><span style={{ color: glowColor, fontWeight: 400, fontSize: 11 }}>{currentLyric.text.slice(0, 28)}…</span></div>
            <div style={{ width: "100%", height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 99, overflow: "hidden" }}><div style={{ width: `${progress * 100}%`, height: "100%", background: glowColor, boxShadow: `0 0 8px ${glowColor}` }} /></div>
          </div>
          <div style={{ width: 420, height: 140, borderRadius: 22, background: "rgba(18,22,34,0.62)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px 12px", boxShadow: "0 10px 32px rgba(0,0,0,0.38)", display: "flex", alignItems: "flex-end", gap: 3 }}>
            {spectrum.filter((_, i) => i % 2 === 0).slice(0, 32).map((v, i) => {
              const db = v > 0 ? 20 * Math.log10(v) : -100;
              const scaled = Math.max(0, (db + 60) / 60);
              const h = 8 + scaled * 86 + (i < 8 ? bass * 16 : 0);
              const isB = i < 6;
              return <div key={i} style={{ flex: 1, height: h, backgroundColor: isB ? glowColor : i < 14 ? "rgba(255,255,255,0.92)" : `hsla(${isChorus ? 258 : 198} 70% 76% / 0.85)`, opacity: isB ? 0.95 : 0.72, borderRadius: 6, boxShadow: isB ? `0 0 10px ${glowColor}90` : "none", transformOrigin: "bottom" }} />;
            })}
          </div>
        </div>
      </AbsoluteFill>
      {activeTransition !== -1 && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          <div style={{ position: "absolute", inset: 0, background: `linear-gradient(100deg, transparent 42%, ${glowColor} 49%, white 50%, ${glowColor} 51.5%, transparent 62%)`, opacity: interpolate(wipeProgress, [0, 0.5, 1], [0, 0.22, 0]), transform: `translateX(${wipeX - 1200}px)` }} />
          <Img src={staticFile("blender-transition.png")} style={{ position: "absolute", left: wipeX, top: "50%", width: 1200, height: 180, objectFit: "contain", transform: "translateY(-50%) rotate(14deg) scale(1.1)", opacity: interpolate(wipeProgress, [0, 0.12, 0.88, 1], [0, 1, 1, 0]), filter: `drop-shadow(0 0 24px ${glowColor}) brightness(1.25)` }} />
        </AbsoluteFill>
      )}
      <div style={{ position: "absolute", top: 32, left: 32, right: 32, display: "flex", justifyContent: "space-between", fontFamily: "DM Mono, monospace", fontSize: 11, letterSpacing: "0.16em", color: "rgba(154,182,200,0.82)", opacity: 0.92 }}>
        <span style={{ background: "rgba(12,16,26,0.62)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.07)", padding: "7px 12px", borderRadius: 99 }}>NATHANIEL SMALLEY — STILL I RISE</span>
        <span style={{ background: "rgba(12,16,26,0.62)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.07)", padding: "7px 12px", borderRadius: 99 }}>{String(Math.floor(t / 60)).padStart(2, "0")}:{(Math.floor(t % 60) + "").padStart(2, "0")} / 03:54 • {currentLyric.section}</span>
      </div>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
        {isChorus ? (
          <div style={{ textAlign: "center", transform: `scale(${0.99 + bass * 0.045})` }}>
            <div style={{ display: "flex", gap: 18, justifyContent: "center", fontSize: 88, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, fontFamily: "Space Grotesk, sans-serif", color: "white", textShadow: `0 0 32px ${glowColor}66` }}>
              {"STILL".split("").map((ch, i) => (<span key={i} style={{ display: "inline-block", transform: `translateY(${Math.sin(t * 3.2 + i * 0.55) * (2 + bass * 6)}px)`, opacity: 0.96 }}>{ch}</span>))}
              <span style={{ width: 18 }} />
              {"I".split("").map((ch, i) => (<span key={i} style={{ display: "inline-block", color: glowColor, WebkitTextStroke: `1.2px ${glowColor}`, transform: `translateY(${Math.sin(t * 3.2 + i * 0.55 + 2) * (2 + bass * 6)}px)` }}>{ch}</span>))}
            </div>
            <div style={{ marginTop: 6, display: "flex", gap: 10, justifyContent: "center", fontSize: 72, fontWeight: 800, letterSpacing: "-0.03em", color: glowColor, WebkitTextStroke: `1.2px ${glowColor}`, lineHeight: 0.9 }}>RISE</div>
            <div style={{ marginTop: 18, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", maxWidth: 760 }}>
              {words.map((w, i) => { const wStart = i / words.length; const wEnd = (i + 1) / words.length; const active = lyricProgress >= wStart && lyricProgress < wEnd; const appeared = lyricProgress >= wEnd; return (<span key={i} style={{ fontFamily: "DM Mono, monospace", fontSize: 13, letterSpacing: "0.18em", color: appeared ? "rgba(255,255,255,0.92)" : active ? glowColor : "rgba(255,255,255,0.32)", transform: `translateY(${active ? -2 : 0}px)`, textShadow: active ? `0 0 10px ${glowColor}` : "none", transition: "all 0.18s ease" }}>{w}</span>); })}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", maxWidth: 820, padding: "0 24px" }}>
            <div style={{ display: "inline-block", background: isBridge ? "rgba(16,18,22,0.64)" : "rgba(18,22,34,0.58)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 24, padding: isBridge ? "28px 36px 22px" : "22px 32px 18px", boxShadow: "0 14px 36px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
              <div style={{ fontFamily: "DM Mono, monospace", fontSize: 11, letterSpacing: "0.22em", color: glowColor, opacity: 0.9, marginBottom: 10 }}>{currentLyric.section} — {isVerse ? "VERSE" : isBridge ? "BRIDGE" : "INTRO"}</div>
              <div style={{ display: "flex", gap: 9, justifyContent: "center", flexWrap: "wrap" }}>
                {words.map((w, i) => { const wStart = i / words.length; const wEnd = (i + 1) / words.length; const active = lyricProgress >= wStart && lyricProgress < wEnd; const appeared = lyricProgress >= wEnd; return (<span key={i} style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: isBridge ? 22 : 19, fontWeight: active ? 700 : 500, color: appeared ? "white" : active ? glowColor : "rgba(255,255,255,0.42)", transform: `translateY(${active ? -3 : 0}px) scale(${active ? 1.06 : 1})`, textShadow: active ? `0 0 12px ${glowColor}88` : "none", transition: "all 0.16s cubic-bezier(0.34,1.56,0.64,1)" }}>{w}</span>); })}
              </div>
              <div style={{ width: "100%", height: 2, background: "rgba(255,255,255,0.08)", borderRadius: 99, marginTop: 16, overflow: "hidden" }}><div style={{ width: `${lyricProgress * 100}%`, height: "100%", background: glowColor, boxShadow: `0 0 8px ${glowColor}`, transform: `scaleY(${1 + bass * 0.5})`, transformOrigin: "left" }} /></div>
            </div>
            <div style={{ marginTop: 14, fontFamily: "DM Mono, monospace", fontSize: 10, letterSpacing: "0.16em", color: "rgba(255,255,255,0.42)" }}>{Math.round(progress * 100)}% • {currentLyric.section}</div>
          </div>
        )}
      </AbsoluteFill>
      <div style={{ position: "absolute", bottom: 18, left: 0, right: 0, textAlign: "center", fontFamily: "DM Mono, monospace", fontSize: 10, letterSpacing: "0.14em", color: "rgba(255,255,255,0.42)", pointerEvents: "none" }}>BLENDER • THREE.JS • FFMPEG • REMOTION • GPU • 6C/12T • 99.4 BPM • Bb MAJOR • 2026 LIQUID GLASS • BENTO</div>
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,0.42) 0%, transparent 10%, transparent 90%, rgba(0,0,0,0.45) 100%), radial-gradient(ellipse at center, transparent 68%, rgba(0,0,0,0.52) 100%)`, pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 0, borderTop: isChorus ? "0px solid transparent" : "18px solid rgba(0,0,0,0.82)", opacity: 0.92 }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 0, borderBottom: isChorus ? "0px solid transparent" : "18px solid rgba(0,0,0,0.82)", opacity: 0.92 }} />
    </AbsoluteFill>
  );
};
export const StillIRiseDuration = DURATION_FRAMES;
export const StillIRiseFps = FPS;
