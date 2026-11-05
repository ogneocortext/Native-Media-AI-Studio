/**
 * StemMixer — per-stem audio loading, mixing, and level metering.
 *
 * Implements the documented-but-missing per-stem visual mapping from
 * ai-video-trends-2026.md Trend 2 (Music-Native Models):
 *   "per-stem mapping: drums→scale/pulse, bass→camera shake/ground contact,
 *    vocals→lyric kinetic, harmony/chroma→palette shift, onsets→cut triggers."
 *
 * Fetches separated stems from the backend (GET /api/audio/stems/{file},
 * GET /api/audio/stem-file/...), decodes them with WebAudio, and exposes
 * per-stem RMS levels each frame so the visualizer can drive independent
 * visual channels.
 *
 * The audio graph, fader state and separation flow live in ./useStemMixer;
 * this file is the panel view over that hook.
 */

import React, { useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { enhanceStems } from "../../../services/api";
import { DEFAULT_EQ_PRESETS } from "../audioEQ";
import { usePanelCollapsed } from "../usePanelCollapsed";
import { friendlyPipelineError, SEPARATION_FAILED_HEADLINE } from "../../../utils/errorCopy";
import {
  FADER_MAX_DB,
  FADER_MIN_DB,
  MIX_PRESET_LABELS,
  MIX_PRESET_ORDER,
  STEM_NAMES,
  formatDb,
  type StemName,
} from "../stems/stemMixPresets";
import { STEM_BY_KEY, STEM_CATEGORIES } from "../stems/stemConfig";
import { useStemMixer, type StemMixerProps } from "./useStemMixer";

// Re-exported so existing importers (viz-styles/helpers.ts, the Visualizer) keep
// working against the single canonical list. This array was previously declared
// here and duplicated from the backend's STEM_NAMES.
export { STEM_NAMES } from "../stems/stemMixPresets";
export type { StemName } from "../stems/stemMixPresets";
export { useStemMixer } from "./useStemMixer";
export type { StemMixerProps, StemLevels, StemQuality } from "./useStemMixer";

/** Documented visual channel per stem (Trend 2 mapping), derived from the
 *  shared stem config so the role text stays in sync with the stem definitions. */
export const STEM_VISUAL_ROLE: Record<StemName, string> = Object.fromEntries(
  STEM_NAMES.map((n) => [n, STEM_BY_KEY[n].role]),
) as Record<StemName, string>;


export function StemMixerPanel({
  audioFilename,
  compact = false,
  onStateChange,
  sharedAudioContext,
  mainAudioRef,
  mainGainRef,
  eqPresets,
  separationMode = "single",
  onSeparationModeChange,
  segmentSize = 10,
  onSegmentSizeChange,
  vocalExpander = false,
  onVocalExpanderChange,
  vocalBalanceDb = 0,
  onVocalBalanceDbChange,
}: StemMixerProps) {
  const {
    status,
    error,
    volumes,
    gainsDb,
    mixPreset,
    muted,
    eqBands,
    stemQuality,
    setVolumeDb,
    resetStem,
    applyPreset,
    resetGains,
    toggleMute,
    setStemEQ,
    ensureStems,
    syncTransport,
  } = useStemMixer({
    audioFilename,
    sharedAudioContext,
    mainAudioRef,
    mainGainRef,
    onStateChange,
    eqPresets,
  });

  useEffect(() => {
    onStateChange?.({ muted, volumes, eqBands });
  }, [muted, volumes, eqBands, onStateChange]);

  useEffect(() => {
    if (!syncTransport) return;
    // 500 ms interval sync — seeking is expensive (re-buffers the element),
    // so checking every frame caused audible skipping. 500 ms is frequent
    // enough to catch drift before it becomes noticeable.
    const id = setInterval(() => {
      const main =
        mainAudioRef?.current ??
        document.querySelector<HTMLAudioElement>("audio[data-main-player]");
      syncTransport(main);
    }, 500);
      return () => clearInterval(id);
    }, [syncTransport, mainAudioRef]);

  // Plan 1.2: starts collapsed and remembers open/closed. The header stays
  // visible while collapsed so "separating…" progress is never hidden — the
  // body below is what yields the viewport back to the canvas.
  const { open: bodyOpen, toggle: toggleBody } = usePanelCollapsed("stem-mixer");

  // Plan 0.1 UI: a bare Python exception must never be the panel state —
  // friendly headline, raw message behind a disclosure.
  const friendlyError = friendlyPipelineError(error, SEPARATION_FAILED_HEADLINE);

  if (!audioFilename) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3" data-testid="stem-mixer">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={toggleBody}
          aria-expanded={bodyOpen}
          aria-controls="stem-mixer-body"
          className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted hover:text-white transition-colors"
        >
          <ChevronDown
            size={12}
            aria-hidden="true"
            className={`transition-transform ${bodyOpen ? "" : "-rotate-90"}`}
          />
          Stem Mixer
        </button>
        {status === "ready" ? (
          <span className="text-[10px] text-emerald-400">4 stems ready</span>
        ) : status === "checking" ? (
          <span className="text-[10px] text-amber-400 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            checking…
          </span>
        ) : status === "separating" ? (
          <span className="text-[10px] text-amber-400 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            separating…
          </span>
        ) : status === "error" ? (
          <span className="text-[10px] text-red-400" title={error ?? undefined}>
            unavailable
          </span>
        ) : null}
        {Object.values(stemQuality).some((q) => q.warning) && (
          <span className="text-[10px] text-amber-300 ml-2" title={Object.values(stemQuality).map((q) => q.warning).filter(Boolean).join(" • ")}>
            ⚠ stem bleed
          </span>
        )}
      </div>

      <div id="stem-mixer-body" hidden={!bodyOpen} className="mt-2">
      {status === "idle" && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <label className="text-[10px] text-muted uppercase tracking-wider">Mode</label>
            <select
              value={separationMode}
              onChange={(e) => onSeparationModeChange?.(e.target.value as "single" | "hierarchical")}
              className="text-[11px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-white"
            >
              <option value="single">Single-pass</option>
              <option value="hierarchical">Hierarchical (UVR5)</option>
            </select>
            <label className="text-[10px] text-muted uppercase tracking-wider">Segment</label>
            <select
              value={segmentSize}
              onChange={(e) => onSegmentSizeChange?.(Number(e.target.value))}
              className="text-[11px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-white"
            >
              <option value={5}>5 s (fast, 8 GB)</option>
              <option value={10}>10 s (balanced)</option>
              <option value={20}>20 s (pristine)</option>
            </select>
          </div>
          <button
            onClick={ensureStems}
            className="w-full py-2 text-xs rounded-lg bg-violet-600/80 hover:bg-violet-500 text-white transition-colors"
          >
            Load Stems (vocals / drums / bass / other)
          </button>
        </div>
      )}

      {(status === "checking" || status === "separating") && (
        <div className="py-2">
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-amber-400/40 border-t-amber-400 animate-spin" />
            {status === "checking"
              ? "Looking for existing stems…"
              : "Separating stems with Demucs — this can take a minute…"}
          </div>
          <div className="mt-2 h-1 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full w-1/3 rounded-full bg-amber-400/60 animate-pulse" />
          </div>
        </div>
      )}

      {status === "ready" && (
        <div className="flex flex-wrap gap-2 mb-2">
          <EnhanceButton
            filename={audioFilename}
            vocalExpander={vocalExpander}
            onVocalExpanderChange={onVocalExpanderChange}
            vocalBalanceDb={vocalBalanceDb}
            onVocalBalanceDbChange={onVocalBalanceDbChange}
          />
        </div>
      )}

      {status === "error" && (
        <div className="py-2 space-y-2">
          <p className="text-[11px] text-red-300/80 leading-relaxed">{friendlyError.headline}</p>
          {friendlyError.detail && (
            <details className="group">
              <summary className="text-[10px] text-muted cursor-pointer hover:text-white select-none">
                Show details
              </summary>
              <p className="mt-1 text-[10px] text-red-400/70 break-all whitespace-pre-wrap">
                {friendlyError.detail}
              </p>
            </details>
          )}
          <button
            onClick={ensureStems}
            className="w-full py-1.5 text-[11px] rounded-lg bg-white/5 hover:bg-white/10 text-white transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {status === "ready" && (
        <div className={compact ? "grid grid-cols-2 gap-2" : "space-y-2"}>
          {/* Macro preset pill — the brief's substitute for an "Advanced" drawer.
              One control moves all four faders, which is what a non-engineer
              actually reaches for. */}
              <div className="flex items-center gap-1 mb-1">
                <div
                  className="flex rounded-md overflow-hidden border border-white/10"
                  role="group"
                  aria-label="Mix preset"
                >
                  {MIX_PRESET_ORDER.map((id) => (
                    <button
                      key={id}
                      onClick={() => applyPreset(id)}
                      aria-pressed={mixPreset === id}
                      className={`text-[10px] px-2 py-1 transition-colors ${
                        mixPreset === id
                          ? "bg-violet-600 text-white"
                          : "bg-white/5 text-muted hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {MIX_PRESET_LABELS[id]}
                    </button>
                  ))}
                </div>
                <button
                  onClick={resetGains}
                  className="text-[10px] px-2 py-1 rounded-md border border-white/10 text-muted hover:bg-white/10 hover:text-white transition-colors"
                  title="Restore this preset's default fader positions"
                >
                  Reset
                </button>
              </div>
              {/* EQ presets row — apply the same preset to all stems at once */}
          <div className="flex flex-wrap gap-1">
            <span className="text-[9px] text-muted uppercase tracking-wider mr-1">EQ</span>
            {Object.keys(eqPresets ?? DEFAULT_EQ_PRESETS).map((name) => {
              const preset = (eqPresets ?? DEFAULT_EQ_PRESETS)[name];
              return (
                <button
                  key={name}
                  onClick={() => {
                    STEM_NAMES.forEach((stemName) => {
                      const bands = preset.map((b) => ({ ...b }));
                      setStemEQ(stemName, bands);
                    });
                  }}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-violet-600/20 hover:bg-violet-600/40 text-violet-200"
                  title={`Apply ${name} EQ to all stems`}
                >
                  {name}
                </button>
              );
            })}
          </div>
          {STEM_CATEGORIES.map((category) => (
            <div key={category.id} className="mb-2">
              <h4
                className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-muted mb-1"
                aria-label={category.label}
                data-stem-category={category.id}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full border border-white/20 ${
                    category.id === "rhythm"
                      ? "bg-amber-400/60 border-amber-400"
                      : category.id === "lead"
                      ? "bg-rose-400/60 border-rose-400"
                      : "bg-sky-400/60 border-sky-400"
                  }`}
                  aria-hidden="true"
                />
                {category.label}
              </h4>
              {category.keys.map((name: StemName) => {
                const def = STEM_BY_KEY[name];
                const bands = eqBands[name] || [];
                const stemColor = def.color.replace("bg-", "text-").replace("/70", "/90");
                return (
                  <div key={name} className="flex flex-col gap-1" data-stem={name}>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleMute(name)}
                        className={`w-16 text-left text-[11px] px-1.5 py-1 rounded-md border transition-colors ${
                          muted[name]
                            ? "bg-red-500/20 border-red-500/40 text-red-300 line-through"
                            : `bg-white/5 border-white/20 ${stemColor}/60 text-white hover:bg-white/10`
                        }`}
                        title={`Mute ${def.label} — visual: ${def.role}`}
                      >
                        {def.label}
                      </button>
                      <input
                        type="range"
                        min={FADER_MIN_DB}
                        max={FADER_MAX_DB}
                        step={0.1}
                        value={gainsDb[name]}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setVolumeDb(name, parseFloat(e.target.value))
                        }
                        onDoubleClick={() => resetStem(name)}
                        className="flex-1 h-1 accent-violet-500"
                        aria-label={`${def.label} volume`}
                      />
                      {/* dB readout: a linear 0-1 fader gives the user no way to
                          judge a level, and the offsets here are small enough that
                          "slightly louder" needs a number to be actionable. */}
                      <span className="w-14 text-right text-[9px] text-muted tabular-nums">
                        {formatDb(gainsDb[name])}
                      </span>
                    </div>
                    {bands.length > 0 && (
                      <div className="grid grid-cols-5 gap-1 pl-[4.5rem]">
                        {bands.map((band, idx: number) => (
                          <div key={band.id ?? idx} className="flex flex-col items-center gap-0.5">
                            <input
                              type="range"
                              min={-12}
                              max={12}
                              step={0.5}
                              value={band.gain}
                              onChange={(e) => {
                                const next = [...bands];
                                next[idx] = { ...band, gain: parseFloat(e.target.value) };
                                setStemEQ(name, next);
                              }}
                              className="w-full h-1 accent-emerald-400"
                              aria-label={`${def.label} ${band.type} ${band.frequency}Hz`}
                            />
                            <span className="text-[9px] text-muted leading-none">
                              {band.frequency >= 1000
                                ? `${(band.frequency / 1000).toFixed(
                                    band.frequency >= 10000 ? 0 : 1
                                  )}k`
                                : band.frequency}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <p className="col-span-2 text-[10px] text-muted leading-relaxed">
            drums→pulse · bass→camera shake · vocals→lyric glow · other→palette
          </p>
        </div>
      )}
      </div>
    </div>
  );
}

function EnhanceButton({
  filename,
  vocalExpander = false,
  onVocalExpanderChange,
  vocalBalanceDb = 0,
  onVocalBalanceDbChange,
}: {
  filename: string;
  vocalExpander?: boolean;
  onVocalExpanderChange?: (on: boolean) => void;
  vocalBalanceDb?: number;
  onVocalBalanceDbChange?: (db: number) => void;
}) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleEnhance = async () => {
    setLoading(true);
    setError(null);
    try {
      await enhanceStems({
        filename,
        model: "mdx_extra_q",
        output_format: "wav",
        // High-pass left at the backend default (30 Hz). It was pinned to 120
        // here, which silently overrode the backend fix: 62% of a Suno export's
        // energy sits below 120 Hz, so that setting removed 89% of the bass
        // band on every run the UI started. See suno_enhancer.EnhanceConfig.
        vocal_spectral_gate_threshold_db: -40,
        vocal_dynamic_eq_max_reduction_db: 4,
        vocal_expander: vocalExpander,
        deess_freq_hz: 6500,
        air_boost_gain_db: 2.5,
        air_boost_freq_hz: 10000,
        vocal_balance_db: vocalBalanceDb,
        parallel_weight_bus_db: -15,
        sidechain_pocket_eq_enabled: true,
      });
      alert("Stems enhanced successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enhancement failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-1 text-[10px] text-muted">
          <input
            type="checkbox"
            checked={vocalExpander}
            onChange={(e) => onVocalExpanderChange?.(e.target.checked)}
          />
          Vocal expander (no compression)
        </label>
        <label className="flex items-center gap-1 text-[10px] text-muted">
          Vocal balance
          <input
            type="range"
            min={-3}
            max={3}
            step={0.5}
            value={vocalBalanceDb}
            onChange={(e) => onVocalBalanceDbChange?.(parseFloat(e.target.value))}
            className="h-1 accent-emerald-400"
          />
          {vocalBalanceDb > 0 ? `+${vocalBalanceDb}` : vocalBalanceDb} dB
        </label>
      </div>
      <button
        onClick={handleEnhance}
        disabled={loading}
        className="w-full py-1.5 text-[11px] rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
      >
        {loading ? "Enhancing…" : "Enhance (Suno KARRA preset)"}
      </button>
      {error && <p className="text-[10px] text-red-300">{error}</p>}
    </div>
  );
}
