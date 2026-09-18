import { useFrame } from "@react-three/fiber";
import type React from "react";
import { useRef } from "react";
import {
  getBeatNearTimeFromArray,
  getBeatPhase,
  getEnergyAtTime,
  getNextBeatInFromArray,
} from "../../shared/timing";
import { ATTACK, RELEASE } from "./audioTiming";
import type { AudioAnalysisData, AudioData, PerceptualScale } from "./types";
import { generatePerceptualBands, mapToPerceptualBands } from "./perceptualScales";
import type { UseAudioAnalysisWorkerResult } from "./useAudioAnalysisWorker";

// Demo fallback — synthetic audio for when no track is playing
export function useDemoAudio(enabled: boolean, bpm: number, perceptualScale: PerceptualScale = "mel", numPerceptualBands: number = 40) {
  const data = useRef<AudioData>({
    bass: 0,
    mid: 0,
    treble: 0,
    overall: 0,
    beat: false,
    peak: 0,
    energy: 0,
    drumType: null,
    nextBeatIn: 0,
    analyzedEnergy: 0,
  });
  useFrame((state) => {
    if (!enabled) return;
    const t = state.clock.elapsedTime;
    const f = bpm / 120;
    const beatPhase = (t * f * 2) % 1;
    const isBeat = beatPhase < 0.08;
    const bass = (Math.sin(t * f * 2) + 1) / 2;
    const mid = (Math.sin(t * f * 3.5) + 1) / 2;
    const treble = (Math.sin(t * f * 5) + 1) / 2;
    const bands = generatePerceptualBands(perceptualScale, numPerceptualBands, 20, 22050);
    const perceptualBands = bands.map(() => (bass * 0.4 + mid * 0.35 + treble * 0.25));
    data.current = {
      bass,
      mid,
      treble,
      overall: bass * 0.4 + mid * 0.35 + treble * 0.25,
      beat: isBeat,
      peak: Math.max(bass, mid, treble),
      energy: (bass + mid + treble) / 3,
      drumType: null,
      nextBeatIn: 0,
      beatPhase: beatPhase,
      perceptualBands,
      perceptualScale,
    };
  });
  return data;
}

// Real audio — reads from AnalyserNode when audio is playing
export function useRealAudio(
  analyserRef: React.MutableRefObject<AnalyserNode | null>,
  isPlaying: boolean,
  isPaused: boolean,
  analysisData?: AudioAnalysisData | null,
  audioElapsedRef?: React.MutableRefObject<number>,
  perceptualScale: PerceptualScale = "mel",
  numPerceptualBands: number = 40,
  worker?: UseAudioAnalysisWorkerResult | null,
) {
  const data = useRef<AudioData>({
    bass: 0,
    mid: 0,
    treble: 0,
    overall: 0,
    beat: false,
    peak: 0,
    energy: 0,
    drumType: null,
    nextBeatIn: 0,
    analyzedEnergy: 0,
  });
  const freqArray = useRef<Uint8Array | null>(null);
  const lastBass = useRef(0);
  const beatCooldown = useRef(0);
  // Predictive beat: recent intervals for BPM estimation + next-beat countdown
  const recentBeatIntervals = useRef<number[]>([]);
  const lastBeatTime = useRef(0);
  const nextBeatInRef = useRef(0);
  // Separate smoothing for attack (fast) and release (slow) for tighter sync
  const smoothedBass = useRef(0);
  const smoothedMid = useRef(0);
  const smoothedTreble = useRef(0);
  const peakHold = useRef(0);
  const peakDecay = useRef(0);
  // Smoothed continuous beat phase to reduce grid-jitter from analyzed beat_times.
  const smoothedPhase = useRef(0);
  // Cached analysis duration for energy-curve interpolation.
  const analysisDurationRef = useRef(0);
  // Cache perceptual band boundaries so generatePerceptualBands only runs when
  // the scale or band count changes, not every frame.
  const perceptualBandCache = useRef<{
    scale: PerceptualScale;
    numBands: number;
    sampleRate: number;
    boundaries: number[];
  } | null>(null);

  useFrame(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    if (isPaused || !isPlaying) {
      if (
        data.current.bass !== 0 ||
        data.current.mid !== 0 ||
        data.current.treble !== 0
      ) {
        data.current = {
          bass: 0,
          mid: 0,
          treble: 0,
          overall: 0,
          beat: false,
          peak: 0,
          energy: 0,
          drumType: null,
          nextBeatIn: 0,
          analyzedEnergy: 0,
        };
        smoothedBass.current = 0;
        smoothedMid.current = 0;
        smoothedTreble.current = 0;
        peakHold.current = 0;
        smoothedPhase.current = 0;
        analysisDurationRef.current = 0;
      }
      return;
    }

    // Keep analysis duration in sync for energy-curve interpolation.
    if (analysisData && analysisData.duration_seconds > 0) {
      analysisDurationRef.current = analysisData.duration_seconds;
    }

    // Ensure AudioContext is running
    const ctx = analyser.context as AudioContext;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
      return;
    }

    if (
      !freqArray.current ||
      freqArray.current.length !== analyser.frequencyBinCount
    ) {
      freqArray.current = new Uint8Array(
        analyser.frequencyBinCount,
      ) as Uint8Array;
    }
    analyser.getByteFrequencyData(freqArray.current as Uint8Array<ArrayBuffer>);
    const arr = freqArray.current;

    if (worker) {
      const elapsed = audioElapsedRef?.current ?? 0;
      const duration = analysisData?.duration_seconds ?? 0;
      const beatTimes = analysisData?.beat_times;
      const energyCurve = analysisData?.energy_curve;
      worker.send(arr, ctx.sampleRate, elapsed, duration, beatTimes, energyCurve);
      data.current = worker.data.current;
      return;
    }

    // Frequency-based bin mapping using actual sample rate
    const sampleRate = ctx.sampleRate;
    const binSize = sampleRate / (arr.length * 2);
    const bassMaxFreq = 250;
    const midMaxFreq = 4000;
    const bassBins = Math.max(1, Math.floor(bassMaxFreq / binSize));
    const midBins = Math.max(bassBins + 1, Math.floor(midMaxFreq / binSize));

    const rawBass =
      arr.slice(0, bassBins).reduce((a, b) => a + b, 0) / (bassBins * 255 || 1);
    const rawMid =
      arr.slice(bassBins, midBins).reduce((a, b) => a + b, 0) /
      ((midBins - bassBins) * 255 || 1);
    const rawTreble =
      arr.slice(midBins).reduce((a, b) => a + b, 0) /
      ((arr.length - midBins) * 255 || 1);

    // Attack/release smoothing from shared timing constants (kept in sync with
    // the shader-mode loop in Visualizer.tsx — see audioTiming.ts).
    const bassDiff = rawBass - smoothedBass.current;
    smoothedBass.current += bassDiff * (bassDiff > 0 ? ATTACK : RELEASE);
    const midDiff = rawMid - smoothedMid.current;
    smoothedMid.current += midDiff * (midDiff > 0 ? ATTACK : RELEASE);
    const trebleDiff = rawTreble - smoothedTreble.current;
    smoothedTreble.current += trebleDiff * (trebleDiff > 0 ? ATTACK : RELEASE);

    const bass = smoothedBass.current;
    const mid = smoothedMid.current;
    const treble = smoothedTreble.current;
    const overall = bass * 0.4 + mid * 0.35 + treble * 0.25;

    // Peak hold with decay for dynamic range visualization
    const currentPeak = Math.max(bass, mid, treble);
    if (currentPeak > peakHold.current) {
      peakHold.current = currentPeak;
      peakDecay.current = 0;
    } else {
      peakDecay.current++;
      if (peakDecay.current > 30) {
        peakHold.current *= 0.95; // Decay after ~0.5s at 60fps
      }
    }

    // Beat detection: use analyzed beat_times if available
    let isBeat = false;
    let drumType: "kick" | "snare" | "hat" | null = null;
    const elapsed = audioElapsedRef?.current ?? 0;
    if (analysisData && analysisData.beat_times.length > 0 && elapsed > 0) {
      // Use shared timing helper for binary-search beat lookup
      const near = getBeatNearTimeFromArray(
        analysisData.beat_times,
        elapsed,
        0.06,
      );
      if (near) {
        isBeat = true;
        // Drum classification: use current frequency energy ratios at the beat instant
        const bassEnergy = bass;
        const midEnergy = mid;
        const trebleEnergy = treble;
        if (bassEnergy > 0.01 || midEnergy > 0.01 || trebleEnergy > 0.01) {
          if (bassEnergy > 0.01 && midEnergy > 0.001) {
            const bassToMid = bassEnergy / (midEnergy || 0.001);
            const trebleToMid = trebleEnergy / (midEnergy || 0.001);
            if (bassToMid > 1.8) drumType = "kick";
            else if (trebleToMid > 1.5) drumType = "hat";
            else if (midEnergy > bassEnergy && midEnergy > trebleEnergy)
              drumType = "snare";
          }
          if (!drumType && bassEnergy > midEnergy && bassEnergy > trebleEnergy)
            drumType = "kick";
          if (
            !drumType &&
            trebleEnergy > midEnergy &&
            trebleEnergy > bassEnergy
          )
            drumType = "hat";
        }
      }
      // Predictive next-beat countdown from analyzed beat_times
      nextBeatInRef.current = getNextBeatInFromArray(
        analysisData.beat_times,
        elapsed,
      );
    } else {
      // Adaptive bass spike detection with dynamic threshold
      const avgEnergy = (bass + mid + treble) / 3;
      const threshold = 0.4 + avgEnergy * 0.3; // Adapt to track loudness
      beatCooldown.current = Math.max(0, beatCooldown.current - 1);
      isBeat =
        bass > threshold &&
        bass > lastBass.current * 1.1 &&
        beatCooldown.current === 0;
      if (isBeat) {
        beatCooldown.current = 6;
        // Drum classification for fallback detector
        const bassEnergy = bass;
        const midEnergy = mid;
        const trebleEnergy = treble;
        if (bassEnergy > 0.01 || midEnergy > 0.01 || trebleEnergy > 0.01) {
          if (bassEnergy > 0.01 && midEnergy > 0.001) {
            const bassToMid = bassEnergy / (midEnergy || 0.001);
            const trebleToMid = trebleEnergy / (midEnergy || 0.001);
            if (bassToMid > 1.8) drumType = "kick";
            else if (trebleToMid > 1.5) drumType = "hat";
            else if (midEnergy > bassEnergy && midEnergy > trebleEnergy)
              drumType = "snare";
          }
          if (!drumType && bassEnergy > midEnergy && bassEnergy > trebleEnergy)
            drumType = "kick";
          if (
            !drumType &&
            trebleEnergy > midEnergy &&
            trebleEnergy > bassEnergy
          )
            drumType = "hat";
        }
        // Predictive beat from recent intervals (BPM estimation)
        if (lastBeatTime.current > 0 && elapsed > 0) {
          const interval = elapsed - lastBeatTime.current;
          if (interval > 0.15 && interval < 2.0) {
            recentBeatIntervals.current.push(interval);
            if (recentBeatIntervals.current.length > 8)
              recentBeatIntervals.current.shift();
          }
        }
        lastBeatTime.current = elapsed;
        if (recentBeatIntervals.current.length > 0) {
          const avgInterval =
            recentBeatIntervals.current.reduce((a, b) => a + b, 0) /
            recentBeatIntervals.current.length;
          nextBeatInRef.current = Math.max(0, avgInterval);
        }
      } else if (nextBeatInRef.current > 0) {
        nextBeatInRef.current = Math.max(0, nextBeatInRef.current - 0.016);
      }
    }
    lastBass.current = bass;

    // Continuous beat phase for fluid motion (the boolean `beat` above only
    // snaps on onset frames). Null without an analyzed grid — consumers fall
    // back to onset pulses.
    const phaseInfo =
      analysisData && analysisData.beat_times.length > 0 && elapsed > 0
        ? getBeatPhase(analysisData.beat_times, elapsed)
        : null;

    // Low-pass the analyzed phase to reduce jitter from imperfect beat grids.
    // Handles wrap-around so a 0.97→0.03 crossing does not spin the phase back.
    const targetPhase = phaseInfo?.phase ?? 0;
    let phaseDelta = targetPhase - smoothedPhase.current;
    if (phaseDelta > 0.5) phaseDelta -= 1;
    if (phaseDelta < -0.5) phaseDelta += 1;
    smoothedPhase.current += phaseDelta * 0.3;
    smoothedPhase.current = ((smoothedPhase.current % 1) + 1) % 1;

    // Interpolate analyzed energy curve at current elapsed time for intensity modulation.
    const analyzedEnergy =
      analysisData &&
      analysisData.energy_curve.length > 0 &&
      analysisDurationRef.current > 0 &&
      elapsed > 0
        ? getEnergyAtTime(
            analysisData.energy_curve,
            analysisDurationRef.current,
            elapsed,
          )
        : 0;

    // Perceptual frequency band mapping for more accurate visualization.
    // Regenerate band boundaries only when the scale / band count / sample rate
    // changes; the two-pointer mapper itself is already O(n+m).
    const cache = perceptualBandCache.current;
    if (
      !cache ||
      cache.scale !== perceptualScale ||
      cache.numBands !== numPerceptualBands ||
      cache.sampleRate !== sampleRate
    ) {
      perceptualBandCache.current = {
        scale: perceptualScale,
        numBands: numPerceptualBands,
        sampleRate,
        boundaries: generatePerceptualBands(perceptualScale, numPerceptualBands, 20, sampleRate / 2),
      };
    }
    const bands = perceptualBandCache.current!.boundaries;
    const perceptualBands = mapToPerceptualBands(
      arr,
      sampleRate,
      perceptualScale,
      numPerceptualBands,
      bands,
    );

    const rawEnergy = (bass + mid + treble) / 3;
    // Blend live energy with analyzed energy curve for stable, section-aware intensity.
    // 60% live keeps transients; 40% analysis anchors to track structure.
    const energy =
      analyzedEnergy > 0
        ? rawEnergy * 0.6 + analyzedEnergy * 0.4
        : rawEnergy;

    data.current = {
      bass,
      mid,
      treble,
      overall,
      beat: isBeat,
      peak: peakHold.current,
      energy,
      drumType,
      nextBeatIn: nextBeatInRef.current,
      beatPhase: phaseInfo ? smoothedPhase.current : undefined,
      analyzedEnergy,
      perceptualBands,
      perceptualScale,
    };
  });
  return data;
}
