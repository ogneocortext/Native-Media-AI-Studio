import { useEffect, useRef } from "react";
import type { AudioData } from "../types";
import type { StoryBeat, StoryMotif } from "../storyboard";

/**
 * Builder — v2 redesign (Summer 2026 research)
 * 
 * Story-first, not generic liquid-avatar. Implements 2026 findings:
 * - Performance-driven: each StoryMotif is a specific acting choice (vcad/pixune 2026),
 *   not `energy * sin()`. See docs/knowledge-library/character-animation-2026-summer-synthesis.md
 * - Locked anchor: LIMB/HIP_Y frozen (Elser "character bible" 2026) — pose edits must pass silhouette test
 * - Beat-sync via beatPhase/nextBeatIn (Charios/AnimBeat 2026) — scale to BPM, offset to downbeat, never hand-tweak frames
 * - Hybrid 2D silhouette + fog rim (pixune NPR 2026) — near-black fill + single act accent, no photoreal skin
 * - Crafted imperfection: one wobble/smore per act (videobolt 2026) — not constant noise
 * 
 * Architecture: three independent layers blended in tick() — easy to tune without cross-talk
 *   basePose  ← StoryMotif (act truth)
 *   + beatLayer  ← beatPhase/nextBeatIn (musical grid)
 *   + idleLayer  ← breath/sway/micro (human feel)
 */

interface Props {
  audioData: React.MutableRefObject<AudioData>;
  storyBeat: StoryBeat | null;
  visible: boolean;
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

export function BuilderFigure({ audioData, storyBeat, visible }: Props) {
  const beatRef = useRef({ storyBeat });
  beatRef.current = { storyBeat };

  const rootRef = useRef<SVGGElement>(null);
  const torsoRef = useRef<SVGGElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const shLRef = useRef<SVGGElement>(null);
  const elLRef = useRef<SVGGElement>(null);
  const shRRef = useRef<SVGGElement>(null);
  const elRRef = useRef<SVGGElement>(null);
  const hipLRef = useRef<SVGGElement>(null);
  const kneeLRef = useRef<SVGGElement>(null);
  const hipRRef = useRef<SVGGElement>(null);
  const kneeRRef = useRef<SVGGElement>(null);
  const benchRef = useRef<SVGGElement>(null);
  const lampGlowRef = useRef<SVGCircleElement>(null);
  const rimUseRef = useRef<SVGUseElement>(null);
  const armPropRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    let lastT = performance.now();
    const cur: Pose = { ...IDLE_POSE };
    let benchOpacity = 1;

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.033, (now - lastT) / 1000);
      lastT = now;

      const d = audioData.current;
      const beat = beatRef.current.storyBeat;
      const target = beat ? POSES[beat.motif] ?? IDLE_POSE : IDLE_POSE;

      // --- Base pose: story truth, frame-rate independent, per-joint tuned ---
      (Object.keys(target) as Array<keyof Pose>).forEach((k) => {
        const fk = 1 - Math.pow(1 - springK(k), dt * 60);
        cur[k] += (target[k] - cur[k]) * fk;
      });

      // --- Beat layer: 2026 Charios/AnimBeat — beatPhase + nextBeatIn, not boolean
      const beatPhase = (d as any).beatPhase ?? 0.5;
      const nextBeatIn = (d as any).nextBeatIn ?? 1;
      const interBeatBob = Math.sin(beatPhase * Math.PI * 2) * 0.5 + 0.5; // 0..1 continuous
      const t = now / 1000;
      const breath = Math.sin(t * Math.PI * 2 * 0.19) * 1.1 + Math.sin(t * Math.PI * 2 * 0.37 + 1.3) * 0.45;
      const sway = Math.sin(t * Math.PI * 2 * 0.09) * (0.9 + d.energy * 1.8) + Math.sin(t * Math.PI * 2 * 0.14 + 0.8) * 0.28 + Math.sin(t * 4.2) * 0.07;
      const isWorking = cur.hammer > 5;
      const finalHammer = isWorking ? (d.beat ? cur.hammer : (nextBeatIn < 0.12 ? -7 * ((0.12 - nextBeatIn)/0.12) : 0)) : 0;

      const energy = d.energy;

      // --- Idle layer: breath + micro
      const stageW = 240;
      const rootX = cur.rootX * stageW;
      // Bob uses inter-beat via beatPhase for continuous motion, plus eased beat for accent
      const bobVal = cur.bob * (0.3 + 0.7 * (d.beat ? 1 : interBeatBob * 0.4)) + Math.abs(Math.sin(t * 2.2)) * energy * 1.2;
      const rootY = HIP_Y - (1 - cur.sit) * STAND_LIFT - bobVal;

      rootRef.current?.setAttribute("transform", `translate(${rootX.toFixed(1)} ${rootY.toFixed(1)}) rotate(${sway.toFixed(2)})`);
      torsoRef.current?.setAttribute("transform", `rotate(${(cur.torsoLean + breath * (0.9 + energy * 0.4)).toFixed(2)})`);
      headRef.current?.setAttribute("transform", `translate(4 ${-LIMB.torso - 14}) rotate(${(cur.headTilt + sway * 0.22 + (d.beat ? (target === POSES.payoff || target === POSES.triumph ? -5 : 2) : 0)).toFixed(2)})`);

      // Arms: shoulders follow sway, hammers snap on beat with wind-up
      shLRef.current?.setAttribute("transform", `translate(0 ${-54}) rotate(${(cur.shL + sway * 0.5).toFixed(2)})`);
      elLRef.current?.setAttribute("transform", `translate(0 ${LIMB.upper}) rotate(${(cur.elL + Math.sin(t * 4.8) * 0.4 * energy).toFixed(2)})`);
      shRRef.current?.setAttribute("transform", `translate(0 ${-54}) rotate(${(cur.shR - finalHammer + sway * 0.5).toFixed(2)})`);
      elRRef.current?.setAttribute("transform", `translate(0 ${LIMB.upper}) rotate(${(cur.elR - finalHammer * 0.7 + Math.sin(t * 4.8 + 0.6) * 0.35 * energy).toFixed(2)})`);

      hipLRef.current?.setAttribute("transform", `rotate(${cur.hipL.toFixed(2)})`);
      kneeLRef.current?.setAttribute("transform", `translate(0 ${LIMB.thigh}) rotate(${(cur.kneeL + Math.sin(t * 3.0) * 0.4 * energy).toFixed(2)})`);
      hipRRef.current?.setAttribute("transform", `rotate(${cur.hipR.toFixed(2)})`);
      kneeRRef.current?.setAttribute("transform", `translate(0 ${LIMB.thigh}) rotate(${(cur.kneeR + Math.sin(t * 3.0 + 0.9) * 0.4 * energy).toFixed(2)})`);

      const benchTarget = cur.sit > 0.45 ? 1 : 0;
      benchOpacity += (benchTarget - benchOpacity) * (1 - Math.pow(1 - 0.05, dt * 60));
      benchRef.current?.setAttribute("opacity", benchOpacity.toFixed(3));
      lampGlowRef.current?.setAttribute("opacity", Math.min(0.85, (0.22 + energy * 0.5 + (d.beat ? 0.22 : 0))).toFixed(3));
      rimUseRef.current?.setAttribute("stroke", beat?.palette.accent ?? "#a5b4fc");
      armPropRef.current?.setAttribute("opacity", cur.hammer > 8 ? "1" : "0");

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, audioData]);

  if (!visible) return null;

  const seg = (len: number, w: number, far = false) => (
    <line x1={0} y1={0} x2={0} y2={len} strokeWidth={w} strokeLinecap="round" opacity={far ? 0.55 : 1} />
  );

  return (
    <svg viewBox="0 0 240 320" className="viz-builder-figure" aria-hidden="true">
      <defs>
        <radialGradient id="builderLampGlow">
          <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#93c5fd" stopOpacity="0" />
        </radialGradient>
        <g id="builderBody">
          <g ref={hipLRef}>{seg(LIMB.thigh, 11, true)}<g ref={kneeLRef}>{seg(LIMB.shin, 9, true)}<line x1={0} y1={LIMB.shin} x2={LIMB.foot} y2={LIMB.shin} strokeWidth={7} strokeLinecap="round" opacity={0.55} /></g></g>
          <g ref={hipRRef}>{seg(LIMB.thigh, 11)}<g ref={kneeRRef}>{seg(LIMB.shin, 9)}<line x1={0} y1={LIMB.shin} x2={LIMB.foot} y2={LIMB.shin} strokeWidth={7} strokeLinecap="round" /></g></g>
          <g ref={torsoRef}>
            <line x1={0} y1={0} x2={0} y2={-LIMB.torso} strokeWidth={16} strokeLinecap="round" />
            <g ref={headRef}><circle cx={0} cy={0} r={LIMB.head} /></g>
            <g ref={shLRef}><g>{seg(LIMB.upper, 8, true)}<g ref={elLRef}>{seg(LIMB.fore, 7, true)}<circle cx={0} cy={LIMB.fore} r={4} opacity={0.55} /></g></g></g>
            <g ref={shRRef}><g>{seg(LIMB.upper, 8)}<g ref={elRRef}>{seg(LIMB.fore, 7)}<circle cx={0} cy={LIMB.fore} r={4} />
              <g ref={armPropRef} opacity={0}>
                <rect x={-2.5} y={20} width={5} height={22} rx={2} />
                <rect x={-9} y={36} width={18} height={8} rx={2} />
              </g>
            </g></g></g>
          </g>
        </g>
      </defs>
      <g ref={benchRef}>
        <rect x={52} y={238} width={150} height={10} rx={2} fill="#050508" />
        <rect x={60} y={248} width={8} height={56} fill="#050508" />
        <rect x={186} y={248} width={8} height={56} fill="#050508" />
        <rect x={18} y={252} width={30} height={8} rx={2} fill="#050508" />
        <rect x={28} y={260} width={8} height={44} fill="#050508" />
        <rect x={176} y={180} width={5} height={58} fill="#050508" />
        <polygon points="178,180 196,180 188,196 172,196" fill="#050508" />
        <circle ref={lampGlowRef} cx={184} cy={200} r={46} fill="url(#builderLampGlow)" opacity={0.3} />
        <rect x={110} y={226} width={26} height={12} rx={2} fill="#050508" />
      </g>
      <g ref={rootRef}>
        <use href="#builderBody" ref={rimUseRef} stroke="#a5b4fc" strokeOpacity={0.5} fill="#a5b4fc" fillOpacity={0.5} transform="translate(-1.6 0)" />
        <use href="#builderBody" stroke="#050508" fill="#050508" />
      </g>
    </svg>
  );
}
