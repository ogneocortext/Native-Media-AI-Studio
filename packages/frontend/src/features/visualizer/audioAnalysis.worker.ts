/**
 * Audio analysis worker.
 *
 * Offloads frequency-band extraction, perceptual-scale mapping, and beat
 * detection from the main thread. The worker receives raw AnalyserNode
 * frequency data and returns a compact AudioData-shaped payload.
 *
 * Message protocol (main → worker):
 *   { type: "analyze", payload: { freq: Uint8Array, sampleRate: number, elapsed: number, duration: number, beatTimes?: number[], energyCurve?: Array<{t:number,e:number}>, perceptualScale?: PerceptualScale, numPerceptualBands?: number } }
 *
 * Message protocol (worker → main):
 *   { type: "result", data: AudioData }
 */

import { ATTACK, RELEASE } from "./audioTiming";
import { mapToPerceptualBands } from "./perceptualScales";
import type { PerceptualScale } from "./perceptualScales";
import {
  getBeatNearTimeFromArray,
  getBeatPhase as getBeatPhaseFromGrid,
  getEnergyAtTime,
  getNextBeatInFromArray,
} from "../../shared/timing";

export interface WorkerAudioData {
  bass: number;
  mid: number;
  treble: number;
  overall: number;
  beat: boolean;
  peak: number;
  energy: number;
  drumType: "kick" | "snare" | "hat" | null;
  nextBeatIn: number;
  /** Smoothed continuous beat phase, or undefined when no analyzed beat grid. */
  beatPhase: number | undefined;
  analyzedEnergy: number;
  perceptualBands: number[];
  perceptualScale: PerceptualScale;
}

export interface AnalyzeMessage {
  type: "analyze";
  payload: {
    freq: Uint8Array;
    sampleRate: number;
    elapsed: number;
    duration: number;
    beatTimes?: number[];
    energyCurve?: number[];
    perceptualScale?: "bark" | "erb" | "mel" | "log" | "linear";
    numPerceptualBands?: number;
  };
}

export interface ResultMessage {
  type: "result";
  data: WorkerAudioData;
}

export type WorkerMessage = AnalyzeMessage | ResultMessage;

// ── helpers ──────────────────────────────────────────────────────────────────
//
// Perceptual band mapping and the beat/energy lookups are imported from the
// shared modules instead of re-implemented here: the previous local copies had
// drifted from the main-thread path (unclamped beat phase, different smoothing
// constants, no `numBands` guard), so the worker and the inline path produced
// *different* visuals for the same audio.

// ─ main loop ────────────────────────────────────────────────────────────────
// ATTACK/RELEASE come from audioTiming.ts (shared with the inline path);
// the previous local ATTACK = 0.35 smoothed 2.5× slower than the main thread.

const PEAK_DECAY_FRAMES = 30;

let smoothedBass = 0;
let smoothedMid = 0;
let smoothedTreble = 0;
let peakHold = 0;
let peakDecay = 0;
let smoothedPhase = 0;
let lastBass = 0;
let beatCooldown = 0;
const recentBeatIntervals: number[] = [];
let lastBeatTime = 0;
let nextBeatIn = 0;

function analyze(msg: AnalyzeMessage): WorkerAudioData {
  const { freq, sampleRate, elapsed, duration, beatTimes, energyCurve, perceptualScale = "mel", numPerceptualBands = 40 } = msg.payload;

  const binSize = sampleRate / (freq.length * 2);
  const bassMax = 250;
  const midMax = 4000;
  const bassBins = Math.max(1, Math.floor(bassMax / binSize));
  const midBins = Math.max(bassBins + 1, Math.floor(midMax / binSize));

  const rawBass = freq.slice(0, bassBins).reduce((a, b) => a + b, 0) / (bassBins * 255 || 1);
  const rawMid = freq.slice(bassBins, midBins).reduce((a, b) => a + b, 0) / ((midBins - bassBins) * 255 || 1);
  const rawTreble = freq.slice(midBins).reduce((a, b) => a + b, 0) / ((freq.length - midBins) * 255 || 1);

  smoothedBass += (rawBass - smoothedBass) * (rawBass > smoothedBass ? ATTACK : RELEASE);
  smoothedMid += (rawMid - smoothedMid) * (rawMid > smoothedMid ? ATTACK : RELEASE);
  smoothedTreble += (rawTreble - smoothedTreble) * (rawTreble > smoothedTreble ? ATTACK : RELEASE);

  const bass = smoothedBass;
  const mid = smoothedMid;
  const treble = smoothedTreble;
  const overall = bass * 0.4 + mid * 0.35 + treble * 0.25;

  const currentPeak = Math.max(bass, mid, treble);
  if (currentPeak > peakHold) {
    peakHold = currentPeak;
    peakDecay = 0;
  } else {
    peakDecay++;
    if (peakDecay > PEAK_DECAY_FRAMES) peakHold *= 0.95;
  }

  let isBeat: boolean;
  let drumType: "kick" | "snare" | "hat" | null = null;

  if (beatTimes && beatTimes.length > 0 && elapsed > 0) {
    isBeat = getBeatNearTimeFromArray(beatTimes, elapsed, 0.06) !== null;
    if (isBeat) {
      if (bass > 0.01 || mid > 0.01 || treble > 0.01) {
        const bassToMid = bass / (mid || 0.001);
        const trebleToMid = treble / (mid || 0.001);
        if (bassToMid > 1.8) drumType = "kick";
        else if (trebleToMid > 1.5) drumType = "hat";
        else if (mid > bass && mid > treble) drumType = "snare";
        if (!drumType && bass > mid && bass > treble) drumType = "kick";
        if (!drumType && treble > mid && treble > bass) drumType = "hat";
      }
      lastBeatTime = elapsed;
      // Analyzed grid: exact countdown to the next beat (same source as the
      // inline path) instead of an interval-average estimate.
      nextBeatIn = getNextBeatInFromArray(beatTimes, elapsed);
    }
  } else {
    const avgEnergy = (bass + mid + treble) / 3;
    const threshold = 0.4 + avgEnergy * 0.3;
    beatCooldown = Math.max(0, beatCooldown - 1);
    isBeat = bass > threshold && bass > lastBass * 1.1 && beatCooldown === 0;
    if (isBeat) {
      beatCooldown = 6;
      if (bass > 0.01 || mid > 0.01 || treble > 0.01) {
        const bassToMid = bass / (mid || 0.001);
        const trebleToMid = treble / (mid || 0.001);
        if (bassToMid > 1.8) drumType = "kick";
        else if (trebleToMid > 1.5) drumType = "hat";
        else if (mid > bass && mid > treble) drumType = "snare";
        if (!drumType && bass > mid && bass > treble) drumType = "kick";
        if (!drumType && treble > mid && treble > bass) drumType = "hat";
      }
      if (lastBeatTime > 0 && elapsed > 0) {
        const interval = elapsed - lastBeatTime;
        if (interval > 0.15 && interval < 2.0) {
          recentBeatIntervals.push(interval);
          if (recentBeatIntervals.length > 8) recentBeatIntervals.shift();
        }
      }
      lastBeatTime = elapsed;
      if (recentBeatIntervals.length > 0) {
        nextBeatIn = recentBeatIntervals.reduce((a, b) => a + b, 0) / recentBeatIntervals.length;
      }
    } else if (nextBeatIn > 0) {
      nextBeatIn = Math.max(0, nextBeatIn - 0.016);
    }
  }
  lastBass = bass;

  // Continuous beat phase for fluid motion — the boolean `beat` above only
  // snaps on onset frames. Undefined without an analyzed grid, exactly like the
  // inline path, so consumers can fall back to onset pulses instead of reading
  // a fake "phase 0".
  const phaseInfo =
    beatTimes && beatTimes.length > 0 && elapsed > 0
      ? getBeatPhaseFromGrid(beatTimes, elapsed)
      : null;
  let beatPhase: number | undefined;
  if (phaseInfo) {
    // Low-pass the analyzed phase to reduce grid jitter; wrap-aware so a
    // 0.97→0.03 crossing does not spin the phase backwards.
    const targetPhase = phaseInfo.phase;
    let phaseDelta = targetPhase - smoothedPhase;
    if (phaseDelta > 0.5) phaseDelta -= 1;
    if (phaseDelta < -0.5) phaseDelta += 1;
    smoothedPhase += phaseDelta * 0.3;
    smoothedPhase = ((smoothedPhase % 1) + 1) % 1;
    beatPhase = smoothedPhase;
  }

  const analyzedEnergy =
    energyCurve && energyCurve.length > 0 && duration > 0 && elapsed > 0
      ? getEnergyAtTime(energyCurve, duration, elapsed)
      : 0;

  const bands = mapToPerceptualBands(freq, sampleRate, perceptualScale, numPerceptualBands);

  return {
    bass,
    mid,
    treble,
    overall,
    beat: isBeat,
    peak: peakHold,
    energy: (bass + mid + treble) / 3,
    drumType,
    nextBeatIn,
    beatPhase,
    analyzedEnergy,
    perceptualBands: bands,
    perceptualScale,
  };
}

// ── worker entry ─────────────────────────────────────────────────────────────

self.onmessage = (ev: MessageEvent<AnalyzeMessage>) => {
  if (ev.data.type === "analyze") {
    const data = analyze(ev.data);
    const out: ResultMessage = { type: "result", data };
    self.postMessage(out);
  }
};
