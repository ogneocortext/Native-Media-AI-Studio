import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { AudioData } from "./types";

// Demo fallback — clearly labeled, not silent mock
export function useDemoAudio(enabled: boolean, bpm: number) {
  const data = useRef<AudioData>({ bass: 0, mid: 0, treble: 0, overall: 0, beat: false });
  useFrame((state) => {
    if (!enabled) return;
    const t = state.clock.elapsedTime;
    const f = bpm / 120;
    const beatPhase = (t * f * 2) % 1;
    const isBeat = beatPhase < 0.1;
    data.current = {
      bass: (Math.sin(t * f * 2) + 1) / 2,
      mid: (Math.sin(t * f * 3.5) + 1) / 2,
      treble: (Math.sin(t * f * 5) + 1) / 2,
      overall: (Math.sin(t * f * 2) * 0.5 + 0.5),
      beat: isBeat,
    };
  });
  return data;
}

// Real audio — reads from AnalyserNode when audio is playing
export function useRealAudio(analyserRef: React.MutableRefObject<AnalyserNode | null>, isPlaying: boolean, isPaused: boolean) {
  const data = useRef<AudioData>({ bass: 0, mid: 0, treble: 0, overall: 0, beat: false });
  const freqArray = useRef<Uint8Array | null>(null);
  const lastBass = useRef(0);
  const beatThreshold = 0.7;
  const beatCooldown = useRef(0);

  useFrame(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    // Freeze visualization when paused — return zeros so mesh goes still
    if (isPaused || !isPlaying) {
      if (data.current.bass !== 0 || data.current.mid !== 0 || data.current.treble !== 0) {
        data.current = { bass: 0, mid: 0, treble: 0, overall: 0, beat: false };
      }
      return;
    }
    if (!freqArray.current || freqArray.current.length !== analyser.frequencyBinCount) {
      freqArray.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array;
    }
    analyser.getByteFrequencyData(freqArray.current as Uint8Array<ArrayBuffer>);
    const arr = freqArray.current;
    // Bin mapping: 0-~10% = bass (20-250Hz), 10-40% = mid, 40-100% = treble
    const bassBins = Math.floor(arr.length * 0.08);
    const midBins = Math.floor(arr.length * 0.35);
    const bass = arr.slice(0, bassBins).reduce((a, b) => a + b, 0) / (bassBins * 255 || 1);
    const mid = arr.slice(bassBins, midBins).reduce((a, b) => a + b, 0) / ((midBins - bassBins) * 255 || 1);
    const treble = arr.slice(midBins).reduce((a, b) => a + b, 0) / ((arr.length - midBins) * 255 || 1);
    const overall = (bass * 0.4 + mid * 0.35 + treble * 0.25);

    // Simple beat detection: bass spike above threshold with cooldown
    beatCooldown.current = Math.max(0, beatCooldown.current - 1);
    const isBeat = bass > beatThreshold && bass > lastBass.current * 1.2 && beatCooldown.current === 0;
    if (isBeat) beatCooldown.current = 10;
    lastBass.current = bass;

    data.current = { bass, mid, treble, overall, beat: isBeat };
  });
  return data;
}
