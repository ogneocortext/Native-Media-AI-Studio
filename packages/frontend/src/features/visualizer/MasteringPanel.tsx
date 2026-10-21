/**
 * Mastering panel — measures loudness and masters library tracks to a
 * delivery loudness target (Spotify / Apple / Competitive / Amazon).
 *
 * Backend: POST /api/audio/master, GET /api/audio/master/measure/{filename}
 * (implemented in packages/backend/app/api/audio_mastering.py +
 * packages/backend/app/services/mastering.py).
 *
 * Per AGENTS.md D16, track selection goes through useAudioLibrary() — the
 * store deduplicates and tags names; the panel renders optionLabel and never
 * re-derives track names with a local regex.
 */

import { useCallback, useState } from "react";
import {
  measureMasterLoudness,
  masterAudio,
  type MasterMeasureResponse,
  type MasterResponse,
} from "../../services/api/audio";
import { useAudioLibrary } from "../../hooks/useAudioLibrary";
import { audioEntryLabel } from "../../state/audioNaming";

interface MasteringPanelProps {
  /** Optional initial track filename to select. */
  initialFilename?: string;
}

export function MasteringPanel({ initialFilename }: MasteringPanelProps = {}) {
  const { entries, isLoading: libLoading, error: libError, refresh } =
    useAudioLibrary();

  const [selectedRef, setSelectedRef] = useState<string | undefined>(
    initialFilename,
  );
  const [measuring, setMeasuring] = useState(false);
  const [mastering, setMastering] = useState(false);
  const [measurement, setMeasurement] = useState<MasterMeasureResponse | null>(
    null,
  );
  const [result, setResult] = useState<MasterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedEntry = entries.find((e) => e.ref === selectedRef);

  const handleSelect = useCallback(
    (ref: string) => {
      setSelectedRef(ref);
      setMeasurement(null);
      setResult(null);
      setError(null);
    },
    [],
  );

  const handleMeasure = useCallback(async () => {
    if (!selectedRef) return;
    setMeasuring(true);
    setError(null);
    try {
      const m = await measureMasterLoudness(selectedRef);
      setMeasurement(m);
      if (m.error) setError(m.error);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to measure loudness",
      );
    } finally {
      setMeasuring(false);
    }
  }, [selectedRef]);

  const handleMaster = useCallback(async () => {
    if (!selectedRef) return;
    setMastering(true);
    setError(null);
    try {
      const r = await masterAudio({
        filename: selectedRef,
        target_lufs: "spotify",
        ceiling_dbtp: -1,
        tone_fixes: true,
        gain_trim_db: 0,
      });
      setResult(r);
      if (r.error && !r.mastered_path) setError(r.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to master audio");
    } finally {
      setMastering(false);
    }
  }, [selectedRef]);

  const handleDownload = useCallback(() => {
    if (!result?.mastered_path) return;
    // mastered_path is an absolute server path like
    // .../output/audio/mastered/<stem>_mastered.mp3.
    // The download route serves /api/audio/file/<relative-to-audio-dir>.
    const audioMarker = "/audio/";
    const idx = result.mastered_path.indexOf(audioMarker);
    if (idx === -1) {
      setError("Cannot build download URL from mastered path");
      return;
    }
    const relative = result.mastered_path.slice(idx + audioMarker.length);
    const url = `/api/audio/file/${encodeURIComponent(relative)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = result.mastered_path.split(/[\\/]/).pop()!;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [result]);

  if (libLoading) {
    return (
      <div className="mastering-panel">
        <p className="text-muted-foreground">Loading audio library…</p>
      </div>
    );
  }
  if (libError) {
    return (
      <div className="mastering-panel">
        <p className="text-destructive">{libError}</p>
        <button
          className="kt-button"
          onClick={refresh}
          disabled={libLoading}
        >
          Retry
        </button>
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="mastering-panel">
        <p className="text-muted-foreground">
          No audio tracks in the library. Upload a track first.
        </p>
      </div>
    );
  }

  return (
    <div className="mastering-panel">
      <h2 className="mastering-panel-title">Mastering</h2>

      <div className="mastering-track-select">
        <label htmlFor="mastering-track">Track</label>
        <select
          id="mastering-track"
          value={selectedRef ?? ""}
          onChange={(e) => handleSelect(e.target.value)}
          disabled={measuring || mastering}
        >
          <option value="">— Select a track —</option>
          {entries.map((entry) => (
            <option key={entry.ref} value={entry.ref}>
              {entry.optionLabel}
            </option>
          ))}
        </select>
        {selectedEntry && (
          <span className="mastering-track-hint">
            {audioEntryLabel(selectedEntry)}
          </span>
        )}
      </div>

      <div className="mastering-actions">
        <button
          className="kt-button kt-button-secondary"
          onClick={handleMeasure}
          disabled={!selectedRef || measuring || mastering}
        >
          {measuring ? "Measuring…" : "Measure loudness"}
        </button>
        <button
          className="kt-button"
          onClick={handleMaster}
          disabled={
            !selectedRef || measuring || mastering || !!result?.mastered_path
          }
        >
          {mastering ? "Mastering…" : "Master to Spotify (-14 LUFS)"}
        </button>
      </div>

      {error && (
        <div className="mastering-error">{error}</div>
      )}

      {measurement && (
        <div className="mastering-measurement">
          <h3 className="mastering-section-title">Before (measured)</h3>
          <MasterValues m={measurement} />
        </div>
      )}

      {result && (
        <div className="mastering-result">
          <h3 className="mastering-section-title">After (mastered)</h3>
          <MasterValues m={result.after} />
          {result.applied && (
            <div className="mastering-applied">
              <p>
                Gain: {result.applied.gain_db} dB &nbsp;|&nbsp;
                Ceiling: {result.applied.ceiling_dbtp} dBTP &nbsp;|&nbsp;
                Passes: {result.applied.gain_passes}
              </p>
            </div>
          )}
          {result.mastered_path && (
            <button className="kt-button" onClick={handleDownload}>
              Download mastered
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MasterValues({ m }: { m: MasterMeasureResponse | null }) {
  if (!m) return null;
  const lufs = m.integrated_lufs ?? null;
  const peak = m.true_peak_dbtp ?? null;
  const lra = m.lra_lu ?? null;
  return (
    <div className="mastering-values">
      {lufs !== null && (
        <span className="mastering-value">
          LUFS: <span className="mastering-value-number">{lufs.toFixed(1)}</span>
        </span>
      )}
      {peak !== null && (
        <span className="mastering-value">
          True Peak:{" "}
          <span className="mastering-value-number">{peak.toFixed(1)} dBTP</span>
        </span>
      )}
      {lra !== null && (
        <span className="mastering-value">
          LRA: <span className="mastering-value-number">{lra.toFixed(1)} LU</span>
        </span>
      )}
      {m.error && <span className="mastering-value mastering-value-error">{m.error}</span>}
    </div>
  );
}
