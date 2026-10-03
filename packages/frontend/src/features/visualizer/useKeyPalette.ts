import { useEffect, useRef, useState } from "react";
import { keyPalette, type KeyAnalysisLike, type KeyPalette } from "./keyPalette";

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
  | { kind: "found" }
  | { kind: "not-analyzed" }
  | { kind: "error"; status: number };

/** Classify a response status from the analysis endpoint. */
export function classifyAnalysisResponse(status: number): AnalysisLookup {
  if (status === 404) return { kind: "not-analyzed" };
  if (status >= 200 && status < 300) return { kind: "found" };
  return { kind: "error", status };
}

export interface KeyPaletteState {
  palette: KeyPalette;
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
export function useKeyPalette(filename: string | null): KeyPaletteState {
  const [palette, setPalette] = useState<KeyPalette>({ hue: 0, saturation: 0.08, confidence: 0, fallback: true });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  // Holds the last good hue so a subsequent fallback holds the palette steady
  // instead of snapping to red between tracks.
  const lastHueRef = useRef<number | null>(null);

  useEffect(() => {
    if (!filename) {
      const next = keyPalette(null, lastHueRef.current);
      lastHueRef.current = next.hue;
      setPalette(next);
      setUnavailable(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const encoded = encodeURIComponent(filename);
    fetch(`/api/audio/analysis/by-filename/${encoded}`)
      .then((res) => {
        // A 404 is the expected answer for an unanalyzed track, not a failure.
        const outcome = classifyAnalysisResponse(res.status);
        if (outcome.kind === "error") {
          throw new Error(`Failed to fetch analysis: ${outcome.status}`);
        }
        if (outcome.kind === "not-analyzed") return null;
        return res.json();
      })
      .then((data: KeyAnalysisLike | null) => {
        if (cancelled) return;
        // Either way we resolve a usable palette: the analyzed one, or the
        // neutral fallback. A track with no analysis must still render.
        const next = keyPalette(data, lastHueRef.current);
        lastHueRef.current = next.hue;
        setPalette(next);
        setUnavailable(data === null);
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
        setUnavailable(false);
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filename]);

  return { palette, loading, error, unavailable };
}