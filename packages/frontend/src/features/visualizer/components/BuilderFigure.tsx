import React, { useEffect, useRef } from "react";
import type { AudioData } from "../types";
import type { StoryBeat, StoryMotif } from "../storyboard";

/**
 * Builder — v3 redesign: canvas silhouette driven by continuous beat phase.
 *
 * Why the v2 SVG approach was janky (research-backed rethink):
 * - Boolean beats can't move a body. Beat-tracking literature models a beat as
 *   tempo + *phase* trajectories, and motion practice drives curves from beat
 *   markers — never on/off flashes. v2 read `beatPhase` but no producer ever
 *   set it, so the "continuous inter-beat" path was dead and every accent
 *   snapped on single 16 ms frames (plus a 1-frame `beat` is invisible to
 *   throttled consumers). v3 is driven by real `AudioData.beatPhase`
 *   (getBeatPhase, binary-searched from analyzed beat_times), shaped into a
 *   strike-decay pulse — wind-up before the beat, follow-through after.
 * - Per-frame `setAttribute("transform", …)` × 15 forces string parsing +
 *   SVG re-layout every frame, and CSS transforms on SVG inner elements are
 *   not reliably composited (Chromium). Web guidance is consistent: only
 *   `transform`/`opacity` animate cheaply, and canvas avoids DOM churn
 *   entirely. v3 draws the same ›240×320‹ staging on a small DPR-aware canvas
 *   (480×640 backing store): identical silhouette, zero attribute churn, free
 *   motion feel via the phase pulse. Static bench + lamp-glow sprite are
 *   pre-rendered offscreen once; per frame is two drawImages + ~20 strokes.
 * - The old `.viz-builder-figure` sizing lost a specificity war
 *   (`.viz-canvas-wrap canvas` overrode its `height: 52%`), stretching the
 *   figure fullscreen — fixed alongside in visualizer.css.
 * - v2 ignored `prefers-reduced-motion`. v3 takes `calm`: pose still eases
 *   between acts (slow, purposeful) but breath/sway/beat accents go to zero.
 *
 * Art direction is unchanged: same frozen proportions (LIMB/HIP_Y), same
 * motif acting choices (POSES), same per-joint springs, same near-black
 * silhouette + single-accent rim + lamp.
 */

interface Props {
  audioData: React.MutableRefObject<AudioData>;
  storyBeat: StoryBeat | null;
  visible: boolean;
  /** Reduced-motion mode: hold the act pose, no idle/beat animation. */
  calm?: boolean;
}

interface Pose {
  sit: number;
  rootX: number;
  torsoLean: number;
  headTilt: number;
  shL: number; elL: number;
  shR: number; elR: number;
  hipL: number; kneeL: number;
  hipR: number; kneeR: number;
  hammer: number;
  bob: number;
}

// Character bible — frozen proportions, 2026 "lock character first" rule
const LIMB = { torso: 62, head: 12, upper: 26, fore: 24, thigh: 30, shin: 30, foot: 10 };
const HIP_Y = 252;
const STAND_LIFT = 2;
const BODY = "#050508";
const DEFAULT_ACCENT = "#a5b4fc";

// Motif = acting choice, not style preset. Each is pushed 30-40% past naturalism for silhouette read at thumbnail (Ollama Fix #1, #2).
const POSES: Record<StoryMotif, Pose> = {
  // I. ESTABLISHING — hunched at bench, blue lamp is the only warm thing. Performance: tired, inspecting.
  establishing: { sit: 1, rootX: 0.22, torsoLean: 14, headTilt: 10, shL: 38, elL: -18, shR: 52, elR: -30, hipL: -82, kneeL: 88, hipR: -78, kneeR: 84, hammer: 0, bob: 2 },
  // I. SOLITUDE — Ollama Fix #2: slumped shoulders, head down, forward lean (not just walk). Isolation must read as fatigue.
  solitude: { sit: 1, rootX: 0.19, torsoLean: 26, headTilt: 22, shL: 22, elL: -8, shR: 34, elR: -18, hipL: -86, kneeL: 92, hipR: -82, kneeR: 88, hammer: 0, bob: 1.2 },
  // II. STRUGGLE — arms flung wide, head thrown back, knees splayed per "half-built, stubborn machine"
  struggle: { sit: 1, rootX: 0.24, torsoLean: 8, headTilt: -14, shL: 96, elL: -110, shR: 40, elR: -20, hipL: -80, kneeL: 86, hipR: -70, kneeR: 78, hammer: 0, bob: 3 },
  // II. ASSEMBLY — Ollama Fix #3: figure-8 hammer arc, not straight swing. Right arm winds -8° then strikes.
  assembly: { sit: 1, rootX: 0.24, torsoLean: 12, headTilt: 6, shL: 44, elL: -32, shR: 58, elR: -48, hipL: -82, kneeL: 88, hipR: -78, kneeR: 84, hammer: 42, bob: 3 },
  // III. BUILD — half-standing, weight shifting, hammer lighter. Midpoint of left-bench→center.
  build: { sit: 0.35, rootX: 0.34, torsoLean: 10, headTilt: 0, shL: 55, elL: -30, shR: 70, elR: -40, hipL: -40, kneeL: 44, hipR: -34, kneeR: 38, hammer: 18, bob: 5 },
  // III. PAYOFF — "it runs" — full stand, breath held, knees soft, arms ready
  payoff: { sit: 0, rootX: 0.42, torsoLean: -4, headTilt: -6, shL: 70, elL: -24, shR: 88, elR: -30, hipL: -8, kneeL: 10, hipR: -4, kneeR: 6, hammer: 0, bob: 7 },
  // III. TRIUMPH — Ollama Fix #1: STANDING center-frame, arms raised PAST naturalism (165°/172°) + torso back -10° + head -15° for victory read.
  triumph: { sit: 0, rootX: 0.52, torsoLean: -10, headTilt: -15, shL: 165, elL: -10, shR: 172, elR: -6, hipL: -4, kneeL: 6, hipR: -1, kneeR: 3, hammer: 0, bob: 8 },
  // Reflection — seated again but looser, looking down at the work. Not the same as solitude.
  reflection: { sit: 0.6, rootX: 0.3, torsoLean: 16, headTilt: 12, shL: 34, elL: -16, shR: 42, elR: -22, hipL: -60, kneeL: 66, hipR: -56, kneeR: 62, hammer: 0, bob: 2 },
  outro: { sit: 1, rootX: 0.22, torsoLean: 18, headTilt: 14, shL: 32, elL: -14, shR: 40, elR: -22, hipL: -82, kneeL: 88, hipR: -78, kneeR: 84, hammer: 0, bob: 1.5 },
};

const IDLE_POSE: Pose = { sit: 0, rootX: 0.42, torsoLean: 0, headTilt: 0, shL: 14, elL: -10, shR: 20, elR: -14, hipL: -4, kneeL: 6, hipR: 0, kneeR: 2, hammer: 0, bob: 3 };

// Tuned per joint group — slow mass (torso/root) vs fast extremities (head/hands)
function springK(key: keyof Pose): number {
  if (key === "rootX" || key === "sit") return 0.035;
  if (key === "torsoLean" || key === "hipL" || key === "hipR") return 0.05;
  if (key === "headTilt" || key === "shL" || key === "shR") return 0.09;
  if (key === "elL" || key === "elR" || key === "kneeL" || key === "kneeR") return 0.11;
  return 0.06;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const DEG = Math.PI / 180;

interface DrawAngles {
  rootX: number; rootY: number; sway: number;
  torsoLean: number; headTilt: number;
  shL: number; elL: number; shR: number; elR: number;
  hipL: number; kneeL: number; hipR: number; kneeR: number;
  showHammer: boolean;
}

function strokeSeg(ctx: CanvasRenderingContext2D, len: number, w: number) {
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, len);
  ctx.stroke();
}

/**
 * Draw the full figure in the current stroke/fill style (caller sets
 * color/alpha). `halo` widens every stroke (and grows circles) so the rim
 * pass peeks out evenly around the body pass instead of a one-sided sliver.
 */
function drawFigure(ctx: CanvasRenderingContext2D, a: DrawAngles, halo = 0) {
  ctx.lineCap = "round";
  const dot = (r: number) => {
    ctx.beginPath(); ctx.arc(0, 0, r + halo / 2, 0, Math.PI * 2); ctx.fill();
  };
  // Legs — far (left) first so the near leg overlaps.
  ctx.save(); ctx.rotate(a.hipL * DEG);
  ctx.globalAlpha *= 0.55;
  strokeSeg(ctx, LIMB.thigh, 11 + halo);
  ctx.translate(0, LIMB.thigh); ctx.rotate(a.kneeL * DEG);
  strokeSeg(ctx, LIMB.shin, 9 + halo);
  ctx.lineWidth = 7 + halo; ctx.beginPath(); ctx.moveTo(0, LIMB.shin); ctx.lineTo(LIMB.foot, LIMB.shin); ctx.stroke();
  ctx.restore();
  ctx.save(); ctx.rotate(a.hipR * DEG);
  strokeSeg(ctx, LIMB.thigh, 11 + halo);
  ctx.translate(0, LIMB.thigh); ctx.rotate(a.kneeR * DEG);
  strokeSeg(ctx, LIMB.shin, 9 + halo);
  ctx.lineWidth = 7 + halo; ctx.beginPath(); ctx.moveTo(0, LIMB.shin); ctx.lineTo(LIMB.foot, LIMB.shin); ctx.stroke();
  ctx.restore();
  // Torso + head + arms.
  ctx.save(); ctx.rotate(a.torsoLean * DEG);
  strokeSeg(ctx, -LIMB.torso, 16 + halo);
  ctx.save(); ctx.translate(4, -LIMB.torso - 14); ctx.rotate(a.headTilt * DEG);
  dot(LIMB.head);
  ctx.restore();
  // Left (far) arm.
  ctx.save(); ctx.translate(0, -54); ctx.rotate(a.shL * DEG);
  ctx.globalAlpha *= 0.55;
  strokeSeg(ctx, LIMB.upper, 8 + halo);
  ctx.translate(0, LIMB.upper); ctx.rotate(a.elL * DEG);
  strokeSeg(ctx, LIMB.fore, 7 + halo);
  ctx.save(); ctx.translate(0, LIMB.fore); dot(4); ctx.restore();
  ctx.restore();
  // Right (near) arm + hammer prop.
  ctx.save(); ctx.translate(0, -54); ctx.rotate(a.shR * DEG);
  strokeSeg(ctx, LIMB.upper, 8 + halo);
  ctx.translate(0, LIMB.upper); ctx.rotate(a.elR * DEG);
  strokeSeg(ctx, LIMB.fore, 7 + halo);
  ctx.save(); ctx.translate(0, LIMB.fore); dot(4); ctx.restore();
  if (a.showHammer) {
    ctx.fillRect(-2.5, 20, 5, 22);
    ctx.fillRect(-9, 36, 18, 8);
  }
  ctx.restore();
  ctx.restore();
}

export function BuilderFigure({ audioData, storyBeat, visible, calm = false }: Props) {
  const beatRef = useRef({ storyBeat });
  beatRef.current = { storyBeat };
  const calmRef = useRef(calm);
  calmRef.current = calm;

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Backing store: 240×320 staging at up to 2x for crisp edges. Rebuilt only
    // when the DPR bucket changes (zoom / monitor move), never per frame.
    let ss = 0;
    const fitBacking = () => {
      const next = Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 1)));
      if (next === ss) return;
      ss = next;
      canvas.width = 240 * ss;
      canvas.height = 320 * ss;
      buildStatic();
    };

    // Static layer: bench + stand + lamp housing. Pre-rendered once per
    // backing-store rebuild — per frame it's a single drawImage.
    const bench = document.createElement("canvas");
    const buildStatic = () => {
      bench.width = 240 * ss;
      bench.height = 320 * ss;
      const b = bench.getContext("2d");
      if (!b) return;
      b.scale(ss, ss);
      b.fillStyle = BODY;
      const rect = (x: number, y: number, w: number, h: number, r = 2) => {
        b.beginPath();
        b.roundRect(x, y, w, h, r);
        b.fill();
      };
      rect(52, 238, 150, 10);
      rect(60, 248, 8, 56, 0);
      rect(186, 248, 8, 56, 0);
      rect(18, 252, 30, 8);
      rect(28, 260, 8, 44, 0);
      rect(176, 180, 5, 58, 0);
      b.beginPath();
      b.moveTo(178, 180); b.lineTo(196, 180); b.lineTo(188, 196); b.lineTo(172, 196);
      b.closePath(); b.fill();
      rect(110, 226, 26, 12);
    };

    // Lamp-glow sprite: radial gradient, drawn per frame with live alpha.
    const glow = document.createElement("canvas");
    const buildGlow = () => {
      const s = 96 * ss;
      glow.width = s;
      glow.height = s;
      const g = glow.getContext("2d");
      if (!g) return;
      const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, "rgba(147,197,253,0.9)");
      grad.addColorStop(1, "rgba(147,197,253,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
    };
    fitBacking();
    buildGlow();

    let raf = 0;
    let lastT = performance.now();
    const cur: Pose = { ...IDLE_POSE };
    let benchOpacity = 1;
    let fallbackPhase = 1;

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      if (typeof document !== "undefined" && document.hidden) {
        raf = requestAnimationFrame(tick);
        return;
      }
      fitBacking();

      const d = audioData.current;
      const beat = beatRef.current.storyBeat;
      const isCalm = calmRef.current;
      const target = beat ? POSES[beat.motif] ?? IDLE_POSE : IDLE_POSE;

      // --- Base pose: story truth, frame-rate independent, per-joint tuned ---
      (Object.keys(target) as Array<keyof Pose>).forEach((k) => {
        const fk = 1 - Math.pow(1 - springK(k), dt * 60);
        cur[k] += (target[k] - cur[k]) * fk;
      });

      // --- Beat layer: continuous phase, not boolean onsets ---
      // Real phase from analyzed beat_times when available; otherwise a local
      // fallback integrator re-armed by onset frames (0.45 s default bar feel).
      let phase: number;
      if (typeof d.beatPhase === "number" && Number.isFinite(d.beatPhase)) {
        phase = Math.min(1, Math.max(0, d.beatPhase));
        fallbackPhase = phase;
      } else {
        if (d.beat) fallbackPhase = 0;
        else fallbackPhase = Math.min(1, fallbackPhase + dt / 0.45);
        phase = fallbackPhase;
      }
      // Strike-decay pulse: 1 exactly on the beat, ~0.14 mid-interval. Every
      // accent below follows this one curve, so nothing can snap on a frame.
      const pulse = isCalm ? 0 : Math.exp(-4 * phase);

      const t = now / 1000;
      const energy = isCalm ? 0 : d.energy;
      const breath = isCalm
        ? 0
        : Math.sin(t * Math.PI * 2 * 0.19) * 1.1 + Math.sin(t * Math.PI * 2 * 0.37 + 1.3) * 0.45;
      const sway = isCalm
        ? 0
        : Math.sin(t * Math.PI * 2 * 0.09) * (0.9 + energy * 1.8)
          + Math.sin(t * Math.PI * 2 * 0.14 + 0.8) * 0.28
          + Math.sin(t * 4.2) * 0.07;

      // Hammer: raised between beats, driven down through the beat
      // (raise 0.15 at impact → 1 mid-interval), plus the anticipatory
      // wind-up dip just before impact. Silent when the act has no hammer.
      const nextBeatIn = d.nextBeatIn ?? 1;
      const isWorking = cur.hammer > 5;
      const raise = 0.15 + 0.85 * smoothstep(0.05, 0.5, phase);
      const windup = isWorking && nextBeatIn < 0.12 ? -7 * ((0.12 - nextBeatIn) / 0.12) : 0;
      const hammerSwing = isWorking ? cur.hammer * (1 - raise) : 0;

      const stageW = 240;
      const rootX = cur.rootX * stageW;
      const bobVal = cur.bob * (0.35 + 0.65 * pulse)
        + (isCalm ? 0 : Math.abs(Math.sin(t * 2.2)) * energy * 1.2);
      const rootY = HIP_Y - (1 - cur.sit) * STAND_LIFT - bobVal;
      const nodSign = target === POSES.payoff || target === POSES.triumph ? -5 : 2;

      const angles: DrawAngles = {
        rootX, rootY, sway,
        torsoLean: cur.torsoLean + breath * (0.9 + energy * 0.4),
        headTilt: cur.headTilt + sway * 0.22 + pulse * nodSign,
        shL: cur.shL + sway * 0.5,
        elL: cur.elL + (isCalm ? 0 : Math.sin(t * 4.8) * 0.4 * energy),
        shR: cur.shR + windup - hammerSwing + sway * 0.5,
        elR: cur.elR - hammerSwing * 0.7 + (isCalm ? 0 : Math.sin(t * 4.8 + 0.6) * 0.35 * energy),
        hipL: cur.hipL,
        kneeL: cur.kneeL + (isCalm ? 0 : Math.sin(t * 3.0) * 0.4 * energy),
        hipR: cur.hipR,
        kneeR: cur.kneeR + (isCalm ? 0 : Math.sin(t * 3.0 + 0.9) * 0.4 * energy),
        showHammer: cur.hammer > 8,
      };

      const benchTarget = cur.sit > 0.45 ? 1 : 0;
      benchOpacity += (benchTarget - benchOpacity) * (1 - Math.pow(1 - 0.05, dt * 60));

      ctx.setTransform(ss, 0, 0, ss, 0, 0);
      ctx.clearRect(0, 0, 240, 320);

      // Static bench.
      ctx.globalAlpha = benchOpacity;
      ctx.drawImage(bench, 0, 0, 240, 320);
      ctx.globalAlpha = 1;

      // Lamp glow.
      const lampAlpha = isCalm ? 0.3 : Math.min(0.85, 0.22 + energy * 0.5 + pulse * 0.22);
      ctx.globalAlpha = lampAlpha;
      ctx.drawImage(glow, 184 - 46, 200 - 46, 92, 92);
      ctx.globalAlpha = 1;

      // Figure: three stacked passes, wide → narrow, all centered (no offset
      // ghost, which smeared at small sizes):
      //   1. act-accent halo (identity color),
      //   2. near-white edge (reads on ANY background, dark or bright),
      //   3. near-black body.
      // This dark-text/bright-outline sandwich is the same readability trick
      // as subtitled video: the silhouette stays legible over bright shaders
      // and over blackletterbox alike.
      const accent = beat?.palette.accent ?? DEFAULT_ACCENT;
      ctx.save();
      ctx.translate(rootX, rootY);
      ctx.rotate(sway * DEG);
      ctx.strokeStyle = accent;
      ctx.fillStyle = accent;
      ctx.globalAlpha = isCalm ? 0.5 : 0.5 + energy * 0.2;
      drawFigure(ctx, angles, 4);
      ctx.strokeStyle = "#f4f4f5";
      ctx.fillStyle = "#f4f4f5";
      ctx.globalAlpha = isCalm ? 0.5 : 0.45 + energy * 0.15;
      drawFigure(ctx, angles, 1.4);
      ctx.strokeStyle = BODY;
      ctx.fillStyle = BODY;
      ctx.globalAlpha = 1;
      drawFigure(ctx, angles);
      ctx.restore();
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, audioData]);

  if (!visible) return null;

  return (
    <canvas
      ref={canvasRef}
      width={480}
      height={640}
      className="viz-builder-figure"
      aria-hidden="true"
    />
  );
}
