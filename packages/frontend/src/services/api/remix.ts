/**
 * Client for the stem remixer (`/api/audio/remix/*`).
 *
 * Shape mirrors the backend request/response models exactly, so a field rename
 * on either side shows up as a type error rather than as `undefined` at runtime.
 *
 * `remixFileUrl` is separate from the fetch helpers on purpose: playback goes
 * through an `<audio src>`, which the browser resolves same-origin, so it must
 * not be fetched through `fetchWithTimeout`.
 */
import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

export const STEM_NAMES = ["vocals", "drums", "bass", "other"] as const;
export type StemName = (typeof STEM_NAMES)[number];

export interface RemixSource {
  track: string;
  model: string;
  stems: Record<StemName, boolean>;
}

export interface RemixProbe {
  track: string;
  bpm: number;
  duration_sec: number;
  first_audible_sec: number;
  /** Advisory only. Detection is unreliable on this material - see key_confident. */
  key_advisory: string;
  key_correlation: number;
  chroma_flatness: number;
  key_confident: boolean;
  beat_count: number;
  analysed_stem: StemName;
}

export interface RemixLayerSpec {
  track: string;
  stem: StemName;
  gain_db: number;
  key_shift_semitones: number;
  source_start_bar: number;
}

export interface RemixSlotSpec {
  layers: RemixLayerSpec[];
  bars: number;
  crossfade_bars: number;
}

export interface RemixRecipeSpec {
  name: string;
  target_bpm: number;
  slots: RemixSlotSpec[];
  beats_per_bar: number;
  key?: string | null;
  overwrite?: boolean;
}

export interface RemixPreview {
  duration_sec: number;
  total_bars: number;
  bar_seconds: number;
  sample_rate: number;
  stretch_ratios: Record<string, number>;
  layers: {
    track: string;
    stem: StemName;
    source_bpm: number;
    measured_rms_db: number;
    stretch_ratio: number;
    source_start_bar: number;
  }[];
  warnings: string[];
}

export interface RemixBuildResult {
  name: string;
  directory: string;
  stems: Record<StemName, string>;
  duration_sec: number;
  manifest: Record<string, unknown>;
  warnings: string[];
}

export interface RemixSummary {
  name: string;
  duration_sec: number | null;
  target_bpm: number | null;
  source_tracks: string[];
  stems: string[];
  has_enhanced: boolean;
}

export interface RemixEnhanceResult {
  name: string;
  output_dir: string;
  wav_path: string | null;
  mp3_path: string | null;
  duration_sec: number;
  steps: { step: number; name: string }[];
  error: string | null;
}

/** A remix reconstructed from its manifest: enough to reopen and rearrange. */
export type RemixRecipeRoundTrip = RemixRecipeSpec;

/**
 * One mashup that consumed a given track.
 *
 * `role` is `primary` when the track was `source_tracks[0]`, `contributor`
 * otherwise. A mashup built from two tracks is genuinely lineage for both, so it
 * is listed under each - hiding the contributor case would make a shared mashup
 * look like it belonged to whichever track happened to be listed first.
 */
export interface RemixLineageEntry extends RemixSummary {
  role: "primary" | "contributor";
  /** null when the manifest cannot round-trip; see the backend note. */
  recipe: RemixRecipeRoundTrip | null;
}

export interface RemixTrackLineage {
  track: string;
  remixes: RemixLineageEntry[];
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: fallback }));
    throw new Error(body.detail || fallback);
  }
  return res.json() as Promise<T>;
}

export async function getRemixSources(): Promise<RemixSource[]> {
  const res = await fetchWithTimeout(`${getApiBase()}/api/audio/remix/sources`, {
    timeout: 15000,
  });
  const body = await unwrap<{ sources: RemixSource[] }>(res, "Failed to list remix sources");
  return body.sources;
}

export async function probeRemixTrack(track: string): Promise<RemixProbe> {
  const res = await fetchWithTimeout(
    `${getApiBase()}/api/audio/remix/probe/${encodeURIComponent(track)}`,
    { timeout: 120000 },
  );
  return unwrap<RemixProbe>(res, `Failed to probe ${track}`);
}

export async function previewRemix(recipe: RemixRecipeSpec): Promise<RemixPreview> {
  const res = await fetchWithTimeout(`${getApiBase()}/api/audio/remix/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(recipe),
    // Preview loads and time-stretches every source to measure levels, so it is
    // not free - but it writes nothing and skips the crossfade mixing.
    timeout: 180000,
  });
  return unwrap<RemixPreview>(res, "Remix preview failed");
}

export async function buildRemix(recipe: RemixRecipeSpec): Promise<RemixBuildResult> {
  const res = await fetchWithTimeout(`${getApiBase()}/api/audio/remix/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(recipe),
    timeout: 300000,
  });
  return unwrap<RemixBuildResult>(res, "Remix render failed");
}

export async function listRemixes(): Promise<RemixSummary[]> {
  const res = await fetchWithTimeout(`${getApiBase()}/api/audio/remix/list`, {
    timeout: 15000,
  });
  const body = await unwrap<{ remixes: RemixSummary[] }>(res, "Failed to list remixes");
  return body.remixes;
}

/**
 * Every rendered mashup that consumed `track`, each with its recipe.
 *
 * `track` is the library filename as the audio library reports it, which is what
 * the stem directories are named from - so this joins on the same key the stems
 * already use rather than re-deriving a match.
 */
export async function getTrackLineage(track: string): Promise<RemixTrackLineage> {
  const res = await fetchWithTimeout(
    `${getApiBase()}/api/audio/remix/by-track/${encodeURIComponent(track)}`,
    { timeout: 15000 },
  );
  return unwrap<RemixTrackLineage>(res, `Failed to load lineage for ${track}`);
}

export async function enhanceRemix(
  name: string,
  options: { vocal_balance_db?: number; pre_highpass_hz?: number } = {},
): Promise<RemixEnhanceResult> {
  const res = await fetchWithTimeout(
    `${getApiBase()}/api/audio/remix/${encodeURIComponent(name)}/enhance`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
      timeout: 600000,
    },
  );
  return unwrap<RemixEnhanceResult>(res, `Failed to master remix ${name}`);
}

/** URL for an `<audio src>`; resolves same-origin, so no fetch wrapper. */
export function remixFileUrl(name: string, which: StemName | "master"): string {
  return `${getApiBase()}/api/audio/remix/${encodeURIComponent(name)}/file/${which}`;
}