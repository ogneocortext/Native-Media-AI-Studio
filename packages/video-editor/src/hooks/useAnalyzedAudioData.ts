/**
 * useAnalyzedAudioData — Remotion-friendly hook for pre-computed audio analysis.
 *
 * Wraps `useAudioData` from `@remotion/media-utils` with analyzed beat_times,
 * sections, and energy_curve so Remotion compositions can do frame-accurate
 * beat/section lookups without relying on `useWindowedAudioData` alone.
 *
 * AI agents should populate `analysis` with the TimingContract returned by
 * `GET /api/audio/timing-metadata/{filename}`.
 */

import { useCurrentFrame, useVideoConfig } from "remotion";
import { useAudioData, visualizeAudio, visualizeAudioWaveform } from "@remotion/media-utils";
import type { AudioAnalysisData } from "../services/api";
import type { TimingContract, SectionEvent, BeatEvent } from "../lib/timing";
import { getSectionAtTime, getBeatNearTime, getNextBeatIn, interpolateEnergy } from "../lib/timing";

/**
 * useTimingContract — pure contract lookups, no audio decoding.
 *
 * The "equivalent pattern" entry point for compositions that already stream
 * audio through `useWindowedAudioData` (memory-friendly for long tracks) but
 * still want frame-accurate beat/section/energy lookups from an embedded
 * TimingContract. Binary searches run per frame and are O(log n).
 */
export interface TimingContractState {
  time: number;
  frame: number;
  section: SectionEvent | null;
  isBeat: boolean;
  beat: BeatEvent | null;
  /** Seconds since the closest beat (0 when on-beat or between-window) */
  sinceBeat: number;
  nextBeatIn: number;
  /** Interpolated energy from the contract's energy curve (0..1) */
  contractEnergy: number;
  /** Energy of the enclosing section (0..1) */
  sectionEnergy: number;
  ready: boolean;
}

export function useTimingContract(contract: TimingContract | null): TimingContractState {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  if (!contract) {
    return { time: t, frame, section: null, isBeat: false, beat: null, sinceBeat: 0, nextBeatIn: 0, contractEnergy: 0.5, sectionEnergy: 0.5, ready: false };
  }

  const beats = contract.beats || [];
  const beatResult = getBeatNearTime(beats, t, 0.1);
  const sinceBeat = beatResult ? beatResult.distance : 0;
  const section = getSectionAtTime(contract.sections || [], t);

  return {
    time: t,
    frame,
    section,
    isBeat: beatResult !== null,
    beat: beatResult?.beat ?? null,
    sinceBeat,
    nextBeatIn: getNextBeatIn(beats, t),
    contractEnergy: interpolateEnergy(contract, t),
    sectionEnergy: section?.energy ?? 0.5,
    ready: true,
  };
}

export interface AnalyzedAudioState {
  /** Raw frequency spectrum (from Remotion) */
  spectrum: number[];
  /** Raw waveform (from Remotion) */
  waveform: number[];
  /** Current time in seconds */
  time: number;
  /** Current frame */
  frame: number;
  /** Current section from analyzed data */
  section: SectionEvent | null;
  /** Is this frame on a beat (within windowSec of a beat onset)? */
  isBeat: boolean;
  /** Closest beat event */
  beat: BeatEvent | null;
  /** Seconds until the next beat */
  nextBeatIn: number;
  /** Interpolated energy at current time (0..1) */
  energy: number;
  /** Bass/mid/treble proxy from spectrum */
  bass: number;
  mid: number;
  treble: number;
  /** Whether analyzed data is loaded */
  ready: boolean;
}

export function useAnalyzedAudioData(
  audioSrc: string,
  analysis: AudioAnalysisData | null,
  options: {
    beatWindowMs?: number;
    smoothing?: boolean;
  } = {}
): AnalyzedAudioState {
  const { beatWindowMs = 100, smoothing = true } = options;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const audioData = useAudioData(audioSrc);
  const t = frame / fps;

  // Fallback spectrum/waveform when no analyzed data
  const spectrum = audioData
    ? visualizeAudio({ fps, frame, audioData, numberOfSamples: 64, optimizeFor: "speed" })
    : new Array(64).fill(0);
  const waveform = audioData
    ? visualizeAudioWaveform({ fps, frame, audioData, numberOfSamples: 200, windowInSeconds: 0.4 })
    : new Array(200).fill(0);

  const bass = spectrum.slice(0, 12).reduce((a, b) => a + b, 0) / 12 || 0;
  const mid = spectrum.slice(12, 32).reduce((a, b) => a + b, 0) / 20 || 0;
  const treble = spectrum.slice(32, 56).reduce((a, b) => a + b, 0) / 24 || 0;

  if (!analysis || !analysis.timing_contract) {
    return {
      spectrum, waveform, time: t, frame,
      section: null, isBeat: false, beat: null, nextBeatIn: 0,
      energy: (bass + mid + treble) / 3,
      bass, mid, treble,
      ready: false,
    };
  }

  const contract = analysis.timing_contract as TimingContract;
  const beats = contract.beats || [];
  const sections = contract.sections || [];
  const duration = contract.duration || 0;

  // Section lookup via shared binary search
  const section = getSectionAtTime(sections, t);

  // Beat lookup via shared binary search
  const beatResult = getBeatNearTime(beats, t, beatWindowMs / 1000);
  const isBeat = beatResult !== null;
  const beat = beatResult?.beat ?? null;
  const nextBeatIn = getNextBeatIn(beats, t);

  // Interpolated energy from curve (shared helper)
  const baseEnergy = (bass + mid + treble) / 3;
  const analysisEnergy = interpolateEnergy(contract, t);
  // Blend: 40% analysis (stable section energy) + 60% live (transient reactivity)
  const energy = baseEnergy * 0.6 + analysisEnergy * 0.4;

  return {
    spectrum, waveform, time: t, frame,
    section, isBeat, beat, nextBeatIn,
    energy,
    bass, mid, treble,
    ready: true,
  };
}

export type { TimingContractState };
