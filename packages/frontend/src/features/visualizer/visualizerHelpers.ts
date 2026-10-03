/**
 * Pure, side-effect-free helpers for the Visualizer stage.
 *
 * Extracted from Visualizer.tsx (was 2361 lines) — no logic changed.
 * Everything here is module-private to the visualizer feature.
 */
import type { AudioAnalysisData } from "./types";
import type { VisualPreset } from "./visualPreset";
import {
  isUnnamedFile,
  stripAudioExtension,
  stripHashPrefixes,
  unnamedFileLabel,
} from "../../state/audioNaming";

/** A library entry — `filename` is the bare name; the playable/analyzable
 *  reference is `relative_path` (subfolder-aware). Most of the library lives
 *  in subfolders, so bare names 404 on /api/audio/file/*. */
export interface LibraryFile {
  filename: string;
  path?: string;
  relative_path?: string;
  folder?: string;
}

/** Canonical backend reference for a library file (POSIX, subfolder-aware). */
export function audioRefForFile(f: LibraryFile): string {
  return (f.relative_path || f.path || f.filename).replace(/\\/g, "/");
}

/** Strip any folder prefix: "Suno-V6-Mini/track.m4a" → "track.m4a". */
export function baseNameOfRef(ref: string): string {
  const base = ref.split("/").pop() ?? ref;
  return base || ref;
}

/**
 * Clean a backend reference down to a bare track name: no folder, no stacked
 * hash prefixes, no audio extension (and `.lrc`, for lyric sidecars).
 *
 * Delegates to `state/audioNaming.ts` so track names derived for storyboards,
 * CSV lookups and shader labels cannot drift from the names the selectors show.
 */
export function cleanTrackName(ref: string): string {
  const base = baseNameOfRef(ref);
  return stripAudioExtension(stripHashPrefixes(base)).replace(/\.lrc$/i, "");
}

/** Human display name: no folders, hash prefixes, or extension. */
export function displayNameForFile(f: LibraryFile): string {
  return baseNameOfRef(audioRefForFile(f))
    .replace(/^([0-9a-f]{8}_)+/i, "")
    .replace(/\.(mp3|wav|flac|ogg|m4a)$/i, "");
}

/**
 * Dropdown label for a library file: the shared display name, plus a `[hash]`
 * suffix only when another track in the same list would render identically.
 *
 * Entries from `state/audioNaming.ts` already carry a centrally-computed
 * `optionLabel`, and that is what we prefer — the disambiguation decision is
 * then made once against the full library, so the suffix cannot appear in one
 * dropdown and be missing from another.
 */
export function optionLabelForFile(f: LibraryFile & { optionLabel?: string }): string {
  if (f.optionLabel) return f.optionLabel;
  if (isUnnamedFile(f)) return unnamedFileLabel(f);
  return displayNameForFile(f);
}

/** Encode a backend file reference segment-wise (keeps folder slashes intact). */
export function encodeAudioRef(ref: string): string {
  return ref
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/** How long a beat stays lit for throttled (React-state) consumers.
 *  Per-frame producers raise `beat` for a single 16 ms frame (shader/2D loop)
 *  while state mirrors update at ~10 Hz — without latching, the footer beat
 *  dot and lyric beat pulses miss most beats and fire up to 100 ms late.
 *  Kept at 80 ms (not longer): measured beat grids run dense double-time
 *  (~190–270 ms spacing), so a longer latch saturates the dot instead of
 *  flashing per beat. */
export const BEAT_LATCH_MS = 80;

/** Clamp a number into [min, max]; falls back to `fallback` when not finite. */
export function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 2D canvas modes in select order; keyboard keys 1–9 jump to the first nine. */
export const CANVAS_2D_MODES = [
  "bars",
  "mirrored-bars",
  "segmented-led-bars",
  "stereo-split-bars",
  "stacked-frequency-bands",
  "dot-peak-matrix",
  "waveform",
  "radial",
  "spectrogram",
  "lissajous",
  "constellation",
  "particles",
  "aurora",
] as const;
export type Canvas2DMode = (typeof CANVAS_2D_MODES)[number];

/** Display labels for the 2D modes (mirrors the mode select options). */
export const CANVAS_2D_MODE_LABELS: Record<Canvas2DMode, string> = {
  bars: "Bars",
  "mirrored-bars": "Mirrored Bars",
  "segmented-led-bars": "Segmented LED Bars",
  "stereo-split-bars": "Stereo Split Bars",
  "stacked-frequency-bands": "Stacked Frequency Bands",
  "dot-peak-matrix": "Dot Peak Matrix",
  waveform: "Waveform",
  radial: "Radial",
  spectrogram: "Spectrogram",
  lissajous: "Lissajous",
  constellation: "Constellation",
  particles: "Particles",
  aurora: "Aurora",
};

/**
 * Short labels for the compact "More" menu picker.
 *
 * The compact menu has room for ~12 characters, so it cannot reuse
 * `CANVAS_2D_MODE_LABELS` ("Segmented LED Bars", "Stacked Frequency Bands").
 * These were previously inline in the <select> itself, which is how the two
 * pickers drifted apart — and why `aurora` and the invalid
 * `stereo-split-bands` value existed only in the hidden test-panel copy.
 *
 * `Record<Canvas2DMode, string>` makes a missing entry a type error rather than
 * a blank <option>, and `shortModeLabel()` gives a safe fallback.
 */
export const CANVAS_2D_MODE_SHORT_LABELS: Record<Canvas2DMode, string> = {
  bars: "Bars",
  "mirrored-bars": "Mirrored",
  "segmented-led-bars": "LED Bars",
  "stereo-split-bars": "Stereo Split",
  "stacked-frequency-bands": "Stacked Bands",
  "dot-peak-matrix": "Dot Matrix",
  waveform: "Wave",
  radial: "Radial",
  spectrogram: "Spectrogram",
  lissajous: "Lissajous",
  constellation: "Constellation",
  particles: "Particles",
  aurora: "Aurora",
};

/** Short label for a mode, falling back to the full label. */
export function shortModeLabel(mode: Canvas2DMode): string {
  return CANVAS_2D_MODE_SHORT_LABELS[mode] ?? CANVAS_2D_MODE_LABELS[mode] ?? mode;
}

/** Stage mode cycle order for the ←/→ keyboard shortcuts. */
export const VIZ_MODE_ORDER = ["3d", "shader", "2d"] as const;

/** Narrow an unknown backend payload to AudioAnalysisData; null when unusable. */
export function toAnalysisData(raw: unknown): AudioAnalysisData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.tempo_bpm !== "number" || typeof r.duration_seconds !== "number") return null;
  if (!Array.isArray(r.beat_times) || !Array.isArray(r.energy_curve)) return null;

  const spectralCentroid = Array.isArray(r.spectral_centroid)
    ? r.spectral_centroid.filter((v): v is number => typeof v === "number")
    : undefined;
  const spectralRolloff = Array.isArray(r.spectral_rolloff)
    ? r.spectral_rolloff.filter((v): v is number => typeof v === "number")
    : undefined;
  const spectralBandwidth = Array.isArray(r.spectral_bandwidth)
    ? r.spectral_bandwidth.filter((v): v is number => typeof v === "number")
    : undefined;
  const zeroCrossingRate = Array.isArray(r.zero_crossing_rate)
    ? r.zero_crossing_rate.filter((v): v is number => typeof v === "number")
    : undefined;

  return {
    tempo_bpm: r.tempo_bpm,
    beat_count: typeof r.beat_count === "number" ? r.beat_count : r.beat_times.length,
    beat_times: r.beat_times,
    onset_times: Array.isArray(r.onset_times) ? r.onset_times : [],
    energy_curve: r.energy_curve,
    amplitude_envelope: Array.isArray(r.amplitude_envelope) ? r.amplitude_envelope : [],
    sections: Array.isArray(r.sections) ? r.sections : [],
    confidence: typeof r.confidence === "number" ? r.confidence : 0,
    duration_seconds: r.duration_seconds,
    spectral_centroid: spectralCentroid,
    spectral_rolloff: spectralRolloff,
    spectral_bandwidth: spectralBandwidth,
    zero_crossing_rate: zeroCrossingRate,
    timing_contract: r.timing_contract as AudioAnalysisData["timing_contract"],
    suggested_visualization:
      typeof r.suggested_visualization === "string" ? r.suggested_visualization : undefined,
    suggested_visualization_confidence:
      typeof r.suggested_visualization_confidence === "number"
        ? r.suggested_visualization_confidence
        : undefined,
    suggested_visualization_candidates: Array.isArray(r.suggested_visualization_candidates)
      ? r.suggested_visualization_candidates
      : undefined,
    suggested_kinetic_preset:
      typeof r.suggested_kinetic_preset === "string" ? r.suggested_kinetic_preset : undefined,
    suggested_kinetic_preset_confidence:
      typeof r.suggested_kinetic_preset_confidence === "number"
        ? r.suggested_kinetic_preset_confidence
        : undefined,
    suggested_theme_seed:
      typeof r.suggested_theme_seed === "string" ? r.suggested_theme_seed : undefined,
    suggested_theme_seed_confidence:
      typeof r.suggested_theme_seed_confidence === "number"
        ? r.suggested_theme_seed_confidence
        : undefined,
  };
}

/** Narrow an unknown backend payload to a VisualPreset; null when unusable. */
export function toVisualPreset(raw: unknown): VisualPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string") return null;
  return raw as VisualPreset;
}

/** Map backend-suggested visualization style → preset id for fallback auto-apply. */
export function visualizationStyleToPresetId(style: string): string | null {
  const map: Record<string, string> = {
    geometric: "balanced",
    pulse: "pop",
    particles: "pop",
    aurora: "indie",
    synthwave: "synthwave",
    cosmic: "cinematic",
    inferno: "trapMetal",
    waveform: "rb",
    storm: "grime",
  };
  return map[style] || null;
}
