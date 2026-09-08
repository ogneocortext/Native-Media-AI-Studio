/**
 * Minimal type surface for @remotion/media-utils-free analysis typing.
 * (Kept separate so compositions can import `AudioAnalysisData` without pulling in the whole frontend API layer.)
 */

import type { TimingContract } from "../lib/timing";

export interface AudioAnalysisData {
  /** e.g. "still-i-rise.mp3" */
  filename?: string;
  /** Analyzer output: flat 0..1 samples @ ~2.35s resolution */
  energy_curve?: number[];
  /** Analyzer output: flat 0..1 samples */
  amplitude_envelope?: number[];
  /** Analyzer sections */
  sections?: { type: string; start: number; end: number; energy: number }[];
  /** Normalized TimingContract used by useAnalyzedAudioData */
  timing_contract?: TimingContract;
  [key: string]: unknown;
}