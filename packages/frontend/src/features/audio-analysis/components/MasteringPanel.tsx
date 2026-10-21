/**
 * MasteringPanel — loudness normalization + true-peak limiter with QC report.
 *
 * Purpose: master a library track to a delivery loudness target (Spotify
 * -14, Apple -16, Competitive -11, Amazon -2 LUFS) with optional static tone
 * fixes (de-mud high-pass + gentle presence) and true-peak limiting.
 *
 * The panel measures the source (LUFS / true peak / LRA), applies gain to
 * hit the target, true-peak-limits below the ceiling, writes a mastered copy
 * under output/audio/mastered/, then re-measures the written artifact for a
 * before/after QC report (D17: assert the artifact, not the intent).
 *
 * Audio-library rule (AGENTS.md D16): this panel reads the track list from
 * useAudioLibrary() only. Do NOT call listAudioFiles() here — that function
 * has exactly one caller (the store).
 *
 * Backend endpoints (see services/api/audio.ts):
 *   POST /api/audio/master     — master a file, returns before/after QC report
 *   GET  /api/audio/master/measure/{filename} — measurement-only preview
 *
 * True-peak ceiling default -1 dBTP. Gain is clamped ±12 dB to avoid runaway
 * boost on silent or extreme tracks. Tone fixes are conservative: a static
 * de-mud wide cut (~300 Hz) plus a gentle presence shelf (~4 kHz).
 */

import { useState, useCallback, useMemo } from "react";
import {
  MASTER_TARGETS,
  type MasterTarget,
  measureMasterLoudness,
  masterAudio,
  type MasterResponse,
  type MasterMeasureResponse,
} from "../../../services/api";
import { useAudioLibrary } from "../../../hooks/useAudioLibrary";
import { DS } from "../../../styles/designSystem";
import { AlertCircle, Download, Loader2, Music, Play, Zap, Volume2 } from "lucide-react";

const MASTER_TARGET_CHIPS: MasterTarget[] = ["spotify", "apple", "competitive", "amazon"];

interface MasteringPanelProps {
  /** Optional callback fired when a mastered file is produced, with its path. */
  onMastered?: (masteredPath: string) => void;
}

export function MasteringPanel({ onMastered }: MasteringPanelProps) {
  const {
    entries: tracks,
    isLoading: libraryLoading,
  } = useAudioLibrary();

  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [target, setTarget] = useState<MasterTarget>("spotify");
  const [ceilingDb, setCeilingDb] = useState(-1);
  const [gainDb, setGainDb] = useState<number | null>(null);
  const [toneFixes, setToneFixes] = useState(true);

  const [measuring, setMeasuring] = useState(false);
  const [mastering, setMastering] = useState(false);
  const [before, setBefore] = useState<MasterMeasureResponse | null>(null);
  const [result, setResult] = useState<MasterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const track = useMemo(() => tracks.find((t) => t.filename === selectedTrack), [
    tracks,
    selectedTrack,
  ]);

  const handleMeasure = useCallback(async () => {
    if (!selectedTrack) return;
    setMeasuring(true);
    setError(null);
    try {
      const m = await measureMasterLoudness(selectedTrack);
      if (m.error) {
        setError(m.error);
        return;
      }
      setBefore(m);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Measure failed");
    } finally {
      setMeasuring(false);
    }
  }, [selectedTrack]);

  const handleMaster = useCallback(async () => {
    if (!selectedTrack) return;
    setMastering(true);
    setError(null);
    try {
      const res = await masterAudio({
        filename: selectedTrack,
        target_lufs: target,
        ceiling_dbtp: ceilingDb,
        tone_fixes: toneFixes,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setResult(res);
      onMastered?.(res.mastered_path ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Master failed");
    } finally {
      setMastering(false);
    }
  }, [selectedTrack, target, ceilingDb, toneFixes, onMastered]);

  const reset = useCallback(() => {
    setBefore(null);
    setResult(null);
    setError(null);
  }, []);

  const hasResult = result?.mastered_path != null;

  return (
    <section className={`${DS.card} border-violet-500/20 bg-gradient-to-br from-violet-500/5 to-transparent space-y-4`}>
      <div className={DS.flexBetween}>
        <div className={DS.flexCenter}>
          <Music size={18} className="text-violet-400 shrink-0" />
          <span className={DS.textBoldLg}>Mastering</span>
        </div>
        {libraryLoading ? (
          <Loader2 size={14} className="animate-spin text-muted" />
        ) : null}
      </div>
      <p className={DS.textXs + " mb-3 text-gray-400"}>
        Normalize loudness to a delivery target, true-peak limit, then export
        a mastered copy with a before/after QC report.
      </p>

      {/* Track selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className={DS.textLabel}>Track</label>
          <select
            value={selectedTrack ?? ""}
            onChange={(e) => {
              setSelectedTrack(e.target.value || null);
              reset();
            }}
            disabled={libraryLoading || tracks.length === 0}
            className={DS.select}
            aria-label="Mastering track"
          >
            <option value="">— select a track —</option>
            {tracks.map((t) => (
              <option key={t.filename} value={t.filename}>
                {t.optionLabel ?? t.filename}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            onClick={handleMeasure}
            disabled={measuring || !selectedTrack}
            className={`${DS.btnSecondarySm} ${
              measuring ? "opacity-60 cursor-not-allowed" : ""
            }`}
            aria-busy={measuring}
            title="Measure loudness (LUFS / true peak / LRA) without writing"
          >
            {measuring ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            Measure
          </button>
        </div>
      </div>

      {track && (
        <>
          {/* Target + ceiling + tone controls */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-2">
              <label className={DS.textLabel}>Target loudness</label>
              <div className="flex flex-wrap gap-1">
                {MASTER_TARGET_CHIPS.map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setTarget(t);
                      reset();
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      target === t
                        ? "bg-violet-500/20 border-violet-500 text-violet-300"
                        : "bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600"
                    }`}
                    aria-pressed={target === t}
                    role="switch"
                  >
                    {t} {MASTER_TARGETS[t]} LUFS
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className={DS.textLabel}>
                True-peak ceiling ({ceilingDb} dBTP)
              </label>
              <input
                type="range"
                min="-6"
                max="-0.5"
                step="0.5"
                value={ceilingDb}
                onChange={(e) => setCeilingDb(parseFloat(e.target.value))}
                className={DS.range}
                aria-label="True-peak ceiling"
              />
            </div>
            <div className="flex items-end space-y-2">
              <label className={DS.textLabel + " flex items-center gap-1 cursor-pointer select-none"}>
                <input
                  type="checkbox"
                  checked={toneFixes}
                  onChange={() => setToneFixes(!toneFixes)}
                  className="rounded border-gray-600 bg-gray-700 text-violet-500 focus:ring-violet-500"
                />
                Tone fixes (de-mud + presence)
              </label>
              <span className={DS.textXs + " text-gray-500"}>
                ~300 Hz HPF + 4 kHz shelf
              </span>
            </div>
          </div>

          {/* Manual gain override */}
          <div className="space-y-2">
            <label className={DS.textLabel + " flex items-center justify-between"}>
              <span>Manual gain override ({gainDb ?? "auto"} dB)</span>
              <button
                onClick={() => setGainDb(null)}
                className={DS.btnGhostSm}
                disabled={gainDb == null}
                title="Reset to auto gain"
              >
                reset
              </button>
            </label>
            <input
              type="range"
              min="-12"
              max="12"
              step="1"
              value={gainDb ?? 0}
              onChange={(e) => setGainDb(parseFloat(e.target.value))}
              className={DS.range}
              disabled={gainDb == null}
              aria-label="Manual gain override"
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleMaster}
              disabled={mastering || !selectedTrack || !before}
              className={`${DS.btnPrimary} ${
                mastering || !selectedTrack || !before
                  ? "opacity-60 cursor-not-allowed"
                  : ""
              } w-full`}
              aria-busy={mastering}
              title="Apply gain/tone/limit and write mastered copy"
            >
              {mastering ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Mastering…
                </>
              ) : (
                <>
                  <Play size={16} /> Master & Export
                </>
              )}
            </button>
          </div>

          {/* QC report */}
          {before || result ? (
            <div className={DS.cardTight + " border-gray-600/50 bg-gray-900/20"}>
              <h3 className={DS.sectionTitle}>
                <Volume2 size={14} className="text-muted shrink-0" />
                QC report
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className={DS.statCard + " border-gray-600/30"}>
                  <p className={DS.statLabel}>Before — integrated</p>
                  <p className={DS.statValue}>
                    {before?.integrated_lufs != null
                      ? before.integrated_lufs.toFixed(1) + " LUFS"
                      : "—"}
                  </p>
                  <p className={DS.statSub}>
                    TP {before?.true_peak_dbtp != null ? before.true_peak_dbtp.toFixed(1) : "—"} dBTP
                  </p>
                </div>
                <div className={DS.statCard + " border-green-500/30 bg-green-500/5"}>
                  <p className={DS.statLabel}>After — integrated</p>
                  <p className={DS.statValue}>
                    {result?.after?.integrated_lufs != null
                      ? result.after.integrated_lufs.toFixed(1) + " LUFS"
                      : "—"}
                  </p>
                  <p className={DS.statSub}>
                    TP {result?.after?.true_peak_dbtp != null ? result.after.true_peak_dbtp.toFixed(1) : "—"} dBTP
                  </p>
                </div>
              </div>
              {result?.applied && (
                <div className="mt-3 flex gap-3 text-xs text-muted">
                  <span>Gain {result.applied.gain_db >= 0 ? "+" : ""}{result.applied.gain_db.toFixed(1)} dB</span>
                  <span>· Target {result.applied.target_lufs} LUFS</span>
                  <span>· Ceiling {result.applied.ceiling_dbtp} dBTP</span>
                  <span>· Tone {result.applied.tone_fixes ? "on" : "off"}</span>
                </div>
              )}
              <div className="mt-3 flex gap-2">
                {hasResult && result.mastered_path && (
                  <a
                    href={`${window.location.origin}/api/audio/file/mastered/${encodeURIComponent(result.mastered_path.split("/").pop() ?? "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={DS.btnSecondarySm}
                  >
                    <Download size={14} /> Open mastered
                  </a>
                )}
                <button
                  onClick={reset}
                  className={DS.btnSecondarySm}
                  title="Clear QC report"
                >
                  Clear
                </button>
              </div>
            </div>
          ) : null}

          {error && (
            <div className={DS.cardError} role="alert">
              <AlertCircle size={16} />
              <span className="text-sm">{error}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
