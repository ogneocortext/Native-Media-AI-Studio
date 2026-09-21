import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

export interface StoredPrompt {
  id: string;
  name: string;
  prompt_type: string;
  text: string;
  tags: string[];
  category: string;
  description: string;
  is_favorite: boolean;
  use_count: number;
  last_used_at?: string;
  created_at: string;
  updated_at: string;
}

export interface AIVisualRecord {
  id: string;
  prompt_id?: string;
  style_id: string;
  checkpoint: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
  filename: string;
  stored_path: string;
  comfyui_prompt_id: string;
  is_selected: boolean;
  is_favorite: boolean;
  rating: number;
  tags: string[];
  generation_time_seconds: number;
  created_at: string;
}

export interface GenerationSession {
  id: string;
  audio_id?: string;
  music_prompt_id?: string;
  status: string;
  config: Record<string, unknown>;
  selected_visuals: string[];
  output_path?: string;
  total_frames: number;
  generated_frames: number;
  estimated_time_seconds: number;
  actual_time_seconds: number;
  created_at: string;
  completed_at?: string;
}

// Prompts
export async function getPrompts(params?: {
  prompt_type?: string;
  category?: string;
  favorite?: boolean;
  search?: string;
  limit?: number;
}): Promise<StoredPrompt[]> {
  const base = getApiBase();
  const searchParams = new URLSearchParams();
  if (params?.prompt_type) searchParams.set("prompt_type", params.prompt_type);
  if (params?.category) searchParams.set("category", params.category);
  if (params?.favorite) searchParams.set("favorite", "true");
  if (params?.search) searchParams.set("search", params.search);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  const res = await fetchWithTimeout(`${base}/api/data/?${searchParams}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get prompts");
  return res.json();
}

export async function savePrompt(prompt: {
  name: string;
  prompt_type: string;
  text: string;
  tags?: string[];
  category?: string;
  description?: string;
}): Promise<{ id: string; success: boolean }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/data/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prompt),
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to save prompt");
  return res.json();
}

export async function recordPromptUse(promptId: string): Promise<void> {
  const base = getApiBase();
  await fetchWithTimeout(`${base}/api/data/${promptId}/use`, { method: "POST", timeout: 30000 });
}

export async function togglePromptFavorite(promptId: string): Promise<boolean> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/data/${promptId}/favorite`, { method: "POST", timeout: 30000 });
  if (!res.ok) return false;
  const data = await res.json();
  return data.is_favorite;
}

export async function deletePrompt(promptId: string): Promise<void> {
  const base = getApiBase();
  await fetchWithTimeout(`${base}/api/data/${promptId}`, { method: "DELETE", timeout: 30000 });
}

// AI Visuals
export async function getAIVisuals(params?: {
  style_id?: string;
  favorite?: boolean;
  selected?: boolean;
  limit?: number;
}): Promise<AIVisualRecord[]> {
  const base = getApiBase();
  const searchParams = new URLSearchParams();
  if (params?.style_id) searchParams.set("style_id", params.style_id);
  if (params?.favorite) searchParams.set("favorite", "true");
  if (params?.selected) searchParams.set("selected", "true");
  if (params?.limit) searchParams.set("limit", String(params.limit));
  const res = await fetchWithTimeout(`${base}/api/data/visuals/?${searchParams}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get visuals");
  return res.json();
}

export async function saveAIVisual(visual: Partial<AIVisualRecord>): Promise<{ id: string }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/data/visuals/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(visual),
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to save visual");
  return res.json();
}

// Generation Sessions
export async function getSessions(params?: {
  status?: string;
  audio_id?: string;
  limit?: number;
}): Promise<GenerationSession[]> {
  const base = getApiBase();
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  if (params?.audio_id) searchParams.set("audio_id", params.audio_id);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  const res = await fetchWithTimeout(`${base}/api/data/sessions/?${searchParams}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get sessions");
  return res.json();
}

export async function createSession(session: {
  audio_id?: string;
  music_prompt_id?: string;
  config?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/data/sessions/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(session),
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to create session");
  return res.json();
}

// User Preferences
export async function getPreferences(category?: string): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const url = category
    ? `${base}/api/data/preferences/?category=${category}`
    : `${base}/api/data/preferences/`;
  const res = await fetchWithTimeout(url, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get preferences");
  return res.json();
}

export async function setPreference(
  key: string,
  value: unknown,
  category = "general"
): Promise<void> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/data/preferences/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value, category }),
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to set preference");
}

// Tracks
export interface APITrack {
  id: string;
  filename: string;
  artist: string;
  title: string;
  duration_seconds: number | null;
  size_mb: number | null;
  source_path: string;
  music_prompt: string;
  lyrics: string;
  visual_style: string;
  visual_prompt: string;
  status: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

export async function fetchTracks(): Promise<APITrack[]> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/data/tracks/`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to fetch tracks");
  return res.json();
}

// Saved scenes
export async function saveGeneratedScene(code: string, track: string, model: string): Promise<{ success: boolean; filename: string; path: string }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/data/saved-scenes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, track, model }),
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to save scene");
  return res.json();
}

export async function cleanupIncompleteScenes(track: string, keep = 3): Promise<{ removed: number; kept: number }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/data/saved-scenes/cleanup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track, keep }),
    timeout: 30000,
  });
  if (!res.ok) throw new Error("Failed to cleanup scenes");
  return res.json();
}

export async function listSavedScenes(): Promise<{ scenes: Array<{ filename: string; path: string; size: number; modified: string }> }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/data/saved-scenes`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to list saved scenes");
  return res.json();
}

// Prompt History
export interface PromptHistoryEntry {
  id: string;
  track_filename: string;
  section: string;
  section_index: number;
  prompt: string;
  negative_prompt: string;
  parent_id: string | null;
  version: number;
  action: "create" | "repair" | "restore" | "import";
  repair_reason: string;
  failure_notes: string;
  generation_params: Record<string, unknown>;
  outcome: "draft" | "generated" | "failed" | "approved";
  created_at: string;
}

export async function getPromptHistory(params?: {
  track_filename?: string;
  section?: string;
  limit?: number;
}): Promise<PromptHistoryEntry[]> {
  const base = getApiBase();
  const qs = new URLSearchParams();
  if (params?.track_filename) qs.set("track_filename", params.track_filename);
  if (params?.section) qs.set("section", params.section);
  if (params?.limit) qs.set("limit", String(params.limit));
  const res = await fetchWithTimeout(`${base}/api/data/prompt-history?${qs.toString()}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to load prompt history");
  return res.json();
}

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
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/data/prompt-history`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
    timeout: 30000,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to save prompt version");
  }
  return res.json();
}

export async function getPromptChain(entryId: string): Promise<PromptHistoryEntry[]> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/data/prompt-history/${entryId}/chain`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to load prompt chain");
  return res.json();
}

export async function deletePromptVersion(entryId: string): Promise<{ success: boolean }> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/data/prompt-history/${entryId}`, { method: "DELETE", timeout: 30000 });
  if (!res.ok) throw new Error("Failed to delete prompt version");
  return res.json();
}
