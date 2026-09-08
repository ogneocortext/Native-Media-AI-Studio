/**
 * Shared timing primitives for Native Media AI Studio.
 *
 * This module is the single source of truth for beat/section/energy timing
 * contracts used by:
 *   - Live frontend visualizer (`packages/frontend`)
 *   - Remotion video renderer (`packages/video-editor`)
 *   - AI agents generating presets / Remotion compositions
 *
 * All time-based lookups (beats, sections, energy curves) must go through
 * the helpers below — never ad-hoc `find()` / `filter()` scattered across
 * components.
 */

// ─── Raw analysis output (backend / librosa / sonara) ───────────────────────

export interface WaveformFeatures {
  sample_rate: number;
  duration_seconds: number;
  amplitude_envelope: number[];
  rms_energy: number[];
  zero_crossing_rate: number[];
  centroid?: number[];
  spectral_rolloff?: number[];
  spectral_bandwidth?: number[];
}

export interface BeatFeatures {
  tempo_bpm: number;
  beat_frames: number[];
  beat_times: number[];
  onset_frames: number[];
  onset_times: number[];
  confidence: number;
}

export interface AudioAnalysisResult {
  job_id: string;
  audio_file: string;
  analysis_timestamp: string;
  waveform: WaveformFeatures;
  beats: BeatFeatures;
  metadata: Record<string, unknown>;
}

// ─── Timing Contract (shared between backend, frontend, Remotion, AI agents) ─

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
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
  /** Normalized energy 0..1 */
  energy: number;
  /** BPM estimate for this section (optional) */
  bpm?: number;
  /** Suggested palette override for this section */
  palette?: {
    primary?: string;
    secondary?: string;
    glow?: string;
    background?: string;
  };
  /** Suggested camera behavior */
  camera?: {
    mode: "orbit" | "fixed" | "flythrough" | "handheld";
    speed: number;
    scale: number;
  };
}

export interface BeatEvent {
  /** Time in seconds */
  time: number;
  /** Drum classification when available */
  drumType: DrumType;
  /** Normalized energy at onset 0..1 */
  energy: number;
  /** True when this is a strong downbeat / start of a phrase */
  isDownbeat?: boolean;
  /** Beats-per-minute estimate at this instant */
  bpm?: number;
}

export interface EnergyCurvePoint {
  time: number;
  value: number;
}

export interface LyricTiming {
  start: number;
  end: number;
  text: string;
  /** Optional phrase grouping for kinetic typography */
  phraseStart?: boolean;
  words?: Array<{
    word: string;
    start: number;
    end: number;
  }>;
}

export interface TimingContract {
  /** Source audio file identifier */
  filename: string;
  /** Total duration in seconds */
  duration: number;
  /** Global BPM estimate (may be overridden per-section) */
  bpm: number;
  /** BPM confidence 0..1 */
  bpmConfidence: number;
  /** Ordered beat events */
  beats: BeatEvent[];
  /** Ordered section boundaries (non-overlapping, cover [0, duration]) */
  sections: SectionEvent[];
  /** Sub-sampled energy curve for fast lookups */
  energyCurve: EnergyCurvePoint[];
  /** Amplitude envelope for waveform rendering */
  amplitudeEnvelope: number[];
  /** Optional lyric timing */
  lyrics?: LyricTiming[];
  /** Suggested visualization style for this track */
  suggestedVisualization?: string;
  /** Suggested kinetic preset */
  suggestedKineticPreset?: string;
  /** Suggested color theme seed */
  suggestedThemeSeed?: string;
}

// ─── Section helpers (pure, framework-agnostic) ─────────────────────────────

export function getSectionAtTime(sections: SectionEvent[], time: number): SectionEvent | null {
  if (!sections.length) return null;
  // Binary search for the last section start <= time
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
  const t = Math.max(0, Math.min(duration, time));
  const pos = (t / duration) * (energyCurve.length - 1);
  const idx = Math.floor(pos);
  const frac = pos - idx;
  const a = energyCurve[Math.min(idx, energyCurve.length - 1)]?.value ?? 0;
  const b = energyCurve[Math.min(idx + 1, energyCurve.length - 1)]?.value ?? a;
  return a + (b - a) * frac;
}

export function isOnBeat(contract: TimingContract, time: number, windowSec = 0.1): boolean {
  return getBeatNearTime(contract.beats, time, windowSec) !== null;
}

export function getDownbeatWindow(beats: BeatEvent[], time: number, windowSec = 0.15): BeatEvent | null {
  const near = getBeatNearTime(beats, time, windowSec);
  if (!near) return null;
  return near.beat.isDownbeat ? near.beat : null;
}

// ─── Array variants (for legacy flat number[] beat_times) ───────────────────

export function getBeatNearTimeFromArray(beats: number[], time: number, windowSec = 0.1): { beat: number; index: number; distance: number } | null {
  if (!beats.length) return null;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (beats[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  let best = { beat: beats[lo], index: lo, distance: Math.abs(beats[lo] - time) };
  for (let i = Math.max(0, lo - 1); i <= Math.min(beats.length - 1, lo + 1); i++) {
    const d = Math.abs(beats[i] - time);
    if (d < best.distance) best = { beat: beats[i], index: i, distance: d };
  }
  return best.distance <= windowSec ? best : null;
}

export function getNextBeatInFromArray(beats: number[], time: number): number {
  if (!beats.length) return 0;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (beats[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  const next = beats[lo];
  return next && next >= time ? next - time : 0;
}

// ─── Remotion helpers ───────────────────────────────────────────────────────

/**
 * Convert seconds to Remotion frames at a given FPS.
 */
export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/**
 * Convert Remotion frames to seconds at a given FPS.
 */
export function framesToSeconds(frames: number, fps: number): number {
  return frames / fps;
}

/**
 * Linear interpolation between two values.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Clamp a value into [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Map a time value from one range to another.
 */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  return ((value - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
}

// ─── Preset timing hints (for AI-generated Remotion graphics) ───────────────

export interface TimingHint {
  /** When this hint activates (seconds from start) */
  at: number;
  /** Duration of the hint effect (seconds) */
  duration: number;
  /** What should happen */
  event: "beat_pulse" | "section_change" | "drop" | "breakdown" | "build_up" | "lyric_phrase" | "camera_move" | "color_shift";
  /** Intensity 0..1 */
  intensity?: number;
  /** Target value / param override */
  target?: number | string | Record<string, unknown>;
}

export function generateTimingHints(contract: TimingContract): TimingHint[] {
  const hints: TimingHint[] = [];

  // Beat pulses — throttle to ~4Hz so AI renderers don't keyframe every 16th note
  const beatStep = Math.max(1, Math.floor(contract.beats.length / 200));
  for (let i = 0; i < contract.beats.length; i += beatStep) {
    const b = contract.beats[i];
    hints.push({
      at: b.time,
      duration: 0.1,
      event: b.isDownbeat ? "beat_pulse" : "beat_pulse",
      intensity: b.energy,
      target: b.drumType ?? "beat",
    });
  }

  // Section changes
  for (const s of contract.sections) {
    hints.push({
      at: s.start,
      duration: 2.0,
      event: "section_change",
      intensity: s.energy,
      target: {
        type: s.type,
        palette: s.palette,
        camera: s.camera,
      },
    });
    if (s.type === "drop") {
      hints.push({
        at: s.start,
        duration: 1.5,
        event: "drop",
        intensity: 1.0,
      });
    }
    if (s.type === "breakdown") {
      hints.push({
        at: s.start,
        duration: 3.0,
        event: "breakdown",
        intensity: 0.3,
      });
    }
    if (s.type === "build_up") {
      hints.push({
        at: s.start,
        duration: 4.0,
        event: "build_up",
        intensity: 0.6,
      });
    }
  }

  // Lyric phrases
  if (contract.lyrics?.length) {
    for (const l of contract.lyrics) {
      if (l.phraseStart) {
        hints.push({
          at: l.start,
          duration: l.end - l.start,
          event: "lyric_phrase",
          intensity: 0.7,
          target: { text: l.text },
        });
      }
    }
  }

  return hints.sort((a, b) => a.at - b.at);
}
