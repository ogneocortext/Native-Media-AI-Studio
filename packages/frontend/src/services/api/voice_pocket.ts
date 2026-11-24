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

// -- Maya inbox -------------------------------------------------------------
// File-backed queue (output/logs/voice-inbox.json) of lines posted from
// outside the page; the Voice Live "Listen for Maya" toggle polls it.

export interface InboxEntry {
  id: string;
  text: string;
  voice: string;
  created_at: string;
  played: boolean;
}

export interface InboxPending {
  entries: InboxEntry[];
}

/** GET /api/voice/pocket/inbox/pending — unplayed entries, oldest first. */
export async function getInboxPending(): Promise<InboxPending> {
  return getJson<InboxPending>(`${BASE}/inbox/pending`, { timeout: 10000 });
}

/** POST /api/voice/pocket/inbox/{id}/played — mark an entry as spoken. */
export async function markInboxPlayed(id: string): Promise<InboxEntry> {
  const response = await fetchWithTimeout(`${BASE}/inbox/${id}/played`, {
    method: "POST",
    timeout: 10000,
  });
  if (!response.ok) {
    throw new Error(`Mark played failed (${response.status})`);
  }
  return (await response.json()) as InboxEntry;
}

// -- Maya inbox: audio drops ------------------------------------------------
// Files Maya POSTs to /inbox/audio (or drops into output/voice-inbox/) are
// listed here until the page plays them once, then marks them played.

export interface InboxAudioEntry {
  id: string;
  name: string;
  size: number;
  created_at: string;
  played: boolean;
}

export interface InboxAudioPending {
  entries: InboxAudioEntry[];
}

/** GET /api/voice/pocket/inbox/audio/pending — unplayed drops, oldest first. */
export async function getInboxAudioPending(): Promise<InboxAudioPending> {
  return getJson<InboxAudioPending>(`${BASE}/inbox/audio/pending`, {
    timeout: 10000,
  });
}

/** POST /api/voice/pocket/inbox/audio/{id}/played — mark a drop as played. */
export async function markInboxAudioPlayed(
  id: string,
): Promise<InboxAudioEntry> {
  const response = await fetchWithTimeout(
    `${BASE}/inbox/audio/${encodeURIComponent(id)}/played`,
    { method: "POST", timeout: 10000 },
  );
  if (!response.ok) {
    throw new Error(`Mark audio played failed (${response.status})`);
  }
  return (await response.json()) as InboxAudioEntry;
}

/** URL that streams one audio drop for decodeAudioData / <audio>. */
export function inboxAudioFileUrl(id: string): string {
  return `${BASE}/inbox/audio/file/${encodeURIComponent(id)}`;
}
