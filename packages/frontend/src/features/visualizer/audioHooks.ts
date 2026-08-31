import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { AudioData, AudioAnalysisData } from "./types";

// Demo fallback — synthetic audio for when no track is playing
export function useDemoAudio(enabled: boolean, bpm: number) {
  const data = useRef<AudioData>({ bass: 0, mid: 0, treble: 0, overall: 0, beat: false, peak: 0, energy: 0 });
  useFrame((state) => {
    if (!enabled) return;
    const t = state.clock.elapsedTime;
    const f = bpm / 120;
    const beatPhase = (t * f * 2) % 1;
    const isBeat = beatPhase < 0.08;
    const bass = (Math.sin(t * f * 2) + 1) / 2;
    const mid = (Math.sin(t * f * 3.5) + 1) / 2;
    const treble = (Math.sin(t * f * 5) + 1) / 2;
    data.current = {
      bass, mid, treble,
      overall: bass * 0.4 + mid * 0.35 + treble * 0.25,
      beat: isBeat,
      peak: Math.max(bass, mid, treble),
      energy: (bass + mid + treble) / 3,
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
  audioElapsed?: number,
) {
  const data = useRef<AudioData>({ bass: 0, mid: 0, treble: 0, overall: 0, beat: false, peak: 0, energy: 0 });
  const freqArray = useRef<Uint8Array | null>(null);
  const lastBass = useRef(0);
  const beatCooldown = useRef(0);
  const lastBeatIdx = useRef(-1);
  // Separate smoothing for attack (fast) and release (slow) for tighter sync
  const smoothedBass = useRef(0);
  const smoothedMid = useRef(0);
  const smoothedTreble = useRef(0);
  const peakHold = useRef(0);
  const peakDecay = useRef(0);
  // Store elapsed in a ref so useFrame always reads the latest value
  const elapsedRef = useRef(audioElapsed ?? 0);
  elapsedRef.current = audioElapsed ?? 0;

  useFrame(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    if (isPaused || !isPlaying) {
      if (data.current.bass !== 0 || data.current.mid !== 0 || data.current.treble !== 0) {
        data.current = { bass: 0, mid: 0, treble: 0, overall: 0, beat: false, peak: 0, energy: 0 };
        smoothedBass.current = 0;
        smoothedMid.current = 0;
        smoothedTreble.current = 0;
        peakHold.current = 0;
      }
      return;
    }

    // Ensure AudioContext is running
    const ctx = analyser.context as AudioContext;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
      return;
    }

    if (!freqArray.current || freqArray.current.length !== analyser.frequencyBinCount) {
      freqArray.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array;
    }
    analyser.getByteFrequencyData(freqArray.current as Uint8Array<ArrayBuffer>);
    const arr = freqArray.current;

    // Frequency-based bin mapping using actual sample rate
    const sampleRate = ctx.sampleRate;
    const binSize = sampleRate / (arr.length * 2);
    const bassMaxFreq = 250;
    const midMaxFreq = 4000;
    const bassBins = Math.max(1, Math.floor(bassMaxFreq / binSize));
    const midBins = Math.max(bassBins + 1, Math.floor(midMaxFreq / binSize));

    const rawBass = arr.slice(0, bassBins).reduce((a, b) => a + b, 0) / (bassBins * 255 || 1);
    const rawMid = arr.slice(bassBins, midBins).reduce((a, b) => a + b, 0) / ((midBins - bassBins) * 255 || 1);
    const rawTreble = arr.slice(midBins).reduce((a, b) => a + b, 0) / ((arr.length - midBins) * 255 || 1);

    // Attack/release smoothing: fast attack (0.6), slow release (0.15) for punchy response
    const attack = 0.6;
    const release = 0.15;
    const bassDiff = rawBass - smoothedBass.current;
    smoothedBass.current += bassDiff * (bassDiff > 0 ? attack : release);
    const midDiff = rawMid - smoothedMid.current;
    smoothedMid.current += midDiff * (midDiff > 0 ? attack : release);
    const trebleDiff = rawTreble - smoothedTreble.current;
    smoothedTreble.current += trebleDiff * (trebleDiff > 0 ? attack : release);

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
    const elapsed = elapsedRef.current;
    if (analysisData && analysisData.beat_times.length > 0 && elapsed > 0) {
      // Wider window (120ms) for more reliable beat detection
      const beatIdx = analysisData.beat_times.findIndex((bt, i) => {
        if (i <= lastBeatIdx.current) return false;
        return Math.abs(bt - elapsed) < 0.12;
      });
      if (beatIdx >= 0) {
        isBeat = true;
        lastBeatIdx.current = beatIdx;
      }
      // Reset index if user seeks backwards
      if (analysisData.beat_times.length > 0 && elapsed < analysisData.beat_times[Math.max(0, lastBeatIdx.current)]) {
        lastBeatIdx.current = -1;
      }
    } else {
      // Adaptive bass spike detection with dynamic threshold
      const avgEnergy = (bass + mid + treble) / 3;
      const threshold = 0.4 + avgEnergy * 0.3; // Adapt to track loudness
      beatCooldown.current = Math.max(0, beatCooldown.current - 1);
      isBeat = bass > threshold && bass > lastBass.current * 1.1 && beatCooldown.current === 0;
      if (isBeat) beatCooldown.current = 6;
    }
    lastBass.current = bass;

    data.current = {
      bass, mid, treble, overall, beat: isBeat,
      peak: peakHold.current,
      energy: (bass + mid + treble) / 3,
    };
  });
  return data;
}
