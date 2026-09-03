import { useEffect, useRef } from "react";
import type { AudioData } from "../types";
import type { StoryBeat, StoryMotif } from "../storyboard";

interface Props {
  audioData: React.MutableRefObject<AudioData>;
  storyBeat: StoryBeat | null;
  visible: boolean;
}

/**
 * The Builder — a procedural SVG silhouette figure (Limbo-style) that performs
 * the track's story: hunched at the workbench in early acts, standing and
 * raising its arms at triumph. No faces, no AI anatomy, no skeletal toolchain:
 * nested <g> joints driven per-frame from the live audio ref + storyboard act.
 *
 * Craft rules applied (see docs/knowledge-library/silhouette-character-animation.md):
 * - Exaggerated poses pushed past naturalism; limbs kept clear of the torso
 *   (negative space) so every pose passes the Silhouette Test at thumbnail scale.
 * - The puppet is articulated once inside <defs> and rendered twice via <use>:
 *   a wider act-palette rim pass underneath, near-black body on top.
 * - Animation runs in its own rAF loop mutating SVG attributes — zero React
 *   re-renders. Beat bounce uses a decayed pulse (same pattern as shader u_beat).
 */

interface Pose {
  /** Hips height: 0 = standing, 1 = fully seated */
  sit: number;
  /** Root stage position 0..1 (x) */
  rootX: number;
  torsoLean: number;
  headTilt: number;
  shL: number; elL: number;
  shR: number; elR: number;
  hipL: number; kneeL: number;
  hipR: number; kneeR: number;
  /** Extra hammer-arm swing amplitude on beats (assembly work) */
  hammer: number;
  /** Vertical bob amplitude on beats */
  bob: number;
}

const POSES: Record<StoryMotif, Pose> = {
  // Profile facing right. Angles in degrees; arms 0 = hanging down, + = forward/up.
  establishing: { sit: 1, rootX: 0.22, torsoLean: 14, headTilt: 10, shL: 38, elL: -18, shR: 52, elR: -30, hipL: -82, kneeL: 88, hipR: -78, kneeR: 84, hammer: 0, bob: 2 },
  solitude: { sit: 1, rootX: 0.2, torsoLean: 20, headTilt: 16, shL: 30, elL: -12, shR: 44, elR: -24, hipL: -84, kneeL: 90, hipR: -80, kneeR: 86, hammer: 0, bob: 1.5 },
  struggle: { sit: 1, rootX: 0.24, torsoLean: 8, headTilt: -14, shL: 96, elL: -110, shR: 40, elR: -20, hipL: -80, kneeL: 86, hipR: -70, kneeR: 78, hammer: 0, bob: 3 },
  assembly: { sit: 1, rootX: 0.24, torsoLean: 12, headTilt: 4, shL: 46, elL: -28, shR: 62, elR: -42, hipL: -82, kneeL: 88, hipR: -78, kneeR: 84, hammer: 38, bob: 3 },
  build: { sit: 0.35, rootX: 0.34, torsoLean: 10, headTilt: 0, shL: 55, elL: -30, shR: 70, elR: -40, hipL: -40, kneeL: 44, hipR: -34, kneeR: 38, hammer: 18, bob: 5 },
  payoff: { sit: 0, rootX: 0.42, torsoLean: -4, headTilt: -6, shL: 70, elL: -24, shR: 88, elR: -30, hipL: -8, kneeL: 10, hipR: -4, kneeR: 6, hammer: 0, bob: 7 },
  triumph: { sit: 0, rootX: 0.5, torsoLean: -8, headTilt: -12, shL: 150, elL: -14, shR: 158, elR: -10, hipL: -6, kneeL: 8, hipR: -2, kneeR: 4, hammer: 0, bob: 8 },
  reflection: { sit: 0.6, rootX: 0.3, torsoLean: 16, headTilt: 12, shL: 34, elL: -16, shR: 42, elR: -22, hipL: -60, kneeL: 66, hipR: -56, kneeR: 62, hammer: 0, bob: 2 },
  outro: { sit: 1, rootX: 0.22, torsoLean: 18, headTilt: 14, shL: 32, elL: -14, shR: 40, elR: -22, hipL: -82, kneeL: 88, hipR: -78, kneeR: 84, hammer: 0, bob: 1.5 },
};

const IDLE_POSE: Pose = { sit: 0, rootX: 0.42, torsoLean: 0, headTilt: 0, shL: 14, elL: -10, shR: 20, elR: -14, hipL: -4, kneeL: 6, hipR: 0, kneeR: 2, hammer: 0, bob: 3 };

// Frozen proportions — the anchor everything derives from (see knowledge library).
const LIMB = { torso: 62, head: 12, upper: 26, fore: 24, thigh: 30, shin: 30, foot: 10 };
const HIP_Y = 252; // seated hip height in stage coords (on the stool)
const STAND_LIFT = 2; // hips barely move sit→stand on a high stool; the legs tell the story

export function BuilderFigure({ audioData, storyBeat, visible }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const beatRef = useRef({ storyBeat });
  beatRef.current = { storyBeat };

  // Joint refs (nodes inside <defs>, mirrored by both <use> instances)
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
    let beatPulse = 0;
    // Interpolated pose state — act transitions glide instead of snapping.
    const cur: Pose = { ...IDLE_POSE };
    let benchOpacity = 1;
    const lerpPose = (target: Pose, k: number) => {
      (Object.keys(target) as Array<keyof Pose>).forEach((key) => {
        cur[key] += (target[key] - cur[key]) * k;
      });
    };

    const tick = () => {
      const d = audioData.current;
      if (d.beat) beatPulse = 1;
      else beatPulse = Math.max(0, beatPulse - 0.1);

      const beat = beatRef.current.storyBeat;
      const target = beat ? POSES[beat.motif] ?? IDLE_POSE : IDLE_POSE;
      lerpPose(target, 0.06);

      const t = performance.now() / 1000;
      const breath = Math.sin(t * Math.PI * 2 * 0.22) * 1.6;
      const sway = Math.sin(t * Math.PI * 2 * 0.11) * (1 + d.energy * 3);
      const energy = d.energy;

      // Root: stage x migrates by act; standing lifts hips; beats bounce.
      const stageW = 240;
      const rootX = cur.rootX * stageW;
      const rootY = HIP_Y - (1 - cur.sit) * STAND_LIFT - beatPulse * cur.bob - Math.abs(Math.sin(t * 2.2)) * energy * 2;
      rootRef.current?.setAttribute("transform", `translate(${rootX.toFixed(1)} ${rootY.toFixed(1)}) rotate(${sway.toFixed(2)})`);

      torsoRef.current?.setAttribute("transform", `rotate(${(cur.torsoLean + breath).toFixed(2)})`);
      headRef.current?.setAttribute("transform", `translate(4 ${-LIMB.torso - 14}) rotate(${(cur.headTilt + beatPulse * (target === POSES.payoff || target === POSES.triumph ? -7 : 3)).toFixed(2)})`);

      // Arms — right arm hammers on beats during assembly/build acts.
      const hammerSwing = beatPulse * cur.hammer;
      shLRef.current?.setAttribute("transform", `translate(0 ${-54}) rotate(${(cur.shL + sway * 0.6).toFixed(2)})`);
      elLRef.current?.setAttribute("transform", `translate(0 ${LIMB.upper}) rotate(${cur.elL.toFixed(2)})`);
      shRRef.current?.setAttribute("transform", `translate(0 ${-54}) rotate(${(cur.shR - hammerSwing + sway * 0.6).toFixed(2)})`);
      elRRef.current?.setAttribute("transform", `translate(0 ${LIMB.upper}) rotate(${(cur.elR - hammerSwing * 0.7).toFixed(2)})`);

      // Legs
      hipLRef.current?.setAttribute("transform", `rotate(${cur.hipL.toFixed(2)})`);
      kneeLRef.current?.setAttribute("transform", `translate(0 ${LIMB.thigh}) rotate(${cur.kneeL.toFixed(2)})`);
      hipRRef.current?.setAttribute("transform", `rotate(${cur.hipR.toFixed(2)})`);
      kneeRRef.current?.setAttribute("transform", `translate(0 ${LIMB.thigh}) rotate(${cur.kneeR.toFixed(2)})`);

      // Workbench fades as the figure stands; lamp glow pumps with the music.
      const benchTarget = cur.sit > 0.45 ? 1 : 0;
      benchOpacity += (benchTarget - benchOpacity) * 0.05;
      benchRef.current?.setAttribute("opacity", benchOpacity.toFixed(3));
      lampGlowRef.current?.setAttribute("opacity", Math.min(0.85, (0.22 + energy * 0.55 + beatPulse * 0.25)).toFixed(3));

      // Rim light follows the act palette (single minimal accent).
      rimUseRef.current?.setAttribute("stroke", beat?.palette.accent ?? "#a5b4fc");
      // Hammer prop only in working acts.
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
    <svg
      ref={svgRef}
      viewBox="0 0 240 320"
      className="viz-builder-figure"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="builderLampGlow">
          <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#93c5fd" stopOpacity="0" />
        </radialGradient>
        <g id="builderBody">
          {/* Legs (far leg dimmer for profile depth) */}
          <g ref={hipLRef}>{seg(LIMB.thigh, 11, true)}<g ref={kneeLRef}>{seg(LIMB.shin, 9, true)}<line x1={0} y1={LIMB.shin} x2={LIMB.foot} y2={LIMB.shin} strokeWidth={7} strokeLinecap="round" opacity={0.55} /></g></g>
          <g ref={hipRRef}>{seg(LIMB.thigh, 11)}<g ref={kneeRRef}>{seg(LIMB.shin, 9)}<line x1={0} y1={LIMB.shin} x2={LIMB.foot} y2={LIMB.shin} strokeWidth={7} strokeLinecap="round" /></g></g>
          {/* Torso + head */}
          <g ref={torsoRef}>
            <line x1={0} y1={0} x2={0} y2={-LIMB.torso} strokeWidth={16} strokeLinecap="round" />
            <g ref={headRef}>
              <circle cx={0} cy={0} r={LIMB.head} />
            </g>
            {/* Arms */}
            <g ref={shLRef}><g>{seg(LIMB.upper, 8, true)}<g ref={elLRef}>{seg(LIMB.fore, 7, true)}<circle cx={0} cy={LIMB.fore} r={4} opacity={0.55} /></g></g></g>
            <g ref={shRRef}><g>{seg(LIMB.upper, 8)}<g ref={elRRef}>{seg(LIMB.fore, 7)}<circle cx={0} cy={LIMB.fore} r={4} />
              {/* Hammer prop in the working hand (assembly acts) */}
              <g ref={armPropRef} opacity={0}>
                <rect x={-2.5} y={20} width={5} height={22} rx={2} />
                <rect x={-9} y={36} width={18} height={8} rx={2} />
              </g>
            </g></g></g>
          </g>
        </g>
      </defs>

      {/* Workbench + stool + lamp (early acts) */}
      <g ref={benchRef}>
        <rect x={52} y={238} width={150} height={10} rx={2} fill="#050508" />
        <rect x={60} y={248} width={8} height={56} fill="#050508" />
        <rect x={186} y={248} width={8} height={56} fill="#050508" />
        <rect x={18} y={252} width={30} height={8} rx={2} fill="#050508" />
        <rect x={28} y={260} width={8} height={44} fill="#050508" />
        {/* Lamp: pole + shade + animated glow (the "blue light" of act I) */}
        <rect x={176} y={180} width={5} height={58} fill="#050508" />
        <polygon points="178,180 196,180 188,196 172,196" fill="#050508" />
        <circle ref={lampGlowRef} cx={184} cy={200} r={46} fill="url(#builderLampGlow)" opacity={0.3} />
        {/* Workpiece on the bench */}
        <rect x={110} y={226} width={26} height={12} rx={2} fill="#050508" />
      </g>

      {/* Puppet: rim pass (act accent) + body pass (near-black) */}
      <g ref={rootRef}>
        <use href="#builderBody" ref={rimUseRef} stroke="#a5b4fc" strokeOpacity={0.5} fill="#a5b4fc" fillOpacity={0.5} transform="translate(-1.6 0)" />
        <use href="#builderBody" stroke="#050508" fill="#050508" />
      </g>
    </svg>
  );
}
