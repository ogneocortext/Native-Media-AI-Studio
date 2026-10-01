/**
 * GenerativeReactiveVisualizer — Spectral-timeline-driven Remotion composition.
 *
 * Drives instanced particles, ping-pong feedback trails, and bloom from the
 * dense frame-accurate spectral timeline JSON produced by
 * `GET /api/audio/spectral-timeline/{filename}` and exposed through
 * `useAnalyzedAudioData`.
 *
 * Render:
 *   npx remotion render src/GenerativeReactiveVisualizer.tsx GenerativeReactiveVisualizer out/video.mp4
 */

import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  Audio,
  Sequence,
  spring,
  interpolate,
} from "remotion";
import { useMemo, useRef, useEffect } from "react";
import type { TimingContract } from "../lib/timing";
import { getSectionAtTime } from "../lib/timing";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SpectralTimeline {
  audio_file: string;
  duration_seconds: number;
  sample_rate: number;
  fps: number;
  hop_length: number;
  n_fft: number;
  frame_count: number;
  bands: { sub: [number, number]; mid: [number, number]; high: [number, number] };
  timeline: Array<{
    time: number;
    sub: number;
    mid: number;
    high: number;
    transient: number;
    centroid: number;
    rms: number;
  }>;
}

interface GenerativeReactiveVisualizerProps {
  /** Remote or local audio source URL */
  audioSrc: string;
  /** Pre-fetched spectral timeline JSON (from /api/audio/spectral-timeline/:filename) */
  spectralTimeline?: SpectralTimeline | null;
  /** Optional timing contract for section-aware color mapping */
  analysis?: { timing_contract?: TimingContract } | null;
  colorScheme?: "neon" | "fire" | "ocean" | "monochrome";
  particleCount?: number;
  bloomStrength?: number;
  trailDecay?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const COLOR_SCHEMES: Record<string, { primary: string; secondary: string; glow: string; bg: string }> = {
  neon: { primary: "#00ffff", secondary: "#ff00ff", glow: "#ffff00", bg: "#0a0a12" },
  fire: { primary: "#ff4500", secondary: "#ff6600", glow: "#ffcc00", bg: "#120500" },
  ocean: { primary: "#0066ff", secondary: "#00ccff", glow: "#00ffcc", bg: "#000a14" },
  monochrome: { primary: "#ffffff", secondary: "#aaaaaa", glow: "#ffffff", bg: "#050505" },
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace("#", "").match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: Number.parseInt(m[1], 16), g: Number.parseInt(m[2], 16), b: Number.parseInt(m[3], 16) };
}

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

// ─── Canvas background ──────────────────────────────────────────────────────

function PingPongTrails({
  timelineFrame,
  width,
  height,
  color,
  decay = 0.88,
}: {
  timelineFrame: { sub: number; mid: number; high: number; transient: number; rms: number };
  width: number;
  height: number;
  color: { primary: string; secondary: string; glow: string };
  decay?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useCurrentFrame();

  // Two ping-pong canvases: one writes, one reads, then swap.
  // We approximate that with a single canvas and fade-to-black per frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Trail decay: semi-transparent black overlay
    ctx.fillStyle = `rgba(0,0,0,${1 - decay})`;
    ctx.fillRect(0, 0, w, h);

    const energy = clamp(timelineFrame.rms);
    const transient = clamp(timelineFrame.transient);
    const mid = clamp(timelineFrame.mid);
    const high = clamp(timelineFrame.high);

    const primaryRgb = hexToRgb(color.primary);
    const secondaryRgb = hexToRgb(color.secondary);

    // Instanced feedback emitters: 3 sources whose positions oscillate
    const count = 3;
    const time = frameRef / 30;
    for (let i = 0; i < count; i++) {
      const phase = (i / count) * Math.PI * 2 + time;
      const cx = w * 0.5 + Math.cos(phase) * w * 0.25 * (0.5 + mid * 0.5);
      const cy = h * 0.5 + Math.sin(phase * 1.3) * h * 0.25 * (0.5 + high * 0.5);

      const radius = 10 + transient * 60;
      const rgb = i === 1 ? secondaryRgb : primaryRgb;

      // Main bloom blob
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.25 + energy * 0.6})`);
      grad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // Ping-pong mirror: a ghost trail opposite center
      const mx = w - cx;
      const my = h - cy;
      const ghostGrad = ctx.createRadialGradient(mx, my, 0, mx, my, radius * 0.7);
      ghostGrad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.08 + energy * 0.2})`);
      ghostGrad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
      ctx.fillStyle = ghostGrad;
      ctx.beginPath();
      ctx.arc(mx, my, radius * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [frameRef, timelineFrame, width, height, color, decay]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        filter: `blur(1px)`,
        mixBlendMode: "screen",
        opacity: 0.9,
      }}
    />
  );
}

// ─── Instanced particles ────────────────────────────────────────────────────

function ParticleField({
  timelineFrame,
  width,
  height,
  color,
  particleCount = 120,
}: {
  timelineFrame: SpectralTimeline["timeline"][number];
  width: number;
  height: number;
  color: { primary: string; glow: string };
  particleCount?: number;
}) {
  // Deterministic pseudo-random from frame index + particle index
  const particles = useMemo(() => {
    const out: Array<{
      seed: number;
      baseX: number;
      baseY: number;
      size: number;
      phase: number;
    }> = [];
    for (let i = 0; i < particleCount; i++) {
      out.push({
        seed: i * 997 + 13,
        baseX: ((i * 173) % 1000) / 1000,
        baseY: ((i * 287) % 1000) / 1000,
        size: 1.5 + (i % 5),
        phase: (i % 7) / 7,
      });
    }
    return out;
  }, [particleCount]);

  const energy = clamp(timelineFrame.rms);
  const high = clamp(timelineFrame.high);
  const sub = clamp(timelineFrame.sub);

  const rgb = hexToRgb(color.glow);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {particles.map((p) => {
        const drift = Math.sin(p.phase * Math.PI * 2 + energy * 6) * 0.08;
        const x = (p.baseX + drift) * width;
        const y = (p.baseY + Math.cos(p.phase * 5 + sub * 4) * 0.1) * height;
        const scale = 0.6 + energy * 1.4;
        const alpha = 0.15 + high * 0.7;
        const sz = p.size * scale;

        return (
          <div
            key={p.seed}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: sz,
              height: sz,
              borderRadius: "50%",
              backgroundColor: `rgb(${rgb.r},${rgb.g},${rgb.b})`,
              opacity: alpha,
              boxShadow: `0 0 ${6 * energy * 20}px ${color.glow}`,
              transform: `translate(-50%, -50%)`,
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Composition ────────────────────────────────────────────────────────────

export function GenerativeReactiveVisualizer({
  audioSrc,
  spectralTimeline = null,
  analysis = null,
  colorScheme = "neon",
  particleCount = 120,
  bloomStrength = 1.2,
  trailDecay = 0.88,
}: GenerativeReactiveVisualizerProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const colors = COLOR_SCHEMES[colorScheme] || COLOR_SCHEMES.neon;

  // Map current frame -> spectral timeline entry
  const t = frame / fps;

  const timelineEntry = useMemo(() => {
    if (!spectralTimeline?.timeline?.length) {
      return { time: t, sub: 0, mid: 0, high: 0, transient: 0, centroid: 0, rms: 0 };
    }
    const idxFloat = t * spectralTimeline.fps;
    const idx = Math.max(0, Math.min(spectralTimeline.timeline.length - 1, Math.round(idxFloat)));
    return spectralTimeline.timeline[idx];
  }, [spectralTimeline, t]);

  const section = getSectionAtTime(analysis?.timing_contract?.sections || [], t);
  const effectiveColors =
    section?.palette && typeof section.palette === "object"
      ? {
          primary: (section.palette as Record<string, string>).primary ?? colors.primary,
          secondary: (section.palette as Record<string, string>).secondary ?? colors.secondary,
          glow: (section.palette as Record<string, string>).glow ?? colors.glow,
          bg: colors.bg,
        }
      : colors;

  const globalBloom = useMemo(() => {
    const base = 0.4 + timelineEntry.rms * 0.6;
    return clamp(base * bloomStrength);
  }, [timelineEntry.rms, bloomStrength]);

  const vignette = useMemo(() => {
    const s = spring({
      frame,
      fps,
      config: { damping: 120, stiffness: 40, mass: 0.6 },
    });
    return interpolate(s, [0, 1], [0.6, 1]);
  }, [frame, fps]);

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at center, ${effectiveColors.bg} 0%, #000000 100%)`,
        overflow: "hidden",
      }}
    >
      <Audio src={audioSrc} />

      {/* Intro fade */}
      <Sequence from={0} durationInFrames={Math.floor(fps * 0.8)}>
        <AbsoluteFill
          style={{
            background: `linear-gradient(to top, ${effectiveColors.primary}22, transparent)`,
            opacity: interpolate(frame, [0, Math.floor(fps * 0.8)], [1, 0]),
          }}
        />
      </Sequence>

      {/* Reactive canvas layer */}
      <PingPongTrails
        timelineFrame={timelineEntry}
        width={width}
        height={height}
        color={effectiveColors}
        decay={trailDecay}
      />

      {/* Instanced particles */}
      <ParticleField
        timelineFrame={timelineEntry}
        width={width}
        height={height}
        color={effectiveColors}
        particleCount={particleCount}
      />

      {/* Section-aware center bloom */}
      {section && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: `${60 + timelineEntry.rms * 180}px`,
            height: `${60 + timelineEntry.rms * 180}px`,
            transform: "translate(-50%, -50%)",
            borderRadius: "50%",
            background: `radial-gradient(circle, ${effectiveColors.glow}66, transparent 70%)`,
            opacity: clamp(globalBloom),
            mixBlendMode: "screen",
          }}
        />
      )}

      {/* Vignette overlay */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,${0.7 * vignette}) 100%)`,
          pointerEvents: "none",
        }}
      />

      {/* Minimal status overlay — always visible but unobtrusive */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          left: 24,
          color: effectiveColors.primary,
          fontFamily: "monospace",
          fontSize: 12,
          opacity: 0.6,
          textShadow: `0 0 6px ${effectiveColors.primary}`,
          lineHeight: 1.4,
        }}
      >
        {section ? (
          <>
            <div>{section.type.toUpperCase()} · {timelineEntry.rms.toFixed(3)}</div>
            <div>{fps}f · {frame}f · {t.toFixed(2)}s</div>
          </>
        ) : (
          <div>WAITING FOR ANALYSIS…</div>
        )}
      </div>
    </AbsoluteFill>
  );
}

export default GenerativeReactiveVisualizer;
