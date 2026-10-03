/**
 * EqualizerPanel — per-track EQ controls.
 *
 * AI-agent contract:
 *  - Props: `eqRef` (main track) or `onChange(bands)` / `onPreset(name)` for stems
 *  - Band state is plain JSON, easy to inspect/patch
 *  - Presets: flat / warm / bright / vocalPresence / bassBoost / aiStudio
 */

import React, { useCallback, useState, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { DEFAULT_EQ_PRESETS, type EQBand, EQ_MIN_DB, EQ_MAX_DB } from "../audioEQ";
import { usePanelCollapsed } from "../usePanelCollapsed";

export interface EqualizerPanelProps {
  /** Main track EQ instance, if any. */
  eqRef?: React.MutableRefObject<{ setBands: (bands: EQBand[]) => void; applyPreset: (name: string) => void } | null>;
  /** Controlled band state for stems or external ownership. */
  bands?: EQBand[];
  onChange?: (bands: EQBand[]) => void;
  onPreset?: (name: string) => void;
  presets?: Record<string, EQBand[]>;
  title?: string;
}

const BAND_LABELS = ["Low", "Low Mid", "Mid", "High Mid", "High"];

/** Format a frequency in Hz to a human-friendly short label (e.g. 80 → "80", 1000 → "1k", 12000 → "12k"). */
function fmtFreq(hz: number): string {
  if (hz >= 10000) return `${(hz / 1000).toFixed(0)}k`;
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}k`;
  return `${hz}`;
}

/** Derive a descriptive label for a band from its config.
 *  Falls back to the positional `BAND_LABELS[idx]` for presets whose IDs
 *  don't match a known pattern. */
function bandLabel(band: EQBand, _idx: number): string {
  if (band.id) {
    const map: Record<string, string> = {
      sub: "Sub",
      low: "Low",
      lowMid: "Low Mid",
      mid: "Mid",
      highMid: "High Mid",
      presence: "Presence",
      air: "Air",
      high: "High",
    };
    if (map[band.id]) return map[band.id];
  }
  // Peaking bands: show center freq; shelves: show cutoff freq.
  const typeLabel = band.type === "peaking" ? "p" : band.type === "lowshelf" ? "LS" : "HS";
  return `${fmtFreq(band.frequency)}${typeLabel}`;
}

export function EqualizerPanel({
  eqRef,
  bands: controlledBands,
  onChange,
  onPreset,
  presets = DEFAULT_EQ_PRESETS,
  title = "EQ",
}: EqualizerPanelProps) {
  const isControlled = controlledBands !== undefined && onChange !== undefined;
  const [internalBands, setInternalBands] = useState<EQBand[]>([]);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const bands = isControlled ? controlledBands : internalBands;
  // Plan 1.2: starts collapsed and remembers open/closed, so MASTER EQ stops
  // owning ~20% of the viewport under the transport on every load.
  const { open: bodyOpen, toggle: toggleBody } = usePanelCollapsed("master-eq");

  const setBands = useCallback(
    (next: EQBand[]) => {
      if (!isControlled) setInternalBands(next);
      onChange?.(next);
      eqRef?.current?.setBands(next);
    },
    [isControlled, onChange, eqRef],
  );

  // Derive active preset name from current band set when it exactly matches
  // a known preset (case-insensitive id+type+freq+Q comparison).
  const detectedPreset = useMemo(() => {
    if (bands.length === 0) return "flat";
    outer: for (const [name, preset] of Object.entries(presets)) {
      if (preset.length !== bands.length) continue;
      for (let i = 0; i < preset.length; i++) {
        const p = preset[i];
        const b = bands[i];
        if (
          p.id !== b.id ||
          p.type !== b.type ||
          p.frequency !== b.frequency ||
          p.Q !== b.Q ||
          p.gain !== b.gain
        ) {
          continue outer;
        }
      }
      return name;
    }
    return null;
  }, [bands, presets]);

  const currentPreset = hasInteracted ? activePreset : (activePreset ?? detectedPreset);

  const presetNames = Object.keys(presets);

  const handleBandChange = useCallback(
    (index: number, patch: Partial<EQBand>) => {
      const next = bands.map((b, i) => (i === index ? { ...b, ...patch } : b));
      setBands(next);
      setActivePreset(null);
      setHasInteracted(true);
    },
    [bands, setBands],
  );

  const handlePreset = useCallback(
    (name: string) => {
      const preset = presets[name];
      if (!preset) return;
      const mapped: EQBand[] = preset.map((b) => ({
        id: b.id,
        type: b.type as EQBand["type"],
        frequency: b.frequency,
        Q: b.Q,
        gain: b.gain,
      }));
      setBands(mapped);
      setActivePreset(name);
      setHasInteracted(true);
      onPreset?.(name);
    },
    [presets, setBands, onPreset],
  );

  const handleReset = useCallback(() => {
    setBands([]);
    setActivePreset(null);
    setHasInteracted(true);
    onPreset?.("flat");
  }, [setBands, onPreset]);

  const handleAddBand = useCallback(() => {
    const next: EQBand[] = [
      ...bands,
      { id: `band_${Date.now()}`, type: "peaking", frequency: 1000, Q: 1, gain: 0 },
    ];
    setBands(next);
    setActivePreset(null);
    setHasInteracted(true);
  }, [bands, setBands]);

  const handleRemoveBand = useCallback(
    (index: number) => {
      const next = bands.filter((_, i) => i !== index);
      setBands(next);
      setHasInteracted(true);
    },
    [bands, setBands],
  );

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3" data-testid="equalizer-panel">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={toggleBody}
          aria-expanded={bodyOpen}
          aria-controls="equalizer-panel-body"
          className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted hover:text-white transition-colors"
        >
          <ChevronDown
            size={12}
            aria-hidden="true"
            className={`transition-transform ${bodyOpen ? "" : "-rotate-90"}`}
          />
          {title}
        </button>
        {bodyOpen && (
          <div className="flex items-center gap-1">
            <button
              onClick={handleReset}
              className="text-[10px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-white"
            >
              Reset
            </button>
            <button
              onClick={handleAddBand}
              className="text-[10px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-white"
            >
              + Band
            </button>
          </div>
        )}
      </div>

      <div id="equalizer-panel-body" hidden={!bodyOpen} className="mt-2">
        {presetNames.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {presetNames.map((name) => {
            const isActive = currentPreset === name;
            return (
              <button
                key={name}
                onClick={() => handlePreset(name)}
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                  isActive
                    ? "bg-violet-500 text-white border-violet-400"
                    : "bg-violet-600/20 hover:bg-violet-600/40 text-violet-200 border-transparent"
                }`}
                aria-pressed={isActive}
                title={isActive ? `${name} (active)` : `Apply ${name} preset`}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      {bands.length === 0 ? (
        <p className="text-[10px] text-muted">Select a preset or add a band to shape tone.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {bands.map((band, idx) => (
            <div key={band.id ?? idx} className="flex items-center gap-2">
              <span className="w-12 text-[10px] text-muted" title={`${band.type} @ ${band.frequency} Hz, Q=${band.Q}`}>
                {bandLabel(band, idx)}
              </span>
              <input
                type="range"
                min={EQ_MIN_DB}
                max={EQ_MAX_DB}
                step={0.5}
                value={band.gain}
                onChange={(e) => handleBandChange(idx, { gain: parseFloat(e.target.value) })}
                className="flex-1 h-1 accent-emerald-400"
                aria-label={`${BAND_LABELS[idx] ?? band.id} gain`}
              />
              <span className="w-10 text-[10px] text-right text-muted">
                {band.gain > 0 ? "+" : ""}
                {band.gain.toFixed(1)} dB
              </span>
              <button
                onClick={() => handleRemoveBand(idx)}
                className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 hover:bg-red-500/20 text-red-300"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
}
