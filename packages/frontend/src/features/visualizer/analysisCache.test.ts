import { describe, expect, it, beforeEach } from "vitest";
import {
  analysisEntryKey,
  loadCachedAnalyses,
  saveCachedAnalysis,
  type AnalysisCacheStorage,
} from "./analysisCache";
import type { AudioAnalysisData } from "./types";

function fakeStorage(): AnalysisCacheStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function analysisFixture(): AudioAnalysisData {
  return {
    tempo_bpm: 128,
    beat_count: 2,
    beat_times: [0.5, 1.0],
    onset_times: [],
    energy_curve: [0.1, 0.9],
    amplitude_envelope: [],
    sections: [],
    confidence: 0.8,
    duration_seconds: 3.5,
  };
}

describe("analysisCache", () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
  });

  it("round-trips a saved analysis", () => {
    const a = analysisFixture();
    expect(saveCachedAnalysis("track.mp3", a, storage)).toBe(true);
    const loaded = loadCachedAnalyses(storage);
    expect(loaded["track.mp3"]).toEqual(a);
  });

  it("keys entries per filename so slashes survive", () => {
    saveCachedAnalysis("Suno-V6-Mini/song.m4a", analysisFixture(), storage);
    expect(analysisEntryKey("Suno-V6-Mini/song.m4a")).toContain(
      encodeURIComponent("Suno-V6-Mini/song.m4a"),
    );
    expect(loadCachedAnalyses(storage)["Suno-V6-Mini/song.m4a"]).toBeDefined();
  });

  it("returns {} when storage is unavailable or empty", () => {
    expect(loadCachedAnalyses(null)).toEqual({});
    expect(loadCachedAnalyses(storage)).toEqual({});
  });

  it("drops corrupt entries and prunes the index", () => {
    saveCachedAnalysis("good.mp3", analysisFixture(), storage);
    saveCachedAnalysis("bad.mp3", analysisFixture(), storage);
    storage.data.set(analysisEntryKey("bad.mp3"), "{not json");
    const loaded = loadCachedAnalyses(storage);
    expect(loaded["good.mp3"]).toBeDefined();
    expect(loaded["bad.mp3"]).toBeUndefined();
    const indexRaw = storage.data.get("nma.viz.analysis.index");
    expect(indexRaw).toBeDefined();
    const index = JSON.parse(indexRaw ?? "[]") as string[];
    expect(index).toEqual(["good.mp3"]);
  });

  it("drops entries with the wrong cache version", () => {
    saveCachedAnalysis("old.mp3", analysisFixture(), storage);
    const key = analysisEntryKey("old.mp3");
    const entryRaw = storage.data.get(key);
    expect(entryRaw).toBeDefined();
    const entry = JSON.parse(entryRaw ?? "{}") as { v?: number };
    entry.v = 999;
    storage.data.set(key, JSON.stringify(entry));
    expect(loadCachedAnalyses(storage)["old.mp3"]).toBeUndefined();
  });

  it("drops entries that fail the shape check", () => {
    saveCachedAnalysis("shapeless.mp3", { foo: 1 } as unknown as AudioAnalysisData, storage);
    // saveCachedAnalysis refuses non-analysis payloads up front
    expect(loadCachedAnalyses(storage)["shapeless.mp3"]).toBeUndefined();
  });

  it("evicts the oldest entries beyond MAX_ENTRIES", () => {
    for (let i = 0; i < 12; i++) {
      saveCachedAnalysis(`t${i}.mp3`, analysisFixture(), storage);
    }
    const loaded = loadCachedAnalyses(storage);
    expect(Object.keys(loaded)).toHaveLength(10);
    expect(loaded["t0.mp3"]).toBeUndefined();
    expect(loaded["t1.mp3"]).toBeUndefined();
    expect(loaded["t11.mp3"]).toBeDefined();
  });

  it("re-saving a filename moves it to most-recent", () => {
    for (let i = 0; i < 10; i++) saveCachedAnalysis(`t${i}.mp3`, analysisFixture(), storage);
    saveCachedAnalysis("t0.mp3", analysisFixture(), storage); // refresh → newest
    saveCachedAnalysis("new.mp3", analysisFixture(), storage); // pushes t1 out
    const loaded = loadCachedAnalyses(storage);
    expect(loaded["t0.mp3"]).toBeDefined();
    expect(loaded["t1.mp3"]).toBeUndefined();
    expect(loaded["new.mp3"]).toBeDefined();
  });

  it("returns false on storage failure instead of throwing", () => {
    const broken: AnalysisCacheStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        /* quota-failure stub: removals are best-effort */
      },
    };
    expect(saveCachedAnalysis("x.mp3", analysisFixture(), broken)).toBe(false);
    expect(loadCachedAnalyses(broken)).toEqual({});
  });
});
