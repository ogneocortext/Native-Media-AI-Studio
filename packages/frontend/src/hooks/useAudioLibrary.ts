/**
 * Hook for pages that render an audio selector.
 *
 * Wraps `useAudioLibraryStore` with a mount-time load so a page does not need to
 * remember the `useEffect`. Concurrent pages share one request (see the store),
 * so calling this from several components is cheap and never double-fetches.
 */

import { useEffect } from "react";
import { useAudioLibraryStore, type AudioLibraryEntry } from "../state/audioLibraryStore";

export interface UseAudioLibraryResult {
  entries: AudioLibraryEntry[];
  isLoading: boolean;
  error: string | null;
  /** Force a reload — call after upload/rename/delete. */
  refresh: () => Promise<void>;
}

export function useAudioLibrary(): UseAudioLibraryResult {
  const entries = useAudioLibraryStore((s) => s.entries);
  const isLoading = useAudioLibraryStore((s) => s.isLoading);
  const error = useAudioLibraryStore((s) => s.error);
  const ensureLoaded = useAudioLibraryStore((s) => s.ensureLoaded);
  const refresh = useAudioLibraryStore((s) => s.refresh);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  return { entries, isLoading, error, refresh };
}
