/**
 * Frontend client for /api/voice/pocket — the Studio proxy to the rig-local
 * Pocket TTS server. The Pocket URL and Bearer token never reach the browser;
 * they live in config/tts.json + a server-side env var.
 */

import { getJson } from "./typed-fetch";
import { fetchWithTimeout } from "../fetchWithTimeout";

const BASE = "/api/voice/pocket";

export interface PocketHealth {
  model?: string | null;
  sample_rate?: number | null;
  voices_cached?: string[];
  preset_voices?: string[];
  busy?: boolean;
}

export interface PocketVoice {
  name: string;
  kind: "custom" | "preset";
}

export interface PocketVoices {
  voices: PocketVoice[];
  default_voice: string;
  degraded: boolean;
}

/** GET /api/voice/pocket/health — engine status for the status card. */
export async function getPocketHealth(): Promise<PocketHealth> {
  return getJson<PocketHealth>(`${BASE}/health`, { timeout: 15000 });
}

/** GET /api/voice/pocket/voices — deduped custom-then-preset voice list. */
export async function getPocketVoices(): Promise<PocketVoices> {
  return getJson<PocketVoices>(`${BASE}/voices`, { timeout: 15000 });
}

/**
 * POST /api/voice/pocket/speak — one chunk in, audio Blob out.
 * `signal` lets the page abort the run mid-flight (Stop button).
 */
export async function speakPocket(
  text: string,
  voice: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetchWithTimeout(`${BASE}/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
    timeout: 120000,
    signal,
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = (await response.json()) as { detail?: unknown };
      if (typeof data.detail === "string") detail = data.detail;
      else if (data.detail !== undefined) detail = JSON.stringify(data.detail);
    } catch {
      /* keep statusText */
    }
    throw new Error(`Speak failed (${response.status}): ${detail}`);
  }
  return response.blob();
}
