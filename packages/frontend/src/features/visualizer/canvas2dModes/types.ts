/**
 * canvas2dModes/types — see index.ts for the module map.
 */
import type { Particle } from "../particles";
import type { PerceptualScale } from "../canvas2dHelpers";

export interface BarModeContext {
  ctx: CanvasRenderingContext2D;
  dpr: number;
  w: number;
  h: number;
  canvas: HTMLCanvasElement | null;
  d: {
    bass: number;
    treble: number;
    beat: boolean;
    beatPhase?: number | null;
    analyzedEnergy?: number;
    peak?: number;
    energy?: number;
    mid?: number;
  };
  syncLineProgress: number;
  sectionProgress: number;
  /** T-VIZ-21 — current lyric line for kinetic-type (null = instrumental). */
  lyric?: {
    text: string;
    start: number;
    end: number;
    section?: string;
    words?: { word: string; start: number; end: number }[];
  } | null;
  /** 0..1 progress through the current lyric line. */
  lyricProgress?: number;
  /** Current musical section label for section-aware modes. */
  sectionName?: string;
  colors: string[];
  perceptualScale: PerceptualScale | undefined;
  freq: Uint8Array | null;
  wave: Uint8Array | null;
  bg: string;
  nowMs: () => number;
  analyser: AnalyserNode | null;
  motionScale: number;
  phraseFlash: number;
  energyMod: number;
  analyzedPunch: number;
  isDownbeat: boolean;
  /** T-VIZ-16 — decaying spectral-flux onset envelope (0..1). */
  onset?: number;
  /** T-VIZ-19 — phase-locked beat envelope (0..1). */
  beatEnv?: number;
  rand: () => number;
  /** Cached gradient builder — keyed by mode + palette + height. */
  getGradients: (mode: string, cols: string[]) => CanvasGradient[];
}

export interface BarModeState {
  barVelocities: number[] | null;
  barPeaks: number[] | null;
  smoothedBars: number[] | null;
  /** T-VIZ-53 — second-stage damped display heights (normalized 0..1). */
  displayBars: number[] | null;
  /** T-VIZ-53 — damped per-layer band values for stacked mode (barCount*3). */
  displayBands: number[] | null;
  waveEnvelope: number[] | null;
  waveVelocities: number[] | null;
  smoothed: Uint8Array | null;
  particles: Particle[];
  lastMs: number | null;
  /**
   * Kinetic-type word-wrap + measureText cache. `measureText` ran per word
   * per frame (~30+ calls) even though the layout only changes when the
   * lyric line, its duration, or the font metrics change — key on those.
   */
  kineticLayout?: {
    key: string;
    spaceW: number;
    lines: {
      words: { text: string; start?: number; end?: number }[];
      widths: number[];
      fullW: number;
    }[];
  } | null;
}
