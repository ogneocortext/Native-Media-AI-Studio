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
import { getJson, postJson } from "./typed-fetch";
import type {
  RemixSource,
  RemixProbe,
  RemixRecipeSpec,
  RemixPreview,
  RemixPreviewAudio,
  RemixDraft,
  RemixSummary,
  RemixEnhanceResult,
  RemixJobAccepted,
  RemixJobStatus,
  RemixTrackLineage,
  RemixVersion,
  StemName,
} from "./types";

export const STEM_NAMES = ["vocals", "drums", "bass", "other"] as const;
export type StemName = (typeof STEM_NAMES)[number];

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

/** Thrown when a job the caller was awaiting is cancelled. */
export class RemixCancelledError extends Error {
  constructor(message = "Cancelled") {
    super(message);
    this.name = "RemixCancelledError";
  }
}

const BASE = "/api/audio/remix";

/**
 * List all tracks with separated stems available for remixing.
 */
export async function getRemixSources(): Promise<RemixSource[]> {
  return getJson<{ sources: RemixSource[] }>(`${BASE}/sources`, { timeout: 15000 }).then((r) => r.sources);
}

/**
 * Probe a track for tempo and advisory key info.
 * Backend route is POST /api/audio/remix/probe?track=… — a GET returns 405.
 */
export async function probeRemixTrack(track: string): Promise<RemixProbe> {
  return postJson<RemixProbe>(`${BASE}/probe?track=${encodeURIComponent(track)}`, {}, { timeout: 120000 });
}

/**
 * Preview a remix recipe (resolve timeline, measure levels, return warnings).
 * Does not write audio.
 */
export async function previewRemix(recipe: RemixRecipeSpec): Promise<RemixPreview> {
  return postJson<RemixPreview>(`${BASE}/preview`, recipe, { timeout: 180000 });
}

/**
 * Render a bounded, playable excerpt of a recipe (A3).
 * Same mix core as the build, truncated to ~30s and cached by recipe hash.
 * Pass `slotIndex` (0-based) to audition one slot alone.
 */
export async function previewRemixAudio(
  recipe: RemixRecipeSpec,
  slotIndex?: number,
): Promise<RemixPreviewAudio> {
  const body = slotIndex === undefined ? recipe : { ...recipe, slot_index: slotIndex };
  return postJson<RemixPreviewAudio>(`${BASE}/preview-audio`, body, { timeout: 240000 });
}

/**
 * Draft a mashup from one sentence, or revise a recipe with one sentence
 * (pass the panel's live recipe as `baseRecipe` — e.g. "vocals up 2 dB").
 * Draft-only: the caller reviews before spending a render.
 */
export async function draftRemixFromPrompt(
  prompt: string,
  baseRecipe?: RemixRecipeSpec,
): Promise<RemixDraft> {
  return postJson<RemixDraft>(
    `${BASE}/from-prompt`,
    baseRecipe ? { prompt, base_recipe: baseRecipe } : { prompt },
    { timeout: 300000 },
  );
}

/**
 * Start a build without waiting for it.
 * The backend validates the recipe and checks the source stems synchronously,
 * then renders in a background job. Await the terminal state with `awaitRemixJob`,
 * or cancel it with `cancelRemixJob`.
 */
export async function startBuildRemix(recipe: RemixRecipeSpec): Promise<RemixJobAccepted> {
  return postJson<RemixJobAccepted>(`${BASE}/build`, recipe, { timeout: 15000 });
}

/**
 * Start a master (enhance) without waiting for it.
 * The backend checks the remix and its stems synchronously, then runs the chain
 * in a background job. Poll `getRemixJob` for the result.
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
  return postJson<RemixJobAccepted>(
    `${BASE}/${encodeURIComponent(name)}/enhance`,
    options,
    { timeout: 15000 },
  );
}

/**
 * Get status of one build/enhance job, including its result when done.
 */
export async function getRemixJob(jobId: string): Promise<RemixJobStatus> {
  return getJson<RemixJobStatus>(`${BASE}/jobs/${encodeURIComponent(jobId)}`, { timeout: 10000 });
}

/**
 * List recent remix jobs, newest first.
 */
export async function listRemixJobs(): Promise<RemixJobStatus[]> {
  return getJson<{ jobs: RemixJobStatus[] }>(`${BASE}/jobs`, { timeout: 10000 }).then((r) => r.jobs);
}

/**
 * Ask a running build to stop.
 * Cooperative: the render polls the token between slots.
 * Rejects with 409 for an enhance (runs inside one call with no safe point)
 * and for a job that already finished.
 * Cancel is never destructive: a cancelled build writes nothing.
 */
export async function cancelRemixJob(jobId: string): Promise<RemixJobStatus> {
  return postJson<RemixJobStatus>(
    `${BASE}/jobs/${encodeURIComponent(jobId)}/cancel`,
    {},
    { timeout: 15000 },
  );
}

const JOB_POLL_INTERVAL_MS = 1000;

/**
 * Await a terminal job state.
 * Resolves with the final status (done | failed | cancelled) rather than throwing,
 * so a caller with a Cancel button can distinguish "user stopped" from "it broke".
 * Rejects only on transport errors.
 */
export async function awaitRemixJob(jobId: string): Promise<RemixJobStatus> {
  for (;;) {
    const status = await getRemixJob(jobId);
    if (status.state !== "queued" && status.state !== "running" && status.state !== "cancelling") {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

async function awaitJob<T>(jobId: string, failure: string): Promise<T> {
  const status = await awaitRemixJob(jobId);
  if (status.state === "done" && status.result) {
    return status.result as T;
  }
  if (status.state === "cancelled") {
    throw new RemixCancelledError("Cancelled");
  }
  throw new Error(status.error ?? failure);
}

/**
 * List all rendered remixes.
 */
export async function listRemixes(): Promise<RemixSummary[]> {
  return getJson<{ remixes: RemixSummary[] }>(`${BASE}/list`, { timeout: 15000 }).then((r) => r.remixes);
}

/**
 * Every rendered mashup that consumed `track`, each with its recipe.
 * `track` is the library filename as the audio library reports it.
 */
export async function getTrackLineage(track: string): Promise<RemixTrackLineage> {
  return getJson<RemixTrackLineage>(
    `${BASE}/by-track/${encodeURIComponent(track)}`,
    { timeout: 15000 },
  );
}

/**
 * List all versions of a remix (current + archived renders).
 */
export async function listRemixVersions(name: string): Promise<RemixVersion[]> {
  return getJson<{ versions: RemixVersion[] }>(
    `${BASE}/${encodeURIComponent(name)}/versions`,
    { timeout: 15000 },
  ).then((r) => r.versions);
}

/**
 * Master a rendered remix, waiting for the background job to finish.
 * Same contract as before the job split: resolves with the enhance
 * result or rejects with the failure.
 */
export async function enhanceRemix(
  name: string,
  options: { vocal_balance_db?: number; pre_highpass_hz?: number } = {},
): Promise<RemixEnhanceResult> {
  const { job_id } = await startEnhanceRemix(name, options);
  return awaitJob<RemixEnhanceResult>(job_id, `Failed to master remix ${name}`);
}

/**
 * URL for an `<audio src>`; resolves same-origin, so no fetch wrapper.
 * `version` selects an archived render from `listRemixVersions`; omitted
 * means the current one. The backend 404s an unknown version rather than
 * answering with the current render, so a stale button fails loudly.
 */
export function remixFileUrl(name: string, which: StemName | "master", version?: number): string {
  const base = `${getApiBase()}${BASE}/${encodeURIComponent(name)}/file/${which}`;
  return version ? `${base}?version=${version}` : base;
}