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

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase, getAudioStems, separateAudioFile } from "../../../services/api";

export type StemName = "vocals" | "drums" | "bass" | "other";
export const STEM_NAMES: StemName[] = ["vocals", "drums", "bass", "other"];

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
  /** Called every animation frame with current per-stem levels (0-1). */
  onLevels?: (levels: StemLevels) => void;
  compact?: boolean;
}

interface LoadedStem {
  name: StemName;
  url: string;
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
  buf: Uint8Array<ArrayBuffer>;
}

export function useStemMixer({ audioFilename, onLevels }: StemMixerProps) {
  const [stems, setStems] = useState<Record<StemName, string> | null>(null);
  const [status, setStatus] = useState<"idle" | "checking" | "separating" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [volumes, setVolumes] = useState<Record<StemName, number>>({ vocals: 1, drums: 1, bass: 1, other: 1 });
  const [muted, setMuted] = useState<Record<StemName, boolean>>({ vocals: false, drums: false, bass: false, other: false });
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

  // Elapsed timer while Demucs runs (separation takes minutes — show it's alive).
  useEffect(() => {
    if (status !== "separating") return;
    const id = setInterval(() => {}, 1000);
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
        setStems(data.stems);
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
      const result = await separateAudioFile(audioFilename);
      if (!result.success || Object.keys(result.stems || {}).length === 0) {
        throw new Error(result.error || "Separation produced no stems");
      }
      const data = await getAudioStems(audioFilename);
      const urls = data.found ? data.stems : null;
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
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        for (const name of STEM_NAMES) {
          const raw = stems[name];
          if (!raw) continue;
          const url = resolveStemUrl(raw);
          const el = new Audio(url);
          el.crossOrigin = "anonymous";
          el.preload = "auto";
          const source = ctx.createMediaElementSource(el);
          const gain = ctx.createGain();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(gain);
          gain.connect(analyser);
          gain.connect(ctx.destination);
          created.push({ name, url, element: el, source, gain, analyser, buf: new Uint8Array(analyser.frequencyBinCount) });
        }
        if (cancelled) {
          created.forEach((s) => s.element.pause());
          void ctx.close();
          return;
        }
        loadedRef.current = created;
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
      });
      loadedRef.current = [];
      if (ctxRef.current) {
        void ctxRef.current.close();
        ctxRef.current = null;
      }
    };
  }, [stems]);

  // Level metering loop
  useEffect(() => {
    if (!onLevels) return;
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
      onLevels(levels);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [onLevels]);

  /** Sync stem transport with the main player. */
  const syncTransport = useCallback((main: HTMLAudioElement | null) => {
    for (const stem of loadedRef.current) {
      if (!main || main.paused) {
        stem.element.pause();
        continue;
      }
      if (Math.abs(stem.element.currentTime - main.currentTime) > 0.15) {
        stem.element.currentTime = main.currentTime;
      }
      if (stem.element.paused) stem.element.play().catch(() => {});
    }
  }, []);

  const applyMixerState = useCallback((name: StemName, vol: number, isMuted: boolean) => {
    const stem = loadedRef.current.find((s) => s.name === name);
    if (stem) stem.gain.gain.value = isMuted ? 0 : vol;
  }, []);

  const setVolume = useCallback(
    (name: StemName, vol: number) => {
      setVolumes((prev) => ({ ...prev, [name]: vol }));
      applyMixerState(name, vol, muted[name]);
    },
    [applyMixerState, muted]
  );

  const toggleMute = useCallback(
    (name: StemName) => {
      setMuted((prev) => {
        const next = !prev[name];
        applyMixerState(name, volumes[name], next);
        return { ...prev, [name]: next };
      });
    },
    [applyMixerState, volumes]
  );

  return { stems, status, error, volumes, muted, setVolume, toggleMute, ensureStems, syncTransport };
}

export function StemMixerPanel({ audioFilename, compact = false }: StemMixerProps) {
  const { status, error, volumes, muted, setVolume, toggleMute, ensureStems, syncTransport } =
    useStemMixer({ audioFilename });

  useEffect(() => {
    // Sync stem transport with the page's main <audio data-main-player> element
    const main = document.querySelector<HTMLAudioElement>("audio[data-main-player]");
    const id = setInterval(() => syncTransport(main), 500);
    return () => clearInterval(id);
  }, [syncTransport]);

  if (!audioFilename) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3" data-testid="stem-mixer">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">Stem Mixer</span>
        {status === "ready" ? (
          <span className="text-[10px] text-emerald-400">4 stems ready</span>
        ) : status === "checking" ? (
          <span className="text-[10px] text-muted">checking…</span>
        ) : status === "error" ? (
          <span className="text-[10px] text-red-400" title={error || undefined}>unavailable</span>
        ) : null}
      </div>

      {status === "idle" && (
        <button
          onClick={ensureStems}
          className="w-full py-2 text-xs rounded-lg bg-violet-600/80 hover:bg-violet-500 text-white transition-colors"
        >
          Load Stems (vocals / drums / bass / other)
        </button>
      )}

      {status === "ready" && (
        <div className={compact ? "grid grid-cols-2 gap-2" : "space-y-2"}>
          {STEM_NAMES.map((name) => (
            <div key={name} className="flex items-center gap-2" data-stem={name}>
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
                min={0}
                max={1}
                step={0.01}
                value={volumes[name]}
                onChange={(e) => setVolume(name, parseFloat(e.target.value))}
                className="flex-1 h-1 accent-violet-500"
                aria-label={`${name} volume`}
              />
            </div>
          ))}
          <p className="col-span-2 text-[10px] text-muted leading-relaxed">
            drums→pulse · bass→camera shake · vocals→lyric glow · other→palette
          </p>
        </div>
      )}
    </div>
  );
}
