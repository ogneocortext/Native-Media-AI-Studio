/**
 * Analysis result cache (localStorage).
 *
 * Track analysis is compute-once: the backend already caches results in its
 * DB + on-disk JSON, but every page load still pays a network round-trip
 * before presets and the beat grid can apply. This module keeps the last few
 * transformed `AudioAnalysisData` payloads in localStorage so repeat visits
 * hydrate instantly.
 *
 * Storage layout (per-file keys + a recency index, so eviction never has to
 * parse multi-hundred-KB entries):
 *   nma.viz.analysis.<enc filename>  → { v, savedAt, analysis }
 *   nma.viz.analysis.index           → JSON array of filenames, oldest→newest
 *
 * Pure encode/decode is kept separate from the React hook so the contract is
 * unit-testable in vitest's node environment — which has no localStorage,
 * per packages/frontend/vitest.config.ts. Every storage touch is try/catch:
 * quota errors degrade to "no cache", never a crash.
 */
import type { AudioAnalysisData } from "./types";

const ENTRY_PREFIX = "nma.viz.analysis.";
const INDEX_KEY = "nma.viz.analysis.index";
const CACHE_VERSION = 1;
/** ~0.17 MB per analysis on disk; 10 entries ≈ 1.7 MB, well under the ~5 MB quota. */
const MAX_ENTRIES = 10;
/** Analysis is immutable per file; the TTL only guards against pathological staleness. */
const TTL_MS = 180 * 24 * 60 * 60 * 1000;

/** Minimal Storage surface so tests can inject a fake in the node env. */
export interface AnalysisCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): AnalysisCacheStorage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function analysisEntryKey(filename: string): string {
  return ENTRY_PREFIX + encodeURIComponent(filename);
}

function isAnalysisData(v: unknown): v is AudioAnalysisData {
  if (!v || typeof v !== "object") return false;
  const a = v as AudioAnalysisData;
  return (
    typeof a.tempo_bpm === "number" &&
    typeof a.duration_seconds === "number" &&
    Array.isArray(a.beat_times) &&
    Array.isArray(a.energy_curve)
  );
}

/**
 * Load every cached analysis, keyed by filename. Corrupt, expired or
 * wrong-version entries are dropped (and their keys removed) as they're met.
 */
export function loadCachedAnalyses(
  storage: AnalysisCacheStorage | null = defaultStorage(),
): Record<string, AudioAnalysisData> {
  if (!storage) return {};
  const out: Record<string, AudioAnalysisData> = {};
  let rawIndex: string | null;
  try {
    rawIndex = storage.getItem(INDEX_KEY);
  } catch {
    return {};
  }
  if (!rawIndex) return {};

  let filenames: unknown;
  try {
    filenames = JSON.parse(rawIndex);
  } catch {
    return {};
  }
  if (!Array.isArray(filenames)) return {};

  const now = Date.now();
  const alive: string[] = [];
  for (const name of filenames) {
    if (typeof name !== "string" || !name) continue;
    try {
      const raw = storage.getItem(analysisEntryKey(name));
      if (!raw) continue;
      const entry = JSON.parse(raw) as { v?: number; savedAt?: number; analysis?: unknown };
      if (entry.v !== CACHE_VERSION || typeof entry.savedAt !== "number") continue;
      if (now - entry.savedAt > TTL_MS || !isAnalysisData(entry.analysis)) continue;
      out[name] = entry.analysis;
      alive.push(name);
    } catch {
      // corrupt entry — skip it
    }
  }
  // Rewrite the index without dead entries so it can't grow stale pointers.
  if (alive.length !== filenames.length) {
    try {
      storage.setItem(INDEX_KEY, JSON.stringify(alive));
    } catch {
      // no-op
    }
  }
  return out;
}

/**
 * Persist one analysis under its filename. Returns false when storage is
 * unavailable or the write failed even after evicting the oldest entries —
 * callers treat false as "cache miss next time", never an error.
 */
export function saveCachedAnalysis(
  filename: string,
  analysis: AudioAnalysisData,
  storage: AnalysisCacheStorage | null = defaultStorage(),
): boolean {
  if (!storage || !filename || !isAnalysisData(analysis)) return false;

  const write = (): void => {
    storage.setItem(
      analysisEntryKey(filename),
      JSON.stringify({ v: CACHE_VERSION, savedAt: Date.now(), analysis }),
    );
  };

  let index: string[] = [];
  try {
    const raw = storage.getItem(INDEX_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) index = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    index = [];
  }
  index = index.filter((n) => n !== filename);
  index.push(filename);
  while (index.length > MAX_ENTRIES) {
    const evicted = index.shift();
    if (evicted) {
      try {
        storage.removeItem(analysisEntryKey(evicted));
      } catch {
        // no-op
      }
    }
  }

  try {
    write();
    storage.setItem(INDEX_KEY, JSON.stringify(index));
    return true;
  } catch {
    // Quota pressure: evict the oldest half and retry once.
    const drop = Math.max(1, Math.floor(index.length / 2));
    for (const evicted of index.splice(0, drop)) {
      try {
        storage.removeItem(analysisEntryKey(evicted));
      } catch {
        // no-op
      }
    }
    if (!index.includes(filename)) index.push(filename);
    try {
      write();
      storage.setItem(INDEX_KEY, JSON.stringify(index.slice(-MAX_ENTRIES)));
      return true;
    } catch {
      return false;
    }
  }
}
