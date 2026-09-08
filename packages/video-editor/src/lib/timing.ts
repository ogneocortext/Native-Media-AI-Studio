/**
 * Local timing primitives for StillIRise V7.
 * Simplified version of shared/timing.ts for Remotion rendering.
 */

// ─── Types ───

export type SectionType =
  | "intro"
  | "verse"
  | "chorus"
  | "bridge"
  | "breakdown"
  | "build_up"
  | "drop"
  | "outro"
  | "instrumental";

export type DrumType = "kick" | "snare" | "hat" | "clap" | "tom" | "rim" | null;

export interface SectionEvent {
  type: SectionType;
  start: number;
  end: number;
  energy: number;
  bpm?: number;
  palette?: {
    primary?: string;
    secondary?: string;
    glow?: string;
    background?: string;
  };
}

export interface BeatEvent {
  time: number;
  drumType: DrumType;
  energy: number;
  isDownbeat?: boolean;
  bpm?: number;
}

export interface EnergyCurvePoint {
  time: number;
  value: number;
}

export interface TimingContract {
  filename: string;
  duration: number;
  bpm: number;
  bpmConfidence: number;
  beats: BeatEvent[];
  sections: SectionEvent[];
  energyCurve: EnergyCurvePoint[];
  amplitudeEnvelope: number[];
}

// ─── Section helpers ───

export function getSectionAtTime(sections: SectionEvent[], time: number): SectionEvent | null {
  if (!sections.length) return null;
  let lo = 0;
  let hi = sections.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (sections[mid].start <= time) lo = mid;
    else hi = mid - 1;
  }
  const candidate = sections[lo];
  return time >= candidate.start && time < candidate.end ? candidate : null;
}

export function getBeatNearTime(beats: BeatEvent[], time: number, windowSec = 0.1): { beat: BeatEvent; distance: number } | null {
  if (!beats.length) return null;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (beats[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  let best = { beat: beats[lo] as BeatEvent, distance: Math.abs(beats[lo].time - time) };
  for (let i = Math.max(0, lo - 1); i <= Math.min(beats.length - 1, lo + 1); i++) {
    const d = Math.abs(beats[i].time - time);
    if (d < best.distance) best = { beat: beats[i], distance: d };
  }
  return best.distance <= windowSec ? best : null;
}

export function getNextBeatIn(beats: BeatEvent[], time: number): number {
  if (!beats.length) return 0;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (beats[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  const next = beats[lo];
  return next && next.time >= time ? next.time - time : 0;
}

export function interpolateEnergy(contract: TimingContract, time: number): number {
  const { energyCurve, duration } = contract;
  if (!energyCurve.length) return 0.5;
  const t = clamp(time, 0, duration);
  // Non-uniform support: when points carry explicit times, binary-search them;
  // otherwise fall back to the uniform-distribution assumption.
  const first = energyCurve[0];
  const stamped = typeof first === "object" && first !== null && "time" in first;
  if (stamped) {
    const pts = energyCurve as EnergyCurvePoint[];
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (pts[mid].time <= t) lo = mid + 1;
      else hi = mid;
    }
    const b = pts[lo];
    const a = pts[Math.max(0, lo - 1)] ?? b;
    if (b.time === a.time) return a.value;
    const frac = clamp((t - a.time) / (b.time - a.time), 0, 1);
    return lerp(a.value, b.value, frac);
  }
  const pos = (t / duration) * (energyCurve.length - 1);
  const idx = Math.floor(pos);
  const frac = pos - idx;
  const a = energyCurve[Math.min(idx, energyCurve.length - 1)]?.value ?? 0;
  const b = energyCurve[Math.min(idx + 1, energyCurve.length - 1)]?.value ?? a;
  return a + (b - a) * frac;
}

// ─── Remotion helpers ───

export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

export function framesToSeconds(frames: number, fps: number): number {
  return frames / fps;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  return ((value - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
}
