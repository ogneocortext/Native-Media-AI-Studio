import { useEffect, useRef } from "react";
import type { AudioData } from "./types";
import type { LyricLine } from "./components/LyricOverlay";
import { getSectionColor } from "./sectionHelpers";

interface Props {
  audioData: React.MutableRefObject<AudioData>;
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  isPlaying: boolean;
  mode?: "bars" | "waveform" | "radial";
  lrcSync?: {
    currentSection: string;
    sectionProgress: number;
    isPhraseStart: boolean;
    lineProgress: number;
  } | null;
  lyrics?: LyricLine[];
  bgColor?: string;
}

/**
 * 2026 Canvas2D Visualizer — 3 modes inspired by visual-flux (Apache-2.0) + Waviz (MIT).
 * - bars: frequency bars with LRC phrase flash + section palette lerp (Trollspace/Synthwave)
 * - waveform: time-domain oscilloscope with LRC lineProgress scrub
 * - radial: circular spectrum with sectionProgress rotation
 * No extra deps — Canvas2D + Web Audio API only (2026 lightweight 2D stack).
 */
export function Canvas2DVisualizer({ audioData, analyserRef, isPlaying, mode = "bars", lrcSync, bgColor = "#050505" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let raf = 0;
    let phraseFlash = 0;
    const freq = new Uint8Array(1024);
    const wave = new Uint8Array(1024);

    const palettes: Record<string, string[]> = {
      INTRO: ["#6366f1", "#818cf8", "#a5b4fc"],
      VERSE: ["#06b6d4", "#22d3ee", "#67e8f9"],
      CHORUS: ["#f59e0b", "#f97316", "#fb923c"],
      BRIDGE: ["#a855f7", "#c084fc", "#d8b4fe"],
      DROP: ["#ef4444", "#ff0040", "#ff6b6b"],
      "BUILD-UP": ["#eab308", "#facc15", "#fde047"],
      OUTRO: ["#6b7280", "#9ca3af", "#d1d5db"],
    };

    const draw = () => {
      const analyser = analyserRef.current;
      const d = audioData.current;
      const section = lrcSync?.currentSection || "VERSE";
      const colors = palettes[section] || palettes.VERSE;
      if (lrcSync?.isPhraseStart) phraseFlash = 1;
      phraseFlash = Math.max(0, phraseFlash - 0.07);

      // HiDPI
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, w, h);

      // LRC phrase flash overlay
      if (phraseFlash > 0.05) {
        ctx.fillStyle = `rgba(255,255,255,${phraseFlash * 0.08})`;
        ctx.fillRect(0, 0, w, h);
      }

      if (!analyser || !isPlaying) {
        // Idle shimmer
        ctx.fillStyle = colors[0] + "40";
        ctx.font = `${24 * dpr}px monospace`;
        ctx.textAlign = "center";
        ctx.fillText(`${section} — ${mode}`, w / 2, h / 2);
        raf = requestAnimationFrame(draw);
        return;
      }

      analyser.getByteFrequencyData(freq);
      analyser.getByteTimeDomainData(wave);

      if (mode === "bars") {
        const barCount = 64;
        const step = Math.floor(freq.length / barCount);
        const barW = w / barCount;
        for (let i = 0; i < barCount; i++) {
          const v = freq[i * step] / 255;
          const boosted = v + phraseFlash * 0.35 + (lrcSync?.lineProgress ?? 0) * 0.1;
          const bh = boosted * h * 0.85;
          const x = i * barW;
          const y = h - bh;
          const grad = ctx.createLinearGradient(x, y, x, h);
          const cIdx = Math.floor((i / barCount) * colors.length);
          grad.addColorStop(0, colors[cIdx % colors.length]);
          grad.addColorStop(1, colors[0] + "60");
          ctx.fillStyle = grad;
          ctx.fillRect(x + 1, y, barW - 2, bh);
          // Beat peak cap
          if (d.beat && v > 0.6) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(x + 1, y - 2 * dpr, barW - 2, 2 * dpr);
          }
        }
      } else if (mode === "waveform") {
        ctx.strokeStyle = colors[1];
        ctx.lineWidth = 2 * dpr;
        ctx.shadowColor = colors[0];
        ctx.shadowBlur = 8 * dpr + phraseFlash * 12;
        ctx.beginPath();
        const slice = w / wave.length;
        for (let i = 0; i < wave.length; i++) {
          const x = i * slice;
          const v = (wave[i] - 128) / 128;
          const y = h / 2 + v * h * 0.35 * (1 + d.energy * 0.5 + phraseFlash * 0.4);
          // LRC lineProgress scrubs horizontal offset
          const xOff = (lrcSync?.lineProgress ?? 0) * 12 * dpr * Math.sin(i * 0.01);
          if (i === 0) ctx.moveTo(x + xOff, y);
          else ctx.lineTo(x + xOff, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (mode === "radial") {
        const cx = w / 2, cy = h / 2;
        const baseR = Math.min(w, h) * 0.18;
        const sectionRot = (lrcSync?.sectionProgress ?? 0) * Math.PI * 0.5;
        for (let i = 0; i < 64; i++) {
          const v = freq[Math.floor((i / 64) * freq.length * 0.6)] / 255;
          const angle = (i / 64) * Math.PI * 2 + sectionRot;
          const r0 = baseR;
          const r1 = baseR + v * baseR * 1.2 * (1 + phraseFlash * 0.6);
          const x0 = cx + Math.cos(angle) * r0;
          const y0 = cy + Math.sin(angle) * r0;
          const x1 = cx + Math.cos(angle) * r1;
          const y1 = cy + Math.sin(angle) * r1;
          ctx.strokeStyle = colors[i % colors.length];
          ctx.lineWidth = 2 * dpr + v * 4 * dpr;
          ctx.globalAlpha = 0.7 + v * 0.3;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // Center pulse on phrase
        ctx.fillStyle = colors[0];
        ctx.beginPath();
        ctx.arc(cx, cy, baseR * 0.35 * (1 + phraseFlash * 0.5 + d.bass * 0.3), 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, mode, bgColor, analyserRef, audioData, lrcSync]);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ background: bgColor }} />;
}
