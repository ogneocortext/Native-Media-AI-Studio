/**
 * IntroTemplate — deterministic brand-intro composition driven entirely
 * by an intro-recipe (schema: docs/knowledge-library/video-intro-recipe-schema-2026-10.md).
 *
 * All animation derives from frame/fps via useCurrentFrame — no clocks,
 * no randomness (determinism guarantee). The recipe arrives as props;
 * calculateMetadata derives durationInFrames/width/height/fps from it.
 */

import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { CalculateMetadataFunction } from "remotion";

export interface IntroRecipe {
  // Index signature: Remotion types composition props as
  // Record<string, unknown>; the recipe JSON also carries $schema,
  // version, and name fields the component ignores.
  [key: string]: unknown;
  duration_seconds: number;
  canvas: {
    width: number;
    height: number;
    fps: number;
    background: string;
  };
  brand: {
    logo: {
      source: string;
      placement: { x: number; y: number };
      scale: number;
      opacity: number;
      anchor: string;
    };
    palette: { primary: string; secondary: string; tertiary: string };
  };
  sting?: {
    source: string;
    fade_in_sec: number;
    fade_out_sec: number;
    gain_db: number;
  };
  motion: {
    curve: string;
    intro_animation: string;
    logo_dwell_sec: number;
  };
}

// Phase constants (seconds). OUTRO_DUR/TAIL derive the fade window so the
// logo is fully out on the sting's last measured beat (4.90s of 5.0s).
const OUTRO_DUR = 0.8;
const TAIL = 0.1;

const CURVE_BEZIERS: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
  bounce: [0.68, -0.55, 0.27, 1.55],
};

function anchorOffset(
  anchor: string,
  x: number,
  y: number,
  w: number,
  h: number,
): { left: number; top: number } {
  const cx = x; // normalized placement
  const cy = y;
  switch (anchor) {
    case "top-left":
      return { left: cx, top: cy };
    case "top-right":
      return { left: cx - w, top: cy };
    case "bottom-left":
      return { left: cx, top: cy - h };
    case "bottom-right":
      return { left: cx - w, top: cy - h };
    default:
      return { left: cx - w / 2, top: cy - h / 2 };
  }
}

export const IntroTemplate: React.FC<IntroRecipe> = (recipe) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const dur = recipe.duration_seconds;
  const outroStart = dur - OUTRO_DUR - TAIL;
  const introEnd = outroStart - recipe.motion.logo_dwell_sec;
  const bezier = CURVE_BEZIERS[recipe.motion.curve] ?? CURVE_BEZIERS["ease-out"];

  // Intro ramp: 0 -> 1 across [0, introEnd] on the recipe curve.
  const introP = interpolate(t, [0, introEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...bezier),
  });
  // Outro ramp: 0 -> 1 across [outroStart, outroStart + OUTRO_DUR].
  const outroP = interpolate(t, [outroStart, outroStart + OUTRO_DUR], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.42, 0, 0.58, 1),
  });

  const logo = recipe.brand.logo;
  const logoW = logo.scale; // fraction of canvas width, resolved below
  const cw = recipe.canvas.width;
  const ch = recipe.canvas.height;
  const w = logoW * cw;
  const h = w; // logo.svg is square (64x64 viewBox)
  const pos = anchorOffset(
    logo.anchor,
    logo.placement.x * cw,
    logo.placement.y * ch,
    w,
    h,
  );

  // intro_animation: fade-in | scale-up | slide-up | none
  const opacity = logo.opacity * introP * (1 - outroP);
  let transform = "";
  switch (recipe.motion.intro_animation) {
    case "scale-up":
      transform = `scale(${interpolate(introP, [0, 1], [0.9, 1])})`;
      break;
    case "slide-up":
      transform = `translateY(${interpolate(introP, [0, 1], [24, 0])}px)`;
      break;
    default:
      break;
  }

  const sting = recipe.sting;
  const stingGain = sting ? Math.pow(10, sting.gain_db / 20) : 1;
  const stingVolume = (f: number): number => {
    if (!sting) return 0;
    const st = f / fps;
    const fin = Math.min(1, st / Math.max(sting.fade_in_sec, 1e-6));
    // Fade out linearly across the sting's last fade_out_sec (ends at dur - TAIL).
    const fout = Math.min(1, Math.max(0, (dur - TAIL - st) / Math.max(sting.fade_out_sec, 1e-6)));
    return Math.min(fin, fout) * stingGain;
  };

  return (
    <AbsoluteFill style={{ backgroundColor: recipe.canvas.background }}>
      <AbsoluteFill
        style={{
          justifyContent: "flex-start",
          alignItems: "flex-start",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: pos.left,
            top: pos.top,
            width: w,
            height: h,
            opacity,
            transform,
          }}
        >
          <Img
            src={staticFile(logo.source)}
            style={{ width: "100%", height: "100%" }}
          />
        </div>
      </AbsoluteFill>
      {sting ? (
        <Audio src={staticFile(sting.source)} volume={stingVolume} />
      ) : null}
    </AbsoluteFill>
  );
};

export const calculateIntroMetadata: CalculateMetadataFunction<IntroRecipe> = ({
  props,
}) => ({
  durationInFrames: Math.max(
    1,
    Math.round(props.duration_seconds * props.canvas.fps),
  ),
  width: props.canvas.width,
  height: props.canvas.height,
  fps: props.canvas.fps,
});

export const introDefaultProps: IntroRecipe = {
  duration_seconds: 5.0,
  canvas: { width: 1920, height: 1080, fps: 24, background: "#000000" },
  brand: {
    logo: {
      source: "branding/logo.svg",
      placement: { x: 0.5, y: 0.5 },
      scale: 0.4,
      opacity: 1.0,
      anchor: "center",
    },
    palette: { primary: "#0766ee", secondary: "#bd50fd", tertiary: "#6259fd" },
  },
  sting: {
    source: "branding/sting-v1.wav",
    fade_in_sec: 0.05,
    fade_out_sec: 0.5,
    gain_db: 0.0,
  },
  motion: { curve: "ease-out", intro_animation: "fade-in", logo_dwell_sec: 3.473 },
};
