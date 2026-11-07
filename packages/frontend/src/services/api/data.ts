/**
 * Frontend client for /api/data — prompts, visuals, sessions, preferences, tracks.
 */

import { getJson, postJson, fetchJson } from "./typed-fetch";
import type {
  StoredPrompt,
  AIVisualRecord,
  GenerationSession,
  APITrack,
  PromptHistoryEntry,
} from "./types";

const BASE = "/api/data";

/**
 * Get prompts with optional filtering.
 */
export async function getPrompts(params?: {
  prompt_type?: string;
  category?: string;
  favorite?: boolean;
  search?: string;
  limit?: number;
}): Promise<StoredPrompt[]> {
  const searchParams = new URLSearchParams();
  if (params?.prompt_type) searchParams.set("prompt_type", params.prompt_type);
  if (params?.category) searchParams.set("category", params.category);
  if (params?.favorite) searchParams.set("favorite", "true");
  if (params?.search) searchParams.set("search", params.search);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  return getJson<StoredPrompt[]>(`${BASE}/?${searchParams.toString()}`, { timeout: 30000 });
}

/**
 * Save a new prompt.
 */
export async function savePrompt(prompt: {
  name: string;
  prompt_type: string;
  text: string;
  tags?: string[];
  category?: string;
  description?: string;
}): Promise<{ id: string; success: boolean }> {
  return postJson<{ id: string; success: boolean }>(BASE, prompt, { timeout: 30000 });
}

/**
 * Record prompt usage (increments use_count, updates last_used_at).
 */
export async function recordPromptUse(promptId: string): Promise<void> {
  await fetchJson<void>(`${BASE}/${promptId}/use`, { method: "POST", timeout: 30000 });
}

/**
 * Toggle prompt favorite status.
 */
export async function togglePromptFavorite(promptId: string): Promise<boolean> {
  return postJson<{ is_favorite: boolean }>(`${BASE}/${promptId}/favorite`, {}, { timeout: 30000 })
    .then((r) => r.is_favorite);
}

/**
 * Delete a prompt.
 */
export async function deletePrompt(promptId: string): Promise<void> {
  await fetchJson<void>(`${BASE}/${promptId}`, { method: "DELETE", timeout: 30000 });
}

/**
 * Get AI visuals with optional filtering.
 */
export async function getAIVisuals(params?: {
  style_id?: string;
  favorite?: boolean;
  selected?: boolean;
  limit?: number;
}): Promise<AIVisualRecord[]> {
  const searchParams = new URLSearchParams();
  if (params?.style_id) searchParams.set("style_id", params.style_id);
  if (params?.favorite) searchParams.set("favorite", "true");
  if (params?.selected) searchParams.set("selected", "true");
  if (params?.limit) searchParams.set("limit", String(params.limit));
  return getJson<AIVisualRecord[]>(`${BASE}/visuals/?${searchParams.toString()}`, { timeout: 30000 });
}

/**
 * Save an AI visual record.
 */
export async function saveAIVisual(visual: Partial<AIVisualRecord>): Promise<{ id: string }> {
  return postJson<{ id: string }>(`${BASE}/visuals/save`, visual, { timeout: 30000 });
}

/**
 * Get generation sessions with optional filtering.
 */
export async function getSessions(params?: {
  status?: string;
  audio_id?: string;
  limit?: number;
}): Promise<GenerationSession[]> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  if (params?.audio_id) searchParams.set("audio_id", params.audio_id);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  return getJson<GenerationSession[]>(`${BASE}/sessions/?${searchParams.toString()}`, { timeout: 30000 });
}

/**
 * Create a new generation session.
 */
export async function createSession(session: {
  audio_id?: string;
  music_prompt_id?: string;
  config?: Record<string, unknown>;
}): Promise<{ id: string }> {
  return postJson<{ id: string }>(`${BASE}/sessions/`, session, { timeout: 30000 });
}

/**
 * Get user preferences (all or by category).
 */
export async function getPreferences(category?: string): Promise<Record<string, unknown>> {
  const url = category ? `${BASE}/preferences/?category=${category}` : `${BASE}/preferences/`;
  return getJson<Record<string, unknown>>(url, { timeout: 30000 });
}

/**
 * Set a user preference.
 */
export async function setPreference(
  key: string,
  value: unknown,
  category = "general",
): Promise<void> {
  await postJson<void>(`${BASE}/preferences/${key}`, { value, category }, { timeout: 30000 });
}

/**
 * Fetch all tracks from the data API.
 */
export async function fetchTracks(): Promise<APITrack[]> {
  return getJson<APITrack[]>(`${BASE}/tracks/`, { timeout: 30000 });
}

/**
 * Save a generated scene (code + metadata).
 */
export async function saveGeneratedScene(
  code: string,
  track: string,
  model: string,
): Promise<{ success: boolean; filename: string; path: string }> {
  return postJson<{ success: boolean; filename: string; path: string }>(
    `${BASE}/saved-scenes`,
    { code, track, model },
    { timeout: 30000 },
  );
}

/**
 * Cleanup incomplete scenes for a track, keeping N most recent.
 */
export async function cleanupIncompleteScenes(
  track: string,
  keep = 3,
): Promise<{ removed: number; kept: number }> {
  return postJson<{ removed: number; kept: number }>(
    `${BASE}/saved-scenes/cleanup`,
    { track, keep },
    { timeout: 30000 },
  );
}

/**
 * List all saved scenes.
 */
export async function listSavedScenes(): Promise<{
  scenes: { filename: string; path: string; size: number; modified: string }[];
}> {
  return getJson<{ scenes: { filename: string; path: string; size: number; modified: string }[] }>(
    `${BASE}/saved-scenes`,
    { timeout: 30000 },
  );
}

/**
 * Get prompt history with optional filtering.
 */
export async function getPromptHistory(params?: {
  track_filename?: string;
  section?: string;
  limit?: number;
}): Promise<PromptHistoryEntry[]> {
  const qs = new URLSearchParams();
  if (params?.track_filename) qs.set("track_filename", params.track_filename);
  if (params?.section) qs.set("section", params.section);
  if (params?.limit) qs.set("limit", String(params.limit));
  return getJson<PromptHistoryEntry[]>(`${BASE}/prompt-history?${qs.toString()}`, { timeout: 30000 });
}

/**
 * Save a prompt version (history entry).
 */
export async function savePromptVersion(entry: {
  track_filename?: string;
  section?: string;
  section_index?: number;
  prompt: string;
  negative_prompt?: string;
  parent_id?: string | null;
  action?: "create" | "repair" | "restore" | "import";
  repair_reason?: string;
  failure_notes?: string;
  generation_params?: Record<string, unknown>;
  outcome?: "draft" | "generated" | "failed" | "approved";
}): Promise<{ success: boolean; entry: PromptHistoryEntry }> {
  return postJson<{ success: boolean; entry: PromptHistoryEntry }>(
    `${BASE}/prompt-history`,
    entry,
    { timeout: 30000 },
  );
}

/**
 * Get prompt chain for an entry (ancestors).
 */
export async function getPromptChain(entryId: string): Promise<PromptHistoryEntry[]> {
  return getJson<PromptHistoryEntry[]>(`${BASE}/prompt-history/${entryId}/chain`, { timeout: 30000 });
}

/**
 * Delete a prompt version.
 */
export async function deletePromptVersion(entryId: string): Promise<{ success: boolean }> {
  return getJson<{ success: boolean }>(`${BASE}/prompt-history/${entryId}`, {
    method: "DELETE",
    timeout: 30000,
  });
}