import { useEffect, useRef, useState } from "react";
import { keyPalette, type ChromaFramesLike, type KeyAnalysisLike, type KeyPalette } from "./keyPalette";

/**
 * How to interpret a `GET /api/audio/analysis/by-filename/{filename}` response.
 *
 * Phase 0.3 of docs/plans/studio-quality-2026-10.md: a 404 here is the *expected*
 * answer for a track nobody has analyzed yet, and it must not be reported as a
 * failure — that is what turned an ordinary "this track needs analyzing" into an
 * error state the UI had to special-case.
 *
 * Extracted as a pure function so it can be unit tested without React or a
 * network, which is the point of the plan's guiding rule #1.
 */
export type AnalysisLookup =
  { kind: "found" } | { kind: "not-analyzed" } | { kind: "error"; status: number };

/** Classify a response status from the analysis endpoint. */
export function classifyAnalysisResponse(status: number): AnalysisLookup {
  if (status === 404) return { kind: "not-analyzed" };
  if (status >= 200 && status < 300) return { kind: "found" };
  return { kind: "error", status };
}

export interface KeyPaletteState {
  palette: KeyPalette;
  /**
   * Tier 2 per-frame chroma track (chroma-hue-mapping.md), or null when the
   * analysis predates it / the track is unanalyzed. Read per frame via
   * `chromaHueAtTime`; never throws on malformed data.
   */
  chromaFrames: ChromaFramesLike | null;
  loading: boolean;
  error: string | null;
  /**
   * The track exists but has never been analyzed (the endpoint 404'd).
   *
   * Distinct from `error`: an unanalyzed track is a normal state that deserves
   * an "Analyze" call to action, whereas `error` means something actually broke.
   * Phase 0.3 of docs/plans/studio-quality-2026-10.md.
   */
  unavailable: boolean;
}

/**
 * Load a track's key analysis and derive its static palette.
 *
 * Mirrors useSpectralTimeline: fetch per track, keep the result in a ref so the
 * rAF loop can read it without re-subscribing. The palette is deliberately
 * static per track - it is set once before playback and does not vary per frame,
 * which is why it costs nothing at render time.
 *
 * Any failure resolves to the neutral fallback rather than throwing. The
 * deterministic-fallback contract (Q2/Q5) says a track with no usable key still
 * has to render.
 */
// Module-level cache for successful lookups only. A 404 ("not analyzed") is
// deliberately NOT cached — the user can analyze the track and come back, and
// a stale "unavailable" would hide the new key. Errors aren't cached either.
const paletteCache = new Map<
  string,
  { palette: KeyPalette; unavailable: boolean; chromaFrames: ChromaFramesLike | null }
>();
const inflight = new Map<string, Promise<KeyAnalysisLike | null>>();

export function useKeyPalette(filename: string | null): KeyPaletteState {
  const [palette, setPalette] = useState<KeyPalette>({
    hue: 0,
    saturation: 0.08,
    confidence: 0,
    fallback: true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [chromaFrames, setChromaFrames] = useState<ChromaFramesLike | null>(null);
  // Holds the last good hue so a subsequent fallback holds the palette steady
  // instead of snapping to red between tracks.
  const lastHueRef = useRef<number | null>(null);

  useEffect(() => {
    if (!filename) {
      const next = keyPalette(null, lastHueRef.current);
      lastHueRef.current = next.hue;
      setPalette(next);
      setChromaFrames(null);
      setUnavailable(false);
      return;
    }

    const hit = paletteCache.get(filename);
    if (hit) {
      lastHueRef.current = hit.palette.hue;
      setPalette(hit.palette);
      setChromaFrames(hit.chromaFrames);
      setUnavailable(hit.unavailable);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const encoded = encodeURIComponent(filename);
    let promise = inflight.get(filename);
    if (!promise) {
      promise = fetch(`/api/audio/analysis/by-filename/${encoded}`)
        .then(async (res) => {
          // A 404 is the expected answer for an unanalyzed track, not a failure.
          const outcome = classifyAnalysisResponse(res.status);
          if (outcome.kind === "error") {
            throw new Error(`Failed to fetch analysis: ${outcome.status}`);
          }
          if (outcome.kind === "not-analyzed") return null;
          return res.json() as Promise<KeyAnalysisLike>;
        })
        .finally(() => inflight.delete(filename));
      inflight.set(filename, promise);
    }
    promise
      .then((data: KeyAnalysisLike | null) => {
        if (cancelled) return;
        // Either way we resolve a usable palette: the analyzed one, or the
        // neutral fallback. A track with no analysis must still render.
        const next = keyPalette(data, lastHueRef.current);
        lastHueRef.current = next.hue;
        setPalette(next);
        const frames = data?.chroma_frames ?? null;
        setChromaFrames(frames);
        setUnavailable(data === null);
        // Only cache palettes fully determined by the analysis. A found-but-
        // low-confidence result still blends lastHueRef (session state), and
        // 404s must stay live so a later analysis is picked up.
        if (data !== null && !next.fallback) {
          paletteCache.set(filename, {
            palette: next,
            unavailable: false,
            chromaFrames: frames,
          });
        }
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        // A genuine failure (network down, 500): fall back to the neutral
        // palette so the scene keeps rendering, and surface it.
        const next = keyPalette(null, lastHueRef.current);
        lastHueRef.current = next.hue;
        setPalette(next);
        setChromaFrames(null);
        setUnavailable(false);
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filename]);

  return { palette, chromaFrames, loading, error, unavailable };
}
