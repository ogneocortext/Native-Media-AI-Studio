/**
 * Zustand store for the audio media library — the single source of truth for
 * every audio selector in the app.
 *
 * Before this existed, six pages each called `listAudioFiles()` from their own
 * `useEffect` and kept their own copy of the result: ArtDirection,
 * AudioAnalysisPage, KineticTypographyPage, StoryboardPage, the 3D studio's
 * `useTrackManager`, and the Visualizer. That meant six requests per navigation,
 * six independent loading/error states, and six opportunities for the list to
 * disagree — which it did, because each site stripped the content-hash prefix
 * with a different regex (see `audioNaming.ts`).
 *
 * The store keeps one in-flight promise so concurrent mounters share a single
 * request, and exposes the already-deduplicated, display-name-tagged list that
 * selectors render directly.
 */

import { create } from "zustand";
import { listAudioFiles } from "../services/api";
import {
  audioEntryLabel,
  audioOptionLabel,
  audioRefFor,
  dedupeAudioFiles,
  type AudioLibraryFile,
} from "./audioNaming";

export type { AudioLibraryFile };
export {
  audioDisplayName,
  audioEntryLabel,
  audioOptionLabel,
  audioRefFor,
  dedupeAudioFiles,
  stripHashPrefixes,
} from "./audioNaming";

/** A library entry decorated with the labels every selector needs. */
export interface AudioLibraryEntry extends AudioLibraryFile {
  /** Human label, hash prefixes and extension removed. */
  displayName: string;
  /** Label with a `[hash]` suffix when another track shares the display name. */
  optionLabel: string;
  /** Folder-aware reference to pass to the backend. */
  ref: string;
}

interface AudioLibraryState {
  /** Deduplicated entries, in backend order (most recently modified first). */
  entries: AudioLibraryEntry[];
  /** True only while a fetch is actually in flight. */
  isLoading: boolean;
  error: string | null;
  /** Epoch ms of the last successful load, or null if never loaded. */
  lastLoadedAt: number | null;

  /** Load the library. Concurrent calls share one request. */
  ensureLoaded: (opts?: { force?: boolean }) => Promise<void>;
  /** Force a reload — call after an upload, rename, delete or analysis. */
  refresh: () => Promise<void>;
  clearError: () => void;
}

/**
 * In-flight and completed-promise bookkeeping lives at module scope, not in
 * state: two components mounting in the same tick must join one request, and a
 * resolved promise must be reused until someone asks for a force refresh.
 */
let inFlight: Promise<void> | null = null;
let settled: Promise<void> | null = null;

function buildEntries(files: readonly AudioLibraryFile[]): AudioLibraryEntry[] {
  const deduped = dedupeAudioFiles(files);
  return deduped.map((file) => ({
    ...file,
    displayName: audioEntryLabel(file),
    // Compare against the full deduped set so the label does not depend on
    // which subset of the library a given selector happens to render.
    optionLabel: audioOptionLabel(file, deduped),
    ref: audioRefFor(file),
  }));
}

export const useAudioLibraryStore = create<AudioLibraryState>()((set) => {
  const load = async (force: boolean): Promise<void> => {
    if (!force) {
      // Reuse the last settled load unless the caller wants fresh data.
      if (settled) return settled;
      if (inFlight) return inFlight;
    }

    const request = (async () => {
      set({ isLoading: true, error: null });
      try {
        const files = await listAudioFiles();
        set({
          entries: buildEntries(files),
          isLoading: false,
          error: null,
          lastLoadedAt: Date.now(),
        });
      } catch (error) {
        set({
          isLoading: false,
          error: error instanceof Error ? error.message : "Failed to load audio library",
        });
      } finally {
        inFlight = null;
      }
    })();

    inFlight = request;
    settled = request;
    return request;
  };

  return {
    entries: [],
    isLoading: false,
    error: null,
    lastLoadedAt: null,

    ensureLoaded: (opts) => load(opts?.force === true),
    refresh: () => load(true),
    clearError: () => set({ error: null }),
  };
});

/**
 * Drop the memoised load so the next `ensureLoaded()` refetches.
 *
 * Exposed for tests, which must not inherit a resolved promise from a previous
 * case.
 */
export function __resetAudioLibraryCache(): void {
  inFlight = null;
  settled = null;
  useAudioLibraryStore.setState({ entries: [], isLoading: false, error: null, lastLoadedAt: null });
}
