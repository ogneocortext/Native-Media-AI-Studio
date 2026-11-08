/**
 * useStemMixer — per-stem audio loading, mixing, and level metering.
 *
 * Owns the WebAudio stem graph (decode -> per-stem gain/EQ/spatial ->
 * analyser), the dB fader state, mix presets, mute/EQ controls, lazy stem
 * separation, and the per-frame level/quality computation. StemMixerPanel
 * is the view over this hook.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { getApiBase, getAudioStems, separateAudioFile } from "../../../services/api";
import { createEQ, type EQBand, type EQInstance } from "../audioEQ";
import { createStemSpatialProcessor, type StemSpatialProcessor } from "../stemSpatial";
import { getSharedAudioContext } from "../../../shared/audioContext";
import {
  DEFAULT_STEM_GAINS_DB,
  MIX_PRESETS,
  STEM_NAMES,
  dbToGain,
  snapDb,
  type MixPresetId,
  type StemName,
} from "../stems/stemMixPresets";

export type StemLevels = Record<StemName, number>;

export interface StemMixerProps {
  audioFilename: string | null;
  sharedAudioContext?: AudioContext | null;
  mainAudioRef?: MutableRefObject<HTMLAudioElement | null>;
  mainGainRef?: MutableRefObject<GainNode | null>;
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
  /** Separation quality mode exposed to the UI. */
  separationMode?: "single" | "hierarchical";
  onSeparationModeChange?: (mode: "single" | "hierarchical") => void;
  /** demucs --segment, in SECONDS (clamped to the model's trained max). */
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

/** Per-stem honesty metrics computed from a short audio sample.
 *
 * Bleed = energy in a stem's "wrong" frequency bands (e.g. bass rumble in the
 * vocals stem means the vocal MDX-Net didn't fully remove the low end).
 * Frequency purity = how much energy sits in the stem's expected band.
 * Mono-compatible = waveform is roughly symmetric (no extreme phase offset).
 *
 * Computed once when each stem loads; cheap enough to run on the AnalyserNode's
 * time-domain buffer without blocking the render thread.
 */
export interface StemQuality {
  bleedScore: number; // 0-1, higher = more cross-stem bleed
  frequencyPurity: number; // 0-1, how much energy is in expected band
  monoCompatible: boolean; // false = likely phase/mono problem
  warning: string | null; // human-readable warning, null when clean
}

/** Expected frequency band (Hz) for each stem — where most of its energy
 *  should live. Energy outside these bands suggests bleed from other stems. */
const STEM_EXPECTED_BAND: Record<StemName, [number, number]> = {
  vocals: [300, 3000], // voice fundamental + formants
  drums: [60, 250], // kick + snare body
  bass: [40, 200], // bass guitar / synth fundamental
  other: [200, 4000], // guitars, keys, pads
};

/** FFT bin index for a frequency, given the analyser's sample rate and fftSize. */
function freqToBin(freq: number, sampleRate: number, fftSize: number): number {
  const nyq = sampleRate / 2;
  return Math.min(Math.floor((freq / nyq) * (fftSize / 2)), fftSize / 2 - 1);
}

/** Sum analyser frequency-bin energy within [loHz, hiHz], normalized 0-1. */
function bandEnergy(
  freqs: Uint8Array,
  sampleRate: number,
  fftSize: number,
  loHz: number,
  hiHz: number,
): number {
  const lo = freqToBin(loHz, sampleRate, fftSize);
  const hi = freqToBin(hiHz, sampleRate, fftSize);
  let sum = 0;
  let count = 0;
  for (let i = lo; i <= hi; i++) {
    sum += freqs[i] / 255;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

/** Compute stem quality metrics from one snapshot of analyser data.
 *
 * Called once per stem after load. Not frame-accurate (we only need a
 * directional honesty signal), so a single buffer is enough.
 */
export function computeStemQuality(
  name: StemName,
  timeDomain: Uint8Array,
  freqDomain: Uint8Array,
  sampleRate: number,
  fftSize: number,
): StemQuality {
  const [lo, hi] = STEM_EXPECTED_BAND[name];
  const inBand = bandEnergy(freqDomain, sampleRate, fftSize, lo, hi);
  const outOfBand = Math.max(
    bandEnergy(freqDomain, sampleRate, fftSize, 20, lo),
    bandEnergy(freqDomain, sampleRate, fftSize, hi, 20000),
  );
  const frequencyPurity = inBand + outOfBand > 0 ? inBand / (inBand + outOfBand) : 0;
  const bleedScore = Math.min(1, outOfBand / Math.max(inBand, 0.01));

  // Mono-compatible: waveform roughly centered (no huge DC offset / asymmetry).
  let sum = 0;
  let absSum = 0;
  for (const sample of timeDomain) {
    const v = (sample - 128) / 128;
    sum += v;
    absSum += Math.abs(v);
  }
  const dcOffset = Math.abs(sum / timeDomain.length);
  const monoCompatible = dcOffset < 0.05 && absSum > 0.001;

  let warning: string | null = null;
  if (bleedScore > 0.4) {
    warning = `Stem "${name}" has significant bleed from other instruments — try the hierarchical mode or a different model.`;
  } else if (bleedScore > 0.25) {
    warning = `Stem "${name}" shows minor bleed — usable but not pristine.`;
  }
  if (!monoCompatible && !warning) {
    warning = `Stem "${name}" may have phase/mono-compatibility issues.`;
  } else if (!monoCompatible && warning) {
    warning += " It may also have phase/mono issues.";
  }

  return { bleedScore, frequencyPurity, monoCompatible, warning };
}

export function useStemMixer({
  audioFilename,
  sharedAudioContext,
  mainAudioRef: _mainAudioRef,
  mainGainRef,
  onLevels,
  onStateChange: _onStateChange,
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
  const [volumes, setVolumes] = useState<Record<StemName, number>>(() =>
    gainMapToLinear(DEFAULT_STEM_GAINS_DB),
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
  const stemQualityRef = useRef<Record<StemName, StemQuality> | undefined>(undefined);

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
      const stems = result.stems as Record<string, string> | undefined;
      if (!result.success || Object.keys(stems ?? {}).length === 0) {
        throw new Error(result.error ?? "Separation produced no stems");
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
    const created: LoadedStem[] = [];
    void (() => {
      try {
        // Prop wins; otherwise fall back to the shared page-lifetime context.
        // Neither is owned here, so neither may be closed on cleanup.
        const ctx = sharedAudioContext ?? getSharedAudioContext();
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
          const eq = createEQ(ctx, eqBands[name]);
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
      loadedRef.current.forEach((s) => {
        s.element.pause();
        s.element.src = "";
        if (s.eq) s.eq.dispose();
        s.spatial.dispose();
      });
      loadedRef.current = [];
      // ctx is the shared prop/singleton — never closed here.
      ctxRef.current = null;
      // Restore the main track's output when stems are released.
      if (mainGainRef?.current) {
        mainGainRef.current.gain.setTargetAtTime(1, mainGainRef.current.context.currentTime, 0.06);
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
  const qualityComputedRef = useRef(false);
  useEffect(() => {
    const tick = () => {
      const levels: StemLevels = { vocals: 0, drums: 0, bass: 0, other: 0 };
      const ctx = ctxRef.current;
      for (const stem of loadedRef.current) {
        stem.analyser.getByteTimeDomainData(stem.buf);
        let sum = 0;
        for (const sample of stem.buf) {
          const v = (sample - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / stem.buf.length);
        levels[stem.name] = Math.min(1, rms * 2.5);
        // Compute honesty metrics once, on the first tick with real audio.
        if (!qualityComputedRef.current && ctx && rms > 0.005) {
          stemQualityRef.current ??= {} as Record<StemName, StemQuality>;
          const freqs = new Uint8Array(stem.analyser.frequencyBinCount);
          stem.analyser.getByteFrequencyData(freqs);
          stemQualityRef.current[stem.name] = computeStemQuality(
            stem.name,
            stem.buf,
            freqs,
            ctx.sampleRate,
            stem.analyser.fftSize,
          );
        }
      }
      if (!qualityComputedRef.current && loadedRef.current.length > 0) {
        qualityComputedRef.current = true;
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
        if (stem.element.paused)
          stem.element.play().catch(() => {
            void 0;
          });
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

  const setStemEQ = useCallback((name: StemName, bands: EQBand[]) => {
    setEqBands((prev) => {
      const next = { ...prev, [name]: bands };
      const stem = loadedRef.current.find((s) => s.name === name);
      if (stem?.eq) {
        stem.eq.setBands(bands);
      }
      return next;
    });
  }, []);

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
    stemQuality: (stemQualityRef.current ?? {}) as Record<StemName, StemQuality>,
    setVolumeDb,
    resetStem,
    applyPreset,
    resetGains,
    toggleMute,
    setStemEQ,
    ensureStems,
    syncTransport,
  };
}
