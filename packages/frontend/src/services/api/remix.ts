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
  /** Cached probe measurements, present once the track has been probed. */
  bpm?: number | null;
  duration_sec?: number | null;
  first_audible_sec?: number | null;
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
  /** Same facts as `warnings`, structured for agents:
   * {code, layer_ref, field, measured_rms_db, suggestion}. */
  warnings_detail?: {
    code: string;
    layer_ref: string;
    field: string;
    measured_rms_db: number;
    suggestion: string;
  }[];
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

/**
 * Acknowledgement for a long-running remix operation.
 *
 * `/build` and `/enhance` return this immediately and run the
 * work in a background job; the full payload arrives via
 * `getRemixJob` once `state` is `done`.
 */
export interface RemixJobAccepted {
  job_id: string;
  kind: string;
  label: string;
  state: string;
}

export interface RemixJobStatus {
  job_id: string;
  kind: "build" | "enhance";
  label: string;
  state: "queued" | "running" | "done" | "failed";
  /** Set when the backend capped a wedged job and reported it failed. */
  timed_out?: boolean;
  progress?: string | null;
  /** The build/enhance payload, present once `state` is `done`. */
  result?: RemixBuildResult | RemixEnhanceResult;
  error?: string | null;
  elapsed_sec: number;
  started_at: number;
  finished_at: number | null;
}
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

/**
 * Start a build without waiting for it.
 *
 * The backend validates the recipe and checks the source stems
 * synchronously (so a bad recipe or a missing stem still throws
 * here), then renders in a background job. Poll `getRemixJob`
 * for the result, or use `buildRemix` to await it.
 */
export async function startBuildRemix(
  recipe: RemixRecipeSpec,
): Promise<RemixJobAccepted> {
  const res = await fetchWithTimeout(`${getApiBase()}/api/audio/remix/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(recipe),
    // Validation and path checks only - the render itself is a
    // background job, so this returns as soon as the recipe is
    // accepted.
    timeout: 15000,
  });
  return unwrap<RemixJobAccepted>(res, "Remix render failed");
}

/**
 * Start a master without waiting for it.
 *
 * The backend checks the remix and its stems synchronously, then
 * runs the chain in a background job. Poll `getRemixJob` for the
 * result, or use `enhanceRemix` to await it.
 */
export async function startEnhanceRemix(
  name: string,
  options: {
    vocal_balance_db?: number;
    pre_highpass_hz?: number;
    target_peak_dbfs?: number;
    master_ceiling_dbfs?: number;
  } = {},
): Promise<RemixJobAccepted> {
  const res = await fetchWithTimeout(
    `${getApiBase()}/api/audio/remix/${encodeURIComponent(name)}/enhance`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
      timeout: 15000,
    },
  );
  return unwrap<RemixJobAccepted>(res, `Failed to master remix ${name}`);
}

/** Status of one build/enhance job, including its result. */
export async function getRemixJob(jobId: string): Promise<RemixJobStatus> {
  const res = await fetchWithTimeout(
    `${getApiBase()}/api/audio/remix/jobs/${encodeURIComponent(jobId)}`,
    { timeout: 10000 },
  );
  return unwrap<RemixJobStatus>(res, `Failed to load remix job ${jobId}`);
}

/** Recent jobs, newest first. */
export async function listRemixJobs(): Promise<RemixJobStatus[]> {
  const res = await fetchWithTimeout(
    `${getApiBase()}/api/audio/remix/jobs`,
    { timeout: 10000 },
  );
  const body = await unwrap<{ jobs: RemixJobStatus[] }>(
    res,
    "Failed to list remix jobs",
  );
  return body.jobs;
}

const JOB_POLL_INTERVAL_MS = 1000;

async function awaitJob<T>(jobId: string, failure: string): Promise<T> {
  // The backend caps a wedged job and reports it failed, and a
  // server restart makes the job vanish (an error, not an
  // infinite wait), so this loop always terminates.
  for (;;) {
    const status = await getRemixJob(jobId);
    if (status.state === "done") {
      if (!status.result) throw new Error(failure);
      return status.result as T;
    }
    if (status.state === "failed") {
      throw new Error(status.error || failure);
    }
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

/**
 * Render a recipe, waiting for the background job to finish.
 *
 * Same contract as before the job split: resolves with the build
 * result or rejects with the failure. The difference is on the
 * wire - no single request is held open for the render, so the
 * 300 s fetch timeout the synchronous call needed is gone, and
 * the job can be polled for progress by anyone who wants it.
 */
export async function buildRemix(recipe: RemixRecipeSpec): Promise<RemixBuildResult> {
  const { job_id } = await startBuildRemix(recipe);
  return awaitJob<RemixBuildResult>(job_id, "Remix render failed");
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

/**
 * Master a rendered remix, waiting for the background job to finish.
 *
 * Same contract as before the job split: resolves with the enhance
 * result or rejects with the failure. The chain is CPU bound and
 * measured at ~60 s, which no longer has to be held inside one
 * request - the job is polled in one-second steps instead.
 */
export async function enhanceRemix(
  name: string,
  options: { vocal_balance_db?: number; pre_highpass_hz?: number } = {},
): Promise<RemixEnhanceResult> {
  const { job_id } = await startEnhanceRemix(name, options);
  return awaitJob<RemixEnhanceResult>(job_id, `Failed to master remix ${name}`);
}

/** URL for an `<audio src>`; resolves same-origin, so no fetch wrapper. */
export function remixFileUrl(name: string, which: StemName | "master"): string {
  return `${getApiBase()}/api/audio/remix/${encodeURIComponent(name)}/file/${which}`;
}