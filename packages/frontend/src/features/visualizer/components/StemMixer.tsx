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
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase, getAudioStems, separateAudioFile, enhanceStems } from "../../../services/api";
import { createEQ, DEFAULT_EQ_PRESETS, type EQBand, type EQInstance } from "../audioEQ";
import { createStemSpatialProcessor, type StemSpatialProcessor } from "../stemSpatial";
import {
  DEFAULT_STEM_GAINS_DB,
  FADER_MAX_DB,
  FADER_MIN_DB,
  MIX_PRESET_LABELS,
  MIX_PRESET_ORDER,
  MIX_PRESETS,
  STEM_NAMES,
  dbToGain,
  formatDb,
  snapDb,
  type MixPresetId,
  type StemName,
} from "../stemMixPresets";

// Re-exported so existing importers (viz-styles/helpers.ts, the Visualizer) keep
// working against the single canonical list. This array was previously declared
// here and duplicated from the backend's STEM_NAMES.
export { STEM_NAMES } from "../stemMixPresets";
export type { StemName } from "../stemMixPresets";

/** Documented visual channel per stem (Trend 2 mapping). */
export const STEM_VISUAL_ROLE: Record<StemName, string> = {
  drums: "scale/pulse",
  bass: "camera shake",
  vocals: "lyric kinetic",
  other: "palette shift",
};

export interface StemLevels {
  vocals: number;
  drums: number;
  bass: number;
  other: number;
}

interface StemMixerProps {
  audioFilename: string | null;
  sharedAudioContext?: AudioContext | null;
  mainAudioRef?: React.MutableRefObject<HTMLAudioElement | null>;
  mainGainRef?: React.MutableRefObject<GainNode | null>;
  /** Called every animation frame with current per-stem levels (0-1). */
  onLevels?: (levels: StemLevels) => void;
  compact?: boolean;
  onStateChange?: (state: {
    muted: Record<StemName, boolean>;
    volumes: Record<StemName, number>;
    eqBands: Record<StemName, EQBand[]>;
  }) => void;
  /** Shared EQ presets (optional; defaults to module presets when omitted). */
  eqPresets?: Record<string, EQBand[]>;
  /** Separation quality mode exposed to the UI (Gemini UVR5 guidance). */
  separationMode?: "single" | "hierarchical";
  onSeparationModeChange?: (mode: "single" | "hierarchical") => void;
  segmentSize?: number;
  onSegmentSizeChange?: (size: number) => void;
  /** KARRA enhancer knobs (optional; defaults baked into backend). */
  vocalExpander?: boolean;
  onVocalExpanderChange?: (on: boolean) => void;
  vocalBalanceDb?: number;
  onVocalBalanceDbChange?: (db: number) => void;
}

interface LoadedStem {
  name: StemName;
  url: string;
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
  buf: Uint8Array<ArrayBuffer>;
  eq: EQInstance | null;
  spatial: StemSpatialProcessor;
}

/** Prefer MP3 stem URLs (~87% smaller transfer, lazy-encoded server-side on
 *  first request); fall back to WAV when the backend predates stems_mp3. */
function pickStemUrls(data: {
  stems: Record<string, string>;
  stems_mp3?: Record<string, string>;
}): Record<string, string> {
  return data.stems_mp3 && Object.keys(data.stems_mp3).length > 0 ? data.stems_mp3 : data.stems;
}

/** Convert a full dB map to the linear gains a WebAudio graph expects. */
function gainMapToLinear(dbMap: Record<StemName, number>): Record<StemName, number> {
  return {
    vocals: dbToGain(dbMap.vocals),
    drums: dbToGain(dbMap.drums),
    bass: dbToGain(dbMap.bass),
    other: dbToGain(dbMap.other),
  };
}

export function useStemMixer({
  audioFilename,
  sharedAudioContext,
  mainAudioRef: _mainAudioRef,
  mainGainRef,
  onLevels,
  onStateChange: _onStateChange,
  eqPresets,
  separationMode = "single",
  segmentSize,
  vocalExpander: _vocalExpander = false,
  vocalBalanceDb: _vocalBalanceDb = 0,
}: StemMixerProps) {
  const [stems, setStems] = useState<Record<StemName, string> | null>(null);
  const [status, setStatus] = useState<"idle" | "checking" | "separating" | "ready" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  // Fader positions are stored in dB, matching the UX contract in
  // docs/knowledge/gemini-stem-mixer-ux-2026-10-02/README.md. They are converted
  // to linear gain only at the GainNode boundary (applyMixerState), because a
  // WebAudio GainNode is linear amplitude and the two are easy to confuse.
  //
  // The default is the Balanced preset, so opening the mixer already sounds
  // better than the raw separated stems with zero input.
  const [gainsDb, setGainsDb] = useState<Record<StemName, number>>({
    ...DEFAULT_STEM_GAINS_DB,
  });
  // Named mixPreset, not preset: `applyStemEQPreset` and the EQ button row both use
  // a local `preset` for an EQ preset name, and a single `preset` in scope would
  // shadow one of them.
  const [mixPreset, setMixPreset] = useState<MixPresetId>("balanced");
  // Linear gains for the audio graph, derived from gainsDb. Kept in sync by
  // setVolumeDb / toggleMute / applyPreset / resetGains rather than derived in
  // render, so the WebAudio write happens exactly once per change.
  const [volumes, setVolumes] = useState<Record<StemName, number>>(
    () => gainMapToLinear(DEFAULT_STEM_GAINS_DB),
  );
  const [muted, setMuted] = useState<Record<StemName, boolean>>({
    vocals: false,
    drums: false,
    bass: false,
    other: false,
  });
  const [eqBands, setEqBands] = useState<Record<StemName, EQBand[]>>({
    vocals: [],
    drums: [],
    bass: [],
    other: [],
  });
  const loadedRef = useRef<LoadedStem[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const startedRef = useRef(false);
  const trackRef = useRef<string | null>(null);

  // New track → drop previous stems/graph so nothing stale survives a switch.
  useEffect(() => {
    if (trackRef.current === audioFilename) return;
    trackRef.current = audioFilename;
    startedRef.current = false;
    setStems(null);
    setStatus("idle");
    setError(null);
  }, [audioFilename]);

  // Separation progress tick — triggers a re-render every second while Demucs runs
  // (separation takes minutes — show it's alive).
  useEffect(() => {
    if (status !== "separating") return;
    const id = setInterval(() => setStatus((s) => s), 1000);
    return () => clearInterval(id);
  }, [status]);

  const resolveStemUrl = (u: string) => (u.startsWith("http") ? u : `${getApiBase()}${u}`);

  const ensureStems = useCallback(async () => {
    // Look up existing stems; if missing, separate them automatically (Demucs).
    if (!audioFilename || startedRef.current) return;
    startedRef.current = true;
    setStatus("checking");
    setError(null);
    try {
      const data = await getAudioStems(audioFilename);
      if (data.found && Object.keys(data.stems).length > 0) {
        setStems(pickStemUrls(data));
        setStatus("ready");
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      startedRef.current = false;
      return;
    }
    // No stems yet — trigger separation instead of dead-ending.
    setStatus("separating");
    try {
      const result = await separateAudioFile(audioFilename, "mdx_extra_q", {
        mode: separationMode,
        segment_size: segmentSize,
        denoise: true,
      });
      if (!result.success || Object.keys(result.stems || {}).length === 0) {
        throw new Error(result.error || "Separation produced no stems");
      }
      const data = await getAudioStems(audioFilename);
      const urls = data.found ? pickStemUrls(data) : null;
      if (!urls || Object.keys(urls).length === 0) {
        throw new Error("Separation finished but stems are not readable yet — retry in a moment");
      }
      setStems(urls);
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      startedRef.current = false;
    }
  }, [audioFilename]);

  // Load + wire audio graph when stems resolve
  useEffect(() => {
    if (!stems) return;
    let cancelled = false;
    const created: LoadedStem[] = [];
    (async () => {
      try {
        const ctx = sharedAudioContext ?? new AudioContext();
        ctxRef.current = ctx;
        for (const name of STEM_NAMES) {
          const raw = stems[name];
          if (!raw) continue;
          const url = resolveStemUrl(raw);
          const el = new Audio();
          el.crossOrigin = "anonymous";
          el.src = url;
          el.preload = "auto";
          let source: MediaElementAudioSourceNode;
          try {
            source = ctx.createMediaElementSource(el);
          } catch (e) {
            setError(
              `Failed to wire stem "${name}" — ${e instanceof Error ? e.message : String(e)}`,
            );
            continue;
          }
          const eq = createEQ(ctx, eqBands[name] || []);
          const spatial = createStemSpatialProcessor(ctx, name);
          const gain = ctx.createGain();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          // Graph: source → eq → spatial → gain → analyser → destination
          source.connect(eq.input);
          eq.output.connect(spatial.input);
          spatial.output.connect(gain);
          gain.connect(analyser);
          gain.connect(ctx.destination);
          created.push({
            name,
            url,
            element: el,
            source,
            gain,
            analyser,
            buf: new Uint8Array(analyser.frequencyBinCount),
            eq,
            spatial,
          });
        }
        if (cancelled) {
          created.forEach((s) => {
            s.element.pause();
            if (s.eq) s.eq.dispose();
          });
          if (!sharedAudioContext && ctxRef.current) {
            void ctxRef.current.close();
            ctxRef.current = null;
          }
          return;
        }
        loadedRef.current = created;
        if (created.length === 0) {
          setError("No stems could be loaded — check server logs");
          setStatus("error");
          return;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      loadedRef.current.forEach((s) => {
        s.element.pause();
        s.element.src = "";
        if (s.eq) s.eq.dispose();
        if (s.spatial) s.spatial.dispose();
      });
      loadedRef.current = [];
      if (ctxRef.current && !sharedAudioContext) {
        void ctxRef.current.close();
        ctxRef.current = null;
      }
      // Restore the main track's output when stems are released.
      if (mainGainRef?.current) {
        mainGainRef.current.gain.setTargetAtTime(
          1,
          mainGainRef.current.context.currentTime,
          0.06,
        );
      } else {
        const main = document.querySelector<HTMLAudioElement>("audio[data-main-player]");
        if (main) main.muted = false;
      }
    };
  }, [stems]);

  // Level metering loop — onLevels is stabilized via ref so the RAF loop
  // never restarts when the parent re-renders with a new arrow function.
  const onLevelsRef = useRef(onLevels);
  onLevelsRef.current = onLevels;
  useEffect(() => {
    const tick = () => {
      const levels: StemLevels = { vocals: 0, drums: 0, bass: 0, other: 0 };
      for (const stem of loadedRef.current) {
        stem.analyser.getByteTimeDomainData(stem.buf);
        let sum = 0;
        for (let i = 0; i < stem.buf.length; i++) {
          const v = (stem.buf[i] - 128) / 128;
          sum += v * v;
        }
        levels[stem.name] = Math.min(1, Math.sqrt(sum / stem.buf.length) * 2.5);
      }
      if (onLevelsRef.current) onLevelsRef.current(levels);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  /** Sync stem transport with the main player. */
  const syncTransport = useCallback(
    (main: HTMLAudioElement | null) => {
      const hasLoaded = loadedRef.current.length > 0;
      for (const stem of loadedRef.current) {
        if (!main || main.paused) {
          stem.element.pause();
          continue;
        }
        // Drift correction: seek stems only when they drift > 200 ms. Separate
        // audio elements naturally drift 50–150 ms (buffering, network latency);
        // seeking below that threshold causes constant re-buffering and audible
        // skipping. 200 ms is above the inaudible-drift range but still tight
        // enough to keep stems aligned with the main track.
        if (Math.abs(stem.element.currentTime - main.currentTime) > 0.2) {
          stem.element.currentTime = main.currentTime;
        }
        if (stem.element.paused) stem.element.play().catch(() => {});
      }
      // Blend the main track down (not mute) when stems are active so the
      // original stereo imaging and mastering survive underneath the widened
      // stems. Hard cuts cause clicks/pops, so we use setTargetAtTime with a
      // 60 ms time constant.
      if (main && hasLoaded) {
        if (mainGainRef?.current) {
          mainGainRef.current.gain.setTargetAtTime(
            0.35,
            mainGainRef.current.context.currentTime,
            0.06,
          );
        } else {
          // Fallback to HTML mute only if the shared gain node isn't wired yet.
          main.muted = true;
        }
      }
    },
    [mainGainRef],
  );

  const applyMixerState = useCallback((name: StemName, vol: number, isMuted: boolean) => {
    const stem = loadedRef.current.find((s) => s.name === name);
    if (stem) stem.gain.gain.value = isMuted ? 0 : vol;
  }, []);

  /** Set one stem's fader from a dB value. Snaps and clamps via `snapDb`. */
  const setVolumeDb = useCallback(
    (name: StemName, db: number) => {
      const next = snapDb(db);
      const linear = dbToGain(next);
      setGainsDb((prev) => ({ ...prev, [name]: next }));
      setVolumes((prev) => ({ ...prev, [name]: linear }));
      applyMixerState(name, linear, muted[name]);
      // A hand-adjusted fader means the user is no longer on a preset. Keep the
      // pill highlighted only while every fader still matches its preset value.
      setMixPreset((prev) => (MIX_PRESETS[prev][name] === next ? prev : "balanced"));
    },
    [applyMixerState, muted],
  );

  /** Reset one stem to the current preset's default (double-click on a fader). */
  const resetStem = useCallback(
    (name: StemName) => {
      setVolumeDb(name, MIX_PRESETS[mixPreset][name]);
    },
    [mixPreset, setVolumeDb],
  );

  /** Apply a macro preset to all four faders at once. */
  const applyPreset = useCallback(
    (id: MixPresetId) => {
      const gains = MIX_PRESETS[id];
      const linear = gainMapToLinear(gains);
      setMixPreset(id);
      setGainsDb({ ...gains });
      setVolumes(linear);
      for (const name of STEM_NAMES) {
        applyMixerState(name, linear[name], muted[name]);
      }
    },
    [applyMixerState, muted],
  );

  /** Restore the current preset's defaults (the ghost Reset button). */
  const resetGains = useCallback(() => applyPreset(mixPreset), [applyPreset, mixPreset]);

  const toggleMute = useCallback(
    (name: StemName) => {
      setMuted((prev) => {
        const next = !prev[name];
        applyMixerState(name, volumes[name], next);
        return { ...prev, [name]: next };
      });
    },
    [applyMixerState, volumes],
  );

  const setStemEQ = useCallback(
    (name: StemName, bands: EQBand[]) => {
      setEqBands((prev) => {
        const next = { ...prev, [name]: bands };
        const stem = loadedRef.current.find((s) => s.name === name);
        if (stem?.eq) {
          stem.eq.setBands(bands);
        }
        return next;
      });
    },
    [],
  );

  const applyStemEQPreset = useCallback(
    (name: StemName, presetName: string) => {
      const preset = eqPresets?.[presetName] || DEFAULT_EQ_PRESETS[presetName];
      if (!preset) return;
      setStemEQ(
        name,
        preset.map((b) => ({ ...b })),
      );
    },
    [eqPresets, setStemEQ],
  );

  // Expose per-stem EQ presets through the hook return.
  return {
    stems,
    status,
    error,
    volumes,
    gainsDb,
    mixPreset,
    muted,
    eqBands,
    setVolumeDb,
    resetStem,
    applyPreset,
    resetGains,
    toggleMute,
    setStemEQ,
    applyStemEQPreset,
    ensureStems,
    syncTransport,
  };
}

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
  segmentSize = 256,
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

  if (!audioFilename) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3" data-testid="stem-mixer">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          Stem Mixer
        </span>
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
          <span className="text-[10px] text-red-400" title={error || undefined}>
            unavailable
          </span>
        ) : null}
      </div>

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
              <option value={128}>128 (fast, 8 GB)</option>
              <option value={256}>256 (balanced)</option>
              <option value={512}>512 (pristine)</option>
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
          <p className="text-[11px] text-red-300/80 leading-relaxed">
            {error || "Stems unavailable"}
          </p>
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
            {Object.keys(eqPresets || DEFAULT_EQ_PRESETS).map((name) => {
              const preset = (eqPresets || DEFAULT_EQ_PRESETS)[name];
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
          {STEM_NAMES.map((name) => {
            const bands = eqBands[name] || [];
            return (
              <div key={name} className="flex flex-col gap-1" data-stem={name}>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleMute(name)}
                    className={`w-16 text-left text-[11px] px-1.5 py-1 rounded-md border transition-colors ${
                      muted[name]
                        ? "bg-red-500/20 border-red-500/40 text-red-300 line-through"
                        : "bg-white/5 border-white/10 text-white hover:bg-white/10"
                    }`}
                    title={`Mute ${name} — visual: ${STEM_VISUAL_ROLE[name]}`}
                  >
                    {name}
                  </button>
                  <input
                    type="range"
                    min={FADER_MIN_DB}
                    max={FADER_MAX_DB}
                    step={0.1}
                    value={gainsDb[name]}
                    onChange={(e) => setVolumeDb(name, parseFloat(e.target.value))}
                    onDoubleClick={() => resetStem(name)}
                    className="flex-1 h-1 accent-violet-500"
                    aria-label={`${name} volume`}
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
                    {bands.map((band, idx) => (
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
                          aria-label={`${name} ${band.type} ${band.frequency}Hz`}
                        />
                        <span className="text-[9px] text-muted leading-none">
                          {band.frequency >= 1000
                            ? `${(band.frequency / 1000).toFixed(band.frequency >= 10000 ? 0 : 1)}k`
                            : band.frequency}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <p className="col-span-2 text-[10px] text-muted leading-relaxed">
            drums→pulse · bass→camera shake · vocals→lyric glow · other→palette
          </p>
        </div>
      )}
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
        pre_highpass_hz: 120,
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
