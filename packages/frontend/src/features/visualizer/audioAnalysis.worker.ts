/**
 * Audio analysis worker.
 *
 * Offloads frequency-band extraction, perceptual-scale mapping, and beat
 * detection from the main thread. The worker receives raw AnalyserNode
 * frequency data and returns a compact AudioData-shaped payload.
 *
 * Message protocol (main → worker):
 *   { type: "analyze", payload: { freq: Uint8Array, sampleRate: number, elapsed: number, duration: number, beatTimes?: number[], downbeatTimes?: number[], energyCurve?: Array<{t:number,e:number}>, perceptualScale?: PerceptualScale, numPerceptualBands?: number } }
 *
 * Message protocol (worker → main):
 *   { type: "result", data: AudioData }
 */

import { ATTACK, RELEASE, smoothBeatPhase } from "./audioTiming";
import { mapToPerceptualBands } from "./perceptualScales";
import type { PerceptualScale } from "./perceptualScales";
import { classifyDrumType } from "./drumClassifier";
import {
  extractFrequencyBands,
  updatePeakHold,
} from "./audioAnalysisHelpers";
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
  /** True when the current frame is on a backend-identified downbeat. */
  isDownbeat: boolean;
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
    downbeatTimes?: number[];
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

let smoothedBass = 0;
let smoothedMid = 0;
let smoothedTreble = 0;
const peakHold = 0;
const peakDecay = 0;
let smoothedPhase = 0;
let lastBass = 0;
let beatCooldown = 0;
const recentBeatIntervals: number[] = [];
let lastBeatTime = 0;
let nextBeatIn = 0;

function analyze(msg: AnalyzeMessage): WorkerAudioData {
  const { freq, sampleRate, elapsed, duration, beatTimes, downbeatTimes, energyCurve, perceptualScale = "mel", numPerceptualBands = 40 } = msg.payload;

  const { bass, mid, treble } = extractFrequencyBands(freq, sampleRate);

  smoothedBass += (bass - smoothedBass) * (bass > smoothedBass ? ATTACK : RELEASE);
  smoothedMid += (mid - smoothedMid) * (mid > smoothedMid ? ATTACK : RELEASE);
  smoothedTreble += (treble - smoothedTreble) * (treble > smoothedTreble ? ATTACK : RELEASE);

  const bassSmoothed = smoothedBass;
  const midSmoothed = smoothedMid;
  const trebleSmoothed = smoothedTreble;
  const overallSmoothed = bassSmoothed * 0.4 + midSmoothed * 0.35 + trebleSmoothed * 0.25;

  updatePeakHold({ peak: peakHold, decayFrames: peakDecay }, Math.max(bassSmoothed, midSmoothed, trebleSmoothed));

  let isBeat: boolean;
  let drumType: "kick" | "snare" | "hat" | null = null;

  if (beatTimes && beatTimes.length > 0 && elapsed > 0) {
    isBeat = getBeatNearTimeFromArray(beatTimes, elapsed, 0.06) !== null;
    if (isBeat) {
      if (bassSmoothed > 0.01 || midSmoothed > 0.01 || trebleSmoothed > 0.01) {
        drumType = classifyDrumType(bassSmoothed, midSmoothed, trebleSmoothed);
      }
      lastBeatTime = elapsed;
      nextBeatIn = getNextBeatInFromArray(beatTimes, elapsed);
    }
  } else {
    const avgEnergy = (bassSmoothed + midSmoothed + trebleSmoothed) / 3;
    const threshold = 0.4 + avgEnergy * 0.3;
    beatCooldown = Math.max(0, beatCooldown - 1);
    isBeat = bassSmoothed > threshold && bassSmoothed > lastBass * 1.1 && beatCooldown === 0;
    if (isBeat) {
      beatCooldown = 6;
      if (bassSmoothed > 0.01 || midSmoothed > 0.01 || trebleSmoothed > 0.01) {
        drumType = classifyDrumType(bassSmoothed, midSmoothed, trebleSmoothed);
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
  lastBass = bassSmoothed;

  // Downbeat detection from backend downbeat times (150ms window)
  const downbeatT = Math.round(elapsed * 100);
  let isDownbeat = false;
  if (downbeatTimes && downbeatTimes.length > 0) {
    for (let delta = 0; delta <= 15; delta++) {
      if (downbeatTimes.some((bt) => Math.round(bt * 100) === downbeatT - delta || Math.round(bt * 100) === downbeatT + delta)) {
        isDownbeat = true;
        break;
      }
    }
  }

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
    smoothedPhase = smoothBeatPhase(phaseInfo.phase, smoothedPhase);
    beatPhase = smoothedPhase;
  }

  const analyzedEnergy =
    energyCurve && energyCurve.length > 0 && duration > 0 && elapsed > 0
      ? getEnergyAtTime(energyCurve, duration, elapsed)
      : 0;

  const bands = mapToPerceptualBands(freq, sampleRate, perceptualScale, numPerceptualBands);

  return {
    bass: bassSmoothed,
    mid: midSmoothed,
    treble: trebleSmoothed,
    overall: overallSmoothed,
    beat: isBeat,
    peak: peakHold,
    energy: (bassSmoothed + midSmoothed + trebleSmoothed) / 3,
    drumType,
    nextBeatIn,
    beatPhase,
    isDownbeat,
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
