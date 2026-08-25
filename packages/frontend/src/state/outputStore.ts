/**
 * Zustand store for managing generated outputs.
 */

import { create } from "zustand";
import { fetchPortConfig, getCachedConfig } from "../services/portConfig";
import type { OutputFile } from "@shared/types";

export type { OutputFile };

interface OutputsAPIResponse {
  outputs: OutputFile[];
  total: number;
  images_count: number;
  videos_count: number;
  audio_count: number;
}

interface OutputState {
  outputs: OutputFile[];
  recentOutputs: OutputFile[];
  selectedOutput: OutputFile | null;
  isLoading: boolean;
  error: string | null;
  filter: { type: "all" | "image" | "video" | "audio"; limit: number; offset: number; search?: string; dateFrom?: string; dateTo?: string; };
  counts: { total: number; images: number; videos: number; audio: number; };
  setOutputs: (outputs: OutputFile[]) => void;
  setRecentOutputs: (outputs: OutputFile[]) => void;
  setSelectedOutput: (output: OutputFile | null) => void;
  setFilter: (filter: Partial<OutputState["filter"]>) => void;
  setCounts: (counts: Partial<OutputState["counts"]>) => void;
  fetchOutputs: () => Promise<void>;
  fetchRecent: (limit?: number) => Promise<void>;
  fetchByType: (type: "images" | "video" | "audio") => Promise<void>;
  deleteOutput: (relativePath: string) => Promise<void>;
  renameOutput: (relativePath: string, newName: string) => Promise<unknown>;
  bulkDelete: (paths: string[]) => Promise<unknown>;
  fetchDuplicates: (quick?: boolean) => Promise<Array<{ hash: string; count: number; size_bytes: number; wasted_bytes: number; files: Array<{ filename: string; relative_path: string; size_bytes: number; created_at: string }> }>>;
  clearError: () => void;
}

async function getBackendUrl(): Promise<string> {
  try {
    await fetchPortConfig();
    const cached = getCachedConfig();
    if (cached?.backend_url) return cached.backend_url;
  } catch { /* fall through */ }
  return "http://localhost:8000";
}

export async function fetchOutputsFromAPI(fileType?: string, limit = 50, offset = 0): Promise<OutputsAPIResponse> {
  const base = await getBackendUrl();
  let url = base + "/api/outputs?limit=" + limit + "&offset=" + offset;
  if (fileType && fileType !== "all") url += "&file_type=" + fileType;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch outputs");
  return res.json();
}

export async function fetchRecentOutputsFromAPI(limit = 10): Promise<OutputFile[]> {
  const base = await getBackendUrl();
  const res = await fetch(base + "/api/outputs/recent?limit=" + limit);
  if (!res.ok) throw new Error("Failed to fetch recent outputs");
  return res.json();
}

export async function fetchOutputsByTypeFromAPI(fileType: "images" | "video" | "audio", limit = 50): Promise<OutputFile[]> {
  const base = await getBackendUrl();
  const res = await fetch(base + "/api/outputs/" + fileType + "?limit=" + limit);
  if (!res.ok) throw new Error("Failed to fetch " + fileType + " outputs");
  return res.json();
}

export const useOutputStore = create<OutputState>((set, get) => ({
  outputs: [], recentOutputs: [], selectedOutput: null, isLoading: false, error: null,
  filter: { type: "all", limit: 50, offset: 0 },
  counts: { total: 0, images: 0, videos: 0, audio: 0 },
  setOutputs: (outputs) => set({ outputs, error: null }),
  setRecentOutputs: (recentOutputs) => set({ recentOutputs, error: null }),
  setSelectedOutput: (output) => set({ selectedOutput: output }),
  setFilter: (filterUpdate) => set((state) => ({ filter: { ...state.filter, ...filterUpdate } })),
  setCounts: (countsUpdate) => set((state) => ({ counts: { ...state.counts, ...countsUpdate } })),

  fetchOutputs: async () => {
    set({ isLoading: true, error: null });
    try {
      const { filter } = get();
      const fileType = filter.type === "all" ? undefined : filter.type;
      const response = await fetchOutputsFromAPI(fileType, filter.limit, filter.offset);
      set({ outputs: response.outputs, counts: { total: response.total, images: response.images_count, videos: response.videos_count, audio: response.audio_count }, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to fetch outputs" });
    } finally {
      set({ isLoading: false });
    }
  },

  fetchRecent: async (limit = 10) => {
    set({ isLoading: true, error: null });
    try {
      const recentOutputs = await fetchRecentOutputsFromAPI(limit);
      set({ recentOutputs, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to fetch recent outputs" });
    } finally {
      set({ isLoading: false });
    }
  },

  fetchByType: async (type) => {
    set({ isLoading: true, error: null });
    try {
      const outputs = await fetchOutputsByTypeFromAPI(type);
      set({ outputs, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to fetch " + type + " outputs" });
    } finally {
      set({ isLoading: false });
    }
  },

  deleteOutput: async (relativePath: string) => {
    try {
      const base = await getBackendUrl();
      const res = await fetch(base + "/api/outputs/" + encodeURIComponent(relativePath), { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete output");
      set((state) => ({ outputs: state.outputs.filter((o) => o.relative_path !== relativePath), recentOutputs: state.recentOutputs.filter((o) => o.relative_path !== relativePath) }));
    } catch (error) {
      set((state) => ({ outputs: state.outputs.filter((o) => o.relative_path !== relativePath) }));
      throw error;
    }
  },

  renameOutput: async (relativePath: string, newName: string) => {
    const base = await getBackendUrl();
    const res = await fetch(base + "/api/outputs/" + encodeURIComponent(relativePath) + "/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_name: newName }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Rename failed" }));
      throw new Error(err.detail || "Rename failed");
    }
    // Refresh after rename
    await get().fetchOutputs();
    await get().fetchRecent(12);
    return res.json();
  },

  bulkDelete: async (paths: string[]) => {
    const base = await getBackendUrl();
    const res = await fetch(base + "/api/outputs/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    });
    if (!res.ok) throw new Error("Bulk delete failed");
    const data = await res.json();
    await get().fetchOutputs();
    await get().fetchRecent(12);
    return data;
  },

  fetchDuplicates: async (quick = true) => {
    const base = await getBackendUrl();
    const res = await fetch(base + "/api/outputs/duplicates/groups?quick=" + quick);
    if (!res.ok) throw new Error("Failed to fetch duplicates");
    return res.json() as Promise<Array<{ hash: string; count: number; size_bytes: number; wasted_bytes: number; files: Array<{ filename: string; relative_path: string; size_bytes: number; created_at: string }> }>>;
  },

  clearError: () => set({ error: null }),
}));

export {
  formatBytes as formatFileSize,
} from "../utils/format";

// Re-export the single source-of-truth output URL helper (no local copy).
// url.ts also keeps getApiBaseUrl, which is the canonical backend resolver.
export { getOutputUrl } from "../utils/url";

// ============================================================================
// Zustand v5 Selectors — Fine-grained re-rendering
// ============================================================================

/** Subscribe to outputs array only */
export const useOutputs = () => useOutputStore((state) => state.outputs);

/** Subscribe to recent outputs only */
export const useRecentOutputs = () => useOutputStore((state) => state.recentOutputs);

/** Subscribe to selected output only */
export const useSelectedOutput = () => useOutputStore((state) => state.selectedOutput);

/** Subscribe to output counts only */
export const useOutputCounts = () => useOutputStore((state) => state.counts);

/** Subscribe to current filter only */
export const useOutputFilter = () => useOutputStore((state) => state.filter);

/** Subscribe to loading state only */
export const useOutputLoading = () => useOutputStore((state) => state.isLoading);

/** Subscribe to error state only */
export const useOutputError = () => useOutputStore((state) => state.error);

/** Subscribe to output actions (stable reference) */
export const useOutputActions = () =>
  useOutputStore((state) => ({
    fetchOutputs: state.fetchOutputs,
    fetchRecent: state.fetchRecent,
    fetchByType: state.fetchByType,
    deleteOutput: state.deleteOutput,
    renameOutput: state.renameOutput,
    bulkDelete: state.bulkDelete,
    fetchDuplicates: state.fetchDuplicates,
    setSelectedOutput: state.setSelectedOutput,
    setFilter: state.setFilter,
    clearError: state.clearError,
  }));
