import { useEffect, useRef } from "react";
import type { AudioData } from "./types";
import type { LyricLine } from "./components/LyricOverlay";

interface Props {
  audioData: React.MutableRefObject<AudioData>;
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  isPlaying: boolean;
  mode?: "bars" | "waveform" | "radial" | "spectrogram" | "lissajous" | "constellation" | "particles";
  lrcSync?: {
    currentSection: string;
    sectionProgress: number;
    isPhraseStart: boolean;
    lineProgress: number;
  } | null;
  /**
   * Per-frame live sync written by the parent's elapsed loop (see audioTiming.ts).
   * Preferred over `lrcSync` in the draw loop. Also keeps this effect from
   * re-subscribing every time the React-state snapshot identity changes.
   * Falls back to `lrcSync` when null (e.g. demo mode).
   */
  lrcSyncLive?: { current: Props["lrcSync"] };
  lyrics?: LyricLine[];
  bgColor?: string;
}

/**
 * 2026 Canvas2D Visualizer — 7 modes inspired by visual-flux (Apache-2.0) + Waviz (MIT).
 * - bars: frequency bars with LRC phrase flash + section palette lerp (Trollspace/Synthwave)
 * - waveform: time-domain oscilloscope with LRC lineProgress scrub
 * - radial: circular spectrum with sectionProgress rotation
 * - spectrogram: scrolling time-frequency heatmap
 * - lissajous: X/Y frequency scatter driven by bass/mid
 * - constellation: peak-frequency scatter with beat burst
 * - particles: simple 2D particle field driven by energy/beat
 * No extra deps — Canvas2D + Web Audio API only (2026 lightweight 2D stack).
 */
export function Canvas2DVisualizer({ audioData, analyserRef, isPlaying, mode = "bars", lrcSync, lrcSyncLive, bgColor = "#050505" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Stable holder for the live ref so the draw effect below never re-subscribes
  // on snapshot identity changes (~20 fps) — only on mode/config changes.
  const lrcSyncLiveHolder = useRef(lrcSyncLive);
  lrcSyncLiveHolder.current = lrcSyncLive;
  const lrcSyncPropHolder = useRef(lrcSync);
  lrcSyncPropHolder.current = lrcSync;

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

    // Simple 2D particle system for particles mode
    const particles: { x: number; y: number; vx: number; vy: number; life: number; hue: number }[] = [];
    const MAX_PARTICLES = 300;
    function spawnParticle(w: number, h: number, energy: number, beat: boolean) {
      if (particles.length >= MAX_PARTICLES) return;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 2 + energy * 3 + (beat ? 3 : 0);
      particles.push({
        x: w / 2 + (Math.random() - 0.5) * w * 0.5,
        y: h / 2 + (Math.random() - 0.5) * h * 0.5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        hue: Math.random() * 360,
      });
    }

    const draw = () => {
      const analyser = analyserRef.current;
      const d = audioData.current;
      // Live per-frame sync preferred; React-state snapshot as fallback.
      const sync = lrcSyncLiveHolder.current?.current ?? lrcSyncPropHolder.current;
      const section = sync?.currentSection || "VERSE";
      const colors = palettes[section] || palettes.VERSE;
      if (sync?.isPhraseStart) phraseFlash = 1;
      phraseFlash = Math.max(0, phraseFlash - 0.07);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, w, h);

      if (phraseFlash > 0.05) {
        ctx.fillStyle = `rgba(255,255,255,${phraseFlash * 0.08})`;
        ctx.fillRect(0, 0, w, h);
      }

      if (!analyser || !isPlaying) {
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
          const boosted = v + phraseFlash * 0.35 + (sync?.lineProgress ?? 0) * 0.1;
          const bh = boosted * h * 0.85;
          const x = i * barW;
          const y = h - bh;
          const grad = ctx.createLinearGradient(x, y, x, h);
          const cIdx = Math.floor((i / barCount) * colors.length);
          grad.addColorStop(0, colors[cIdx % colors.length]);
          grad.addColorStop(1, colors[0] + "60");
          ctx.fillStyle = grad;
          ctx.fillRect(x + 1, y, barW - 2, bh);
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
          const xOff = (sync?.lineProgress ?? 0) * 12 * dpr * Math.sin(i * 0.01);
          if (i === 0) ctx.moveTo(x + xOff, y);
          else ctx.lineTo(x + xOff, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (mode === "radial") {
        const cx = w / 2, cy = h / 2;
        const baseR = Math.min(w, h) * 0.18;
        const sectionRot = (sync?.sectionProgress ?? 0) * Math.PI * 0.5;
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
        ctx.fillStyle = colors[0];
        ctx.beginPath();
        ctx.arc(cx, cy, baseR * 0.35 * (1 + phraseFlash * 0.5 + d.bass * 0.3), 0, Math.PI * 2);
        ctx.fill();
      } else if (mode === "spectrogram") {
        const specW = w;
        const specH = h;
        const sliceW = 2 * dpr;
        const binCount = Math.floor(freq.length * 0.6);
        const colData = ctx.getImageData(0, 0, specW, specH);
        const pixels = colData.data;
        for (let x = 0; x < specW - sliceW; x++) {
          for (let y = 0; y < specH; y++) {
            const idx = (y * specW + x) * 4;
            const nextIdx = (y * specW + (x + sliceW)) * 4;
            pixels[idx] = pixels[nextIdx];
            pixels[idx + 1] = pixels[nextIdx + 1];
            pixels[idx + 2] = pixels[nextIdx + 2];
            pixels[idx + 3] = 255;
          }
        }
        const binH = specH / binCount;
        for (let i = 0; i < binCount; i++) {
          const v = freq[i] / 255;
          const x = specW - sliceW;
          const y = specH - (i + 1) * binH;
          const hue = (1 - v) * 240;
          const rgb = hslToRgb(hue / 360, 1, 0.5);
          for (let py = Math.max(0, y); py < Math.min(specH, y + binH); py++) {
            const idx = (py * specW + x) * 4;
            pixels[idx] = rgb[0];
            pixels[idx + 1] = rgb[1];
            pixels[idx + 2] = rgb[2];
            pixels[idx + 3] = 255;
          }
        }
        ctx.putImageData(colData, 0, 0);
        if (phraseFlash > 0.05) {
          ctx.fillStyle = `rgba(255,255,255,${phraseFlash * 0.1})`;
          ctx.fillRect(0, 0, w, h);
        }
      } else if (mode === "lissajous") {
        const cx = w / 2, cy = h / 2;
        const bassIdx = Math.floor(freq.length * 0.1);
        const midIdx = Math.floor(freq.length * 0.4);
        const bassV = freq.slice(0, bassIdx).reduce((a, b) => a + b, 0) / (bassIdx * 255 || 1);
        const midV = freq.slice(bassIdx, midIdx).reduce((a, b) => a + b, 0) / ((midIdx - bassIdx) * 255 || 1);
        const ampX = w * 0.35 * (1 + bassV * 0.6);
        const ampY = h * 0.35 * (1 + midV * 0.6);
        const t = performance.now() * 0.001;
        ctx.strokeStyle = colors[1];
        ctx.lineWidth = 2 * dpr;
        ctx.shadowColor = colors[0];
        ctx.shadowBlur = 6 * dpr + phraseFlash * 10;
        ctx.beginPath();
        const steps = 256;
        for (let i = 0; i < steps; i++) {
          const frac = i / steps;
          const angle = frac * Math.PI * 2 + t * (1 + d.bass);
          const x = cx + Math.sin(angle * (1 + bassV * 3)) * ampX;
          const y = cy + Math.cos(angle * (1 + midV * 2)) * ampY;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        // Draw current-point glow
        const curAngle = t * (1 + d.bass) * (1 + bassV * 3) + performance.now() * 0.001;
        const curX = cx + Math.sin(curAngle) * ampX;
        const curY = cy + Math.cos(curAngle * (1 + midV * 2)) * ampY;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(curX, curY, 4 * dpr + phraseFlash * 6 * dpr, 0, Math.PI * 2);
        ctx.fill();
      } else if (mode === "constellation") {
        const points: { x: number; y: number; v: number }[] = [];
        const step = 8;
        for (let i = 0; i < freq.length; i += step) {
          const v = freq[i] / 255;
          if (v > 0.15) {
            const x = (i / freq.length) * w;
            const y = h - v * h * 0.85;
            points.push({ x, y, v });
          }
        }
        // Draw connections
        ctx.strokeStyle = colors[0] + "30";
        ctx.lineWidth = dpr;
        for (let i = 0; i < points.length; i++) {
          for (let j = i + 1; j < points.length; j++) {
            const dist = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
            if (dist < 60 * dpr) {
              ctx.globalAlpha = (1 - dist / (60 * dpr)) * 0.4;
              ctx.beginPath();
              ctx.moveTo(points[i].x, points[i].y);
              ctx.lineTo(points[j].x, points[j].y);
              ctx.stroke();
            }
          }
        }
        ctx.globalAlpha = 1;
        // Draw nodes
        for (const p of points) {
          const r = 2 * dpr + p.v * 5 * dpr + (d.beat && p.v > 0.7 ? 3 * dpr : 0);
          ctx.fillStyle = colors[Math.floor(p.v * colors.length) % colors.length];
          ctx.shadowColor = colors[0];
          ctx.shadowBlur = 4 * dpr + p.v * 8 * dpr;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      } else if (mode === "particles") {
        const energy = d.energy;
        const beat = d.beat;
        const spawnCount = Math.floor(energy * 8 + (beat ? 12 : 0));
        for (let i = 0; i < spawnCount; i++) spawnParticle(w, h, energy, beat);
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 0.012 + energy * 0.01;
          if (p.life <= 0 || p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
            particles.splice(i, 1);
            continue;
          }
          const alpha = p.life * 0.8;
          const rgb = hslToRgb(p.hue / 360, 1, 0.5 + energy * 0.3);
          ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
          ctx.shadowColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha * 0.8})`;
          ctx.shadowBlur = 6 * dpr + d.bass * 8 * dpr;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2 * dpr + d.bass * 3 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
        // Center glow
        const grd = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) * 0.3);
        grd.addColorStop(0, colors[0] + Math.floor(phraseFlash * 40 + d.bass * 60).toString(16).padStart(2, "0"));
        grd.addColorStop(1, "transparent");
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, w, h);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, mode, bgColor, analyserRef, audioData]);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ background: bgColor }} />;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
