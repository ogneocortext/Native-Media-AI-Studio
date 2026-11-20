/**
 * Frontend client for the local F5-TTS voice API (/api/voice/*).
 *
 * Unlike the Pocket proxy, F5-TTS is job-based: POST /synthesize returns a
 * job id, the queue runs it on the GPU, and the finished WAV is served by
 * GET /api/audio/file/<name> (it also lands in output/audio and the media
 * library). This module wraps submit + poll + audio-URL derivation.
 */

import { getJson, postJson } from "./typed-fetch";
import { fetchJob, cancelJob } from "./jobs";
import { JobStatus, type Job } from "@shared/types";

const BASE = "/api/voice";

export interface F5VoiceProfile {
  voice_id: string;
  name?: string;
  ref_audio?: string;
  [key: string]: unknown;
}

export interface F5VoiceList {
  voices: F5VoiceProfile[];
  count: number;
}

export interface F5Status {
  installed: boolean;
  message?: string;
  [key: string]: unknown;
}

export interface F5SynthesizeResponse {
  success: boolean;
  job_id: string | null;
  output_path: string | null;
  voice_id: string | null;
  chunks: number | null;
  error: string | null;
  message: string | null;
}

export async function getF5Status(): Promise<F5Status> {
  return getJson<F5Status>(`${BASE}/status`, { timeout: 15000 });
}

export async function listF5Voices(): Promise<F5VoiceList> {
  return getJson<F5VoiceList>(`${BASE}/voices`, { timeout: 15000 });
}

export async function synthesizeF5(text: string, voiceId: string): Promise<F5SynthesizeResponse> {
  return postJson<F5SynthesizeResponse>(
    `${BASE}/synthesize`,
    { text, voice_id: voiceId },
    { timeout: 30000 },
  );
}

export { fetchJob, cancelJob };
export type { Job };

const POLL_INTERVAL_MS = 2000;

/** Poll a job until it reaches a terminal state. Rejects on failed/cancelled. */
export async function waitForJob(
  jobId: string,
  signal?: AbortSignal,
  onProgress?: (job: Job) => void,
): Promise<Job> {
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const job = await fetchJob(jobId);
    onProgress?.(job);
    if (job.is_terminal) {
      if (job.status === JobStatus.COMPLETED) return job;
      const detail = job.error ?? job.message;
      throw new Error(detail || `Job ${jobId} ended as ${job.status}`);
    }
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(resolve, POLL_INTERVAL_MS);
      signal?.addEventListener(
        "abort",
        () => {
          window.clearTimeout(t);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }
}

/** Turn a job output_path (e.g. .../output/audio/voice_maya_ab12cd34.wav)
 *  into the /api/audio/file/<name> URL the backend serves. */
export function audioFileUrl(outputPath: string): string {
  const m = /output[\\/]audio[\\/](.+)$/.exec(outputPath);
  const name = m?.[1] ?? outputPath.split(/[\\/]/).pop() ?? outputPath;
  return `/api/audio/file/${encodeURIComponent(name)}`;
}
