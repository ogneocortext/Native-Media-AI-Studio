import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RemixRecipeSpec } from "../services/api/remix";

/**
 * `pendingTrack` guards every access to `window` and `sessionStorage`, so it works
 * in a node environment - but only by silently returning null, which is exactly
 * the failure mode this test exists to catch. A stub here makes the fallback path
 * unreachable, so a regression in the real storage logic shows up as a failing
 * assertion rather than a test that passes because nothing happened.
 */
function installBrowserStubs(): void {
  const store = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.sessionStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as unknown as Storage;
}

const RECIPE: RemixRecipeSpec = {
  name: "browser-mashup",
  target_bpm: 144,
  beats_per_bar: 4,
  overwrite: true,
  slots: [
    {
      bars: 4,
      crossfade_bars: 2,
      layers: [
        { track: "A", stem: "drums", gain_db: 0, key_shift_semitones: 0, source_start_bar: 0 },
        { track: "A", stem: "bass", gain_db: -3, key_shift_semitones: 0, source_start_bar: 0 },
      ],
    },
  ],
};

/** Clear both the stub storage and the window-slot properties between tests. */
function resetSlots(): void {
  installBrowserStubs();
  const w = globalThis as unknown as Record<string, unknown>;
  delete w.__pendingRemixRecipe;
  delete w.__pendingRemixRecipeSource;
  delete w.__pendingTrackFilename;
}

describe("pendingTrack remix-recipe handoff", () => {
  beforeEach(() => {
    resetSlots();
    vi.resetModules();
  });

  it("returns null when nothing was handed over", async () => {
    const mod = await import("./pendingTrack");
    expect(mod.peekPendingRemixRecipe()).toEqual({ recipe: null, sourceTrack: null });
    expect(mod.consumePendingRemixRecipe().recipe).toBeNull();
  });

  it("round-trips the full recipe, not a summary", async () => {
    // The point of the handoff is to reopen exactly what was rendered. A lossy
    // round-trip (dropping gain_db or source_start_bar) would silently rebuild a
    // different arrangement, so assert the whole object survives.
    const mod = await import("./pendingTrack");
    mod.setPendingRemixRecipe(RECIPE, "track.m4a");
    const { recipe } = mod.consumePendingRemixRecipe();
    expect(recipe).toEqual(RECIPE);
  });

  it("carries the source track alongside the recipe", async () => {
    const mod = await import("./pendingTrack");
    mod.setPendingRemixRecipe(RECIPE, "track.m4a");
    expect(mod.consumePendingRemixRecipe().sourceTrack).toBe("track.m4a");
  });

  it("consumes exactly once", async () => {
    const mod = await import("./pendingTrack");
    mod.setPendingRemixRecipe(RECIPE, "track.m4a");
    expect(mod.consumePendingRemixRecipe().recipe).not.toBeNull();
    // A second consume must be empty: otherwise a remount would re-apply a recipe
    // the user had already edited away.
    expect(mod.consumePendingRemixRecipe().recipe).toBeNull();
  });

  it("peek does not consume", async () => {
    const mod = await import("./pendingTrack");
    mod.setPendingRemixRecipe(RECIPE, "track.m4a");
    expect(mod.peekPendingRemixRecipe().recipe).toEqual(RECIPE);
    expect(mod.consumePendingRemixRecipe().recipe).toEqual(RECIPE);
  });

  it("survives a fresh module load, as a route change does", async () => {
    // sessionStorage is what carries the handoff across navigation, so a
    // window-only implementation would lose the recipe on every route change.
    const first = await import("./pendingTrack");
    first.setPendingRemixRecipe(RECIPE, "track.m4a");
    vi.resetModules();
    const second = await import("./pendingTrack");
    const { recipe, sourceTrack } = second.consumePendingRemixRecipe();
    expect(recipe).toEqual(RECIPE);
    expect(sourceTrack).toBe("track.m4a");
  });

  it("does not clobber the plain pending-track slot", async () => {
    // Both handoffs share the module; one must not evict the other.
    const mod = await import("./pendingTrack");
    mod.setPendingTrack("original.m4a");
    mod.setPendingRemixRecipe(RECIPE, "original.m4a");
    expect(mod.consumePendingRemixRecipe().recipe).toEqual(RECIPE);
    expect(mod.peekPendingTrack()).toBe("original.m4a");
  });

  it("clears the source slot when no track was supplied", async () => {
    const mod = await import("./pendingTrack");
    mod.setPendingRemixRecipe(RECIPE);
    expect(mod.consumePendingRemixRecipe().sourceTrack).toBeNull();
    // A stale source from an earlier handoff must not leak into the next one.
    expect(mod.consumePendingRemixRecipe()).toEqual({ recipe: null, sourceTrack: null });
  });
});
