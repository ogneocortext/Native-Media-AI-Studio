import { useEffect, useRef, useState } from "react";
import { keyPalette, type KeyAnalysisLike, type KeyPalette } from "./keyPalette";

export interface KeyPaletteState {
  palette: KeyPalette;
  loading: boolean;
  error: string | null;
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
  // Holds the last good hue so a subsequent fallback holds the palette steady
  // instead of snapping to red between tracks.
  const lastHueRef = useRef<number | null>(null);

  useEffect(() => {
    if (!filename) {
      const next = keyPalette(null, lastHueRef.current);
      lastHueRef.current = next.hue;
      setPalette(next);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const encoded = encodeURIComponent(filename);
    fetch(`/api/audio/analysis/by-filename/${encoded}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch analysis: ${res.status}`);
        return res.json();
      })
      .then((data: KeyAnalysisLike) => {
        if (cancelled) return;
        const next = keyPalette(data, lastHueRef.current);
        lastHueRef.current = next.hue;
        setPalette(next);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        // Fallback, not an error state the visualizer has to handle: the
        // neutral palette keeps the scene rendering.
        const next = keyPalette(null, lastHueRef.current);
        lastHueRef.current = next.hue;
        setPalette(next);
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filename]);

  return { palette, loading, error };
}