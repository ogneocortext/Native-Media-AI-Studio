/**
 * Shared Web Audio graph for the visualizer stage.
 *
 * Owns the single AudioContext and its node chain:
 *   MediaElementSource → EQ → analyser → mainGain → destination
 *
 * The context is created lazily and shared with the stem mixer / pro mixer so
 * only one AudioContext exists per page (two contexts are functional but waste
 * a hardware output device).
 *
 * Extracted from Visualizer.tsx — no logic changed. The graph-init block that
 * used to be copy-pasted into setupAudio / handleFile / handleSelectLibraryTrack
 * now lives here once, as `ensureAudioContext()`.
 */
import { useCallback, useEffect, useRef } from "react";
import { ANALYSER_SMOOTHING, createAudioClock, estimateOutputLatency } from "./audioTiming";
import { createEQ } from "./audioEQ";

export interface EQHandle {
  input: GainNode;
  output: GainNode;
  setBands: (bands: any[]) => void;
  applyPreset: (name: string) => void;
  dispose: () => void;
}

export interface AudioGraph {
  /** Shared context, or null until first use. Pass to child mixers. */
  audioCtxRef: React.RefObject<AudioContext | null>;
  analyserRef: React.RefObject<AnalyserNode | null>;
  mainGainRef: React.RefObject<GainNode | null>;
  eqRef: React.RefObject<EQHandle | null>;
  /** Create the context/graph if absent; resume it if suspended. */
  ensureAudioContext: () => Promise<void>;
  /** Wire a media element into the graph (idempotent per element). */
  setupAudio: (el: HTMLMediaElement | null) => Promise<void>;
  /** Latency-compensated elapsed time; 0 when no element is attached. */
  sampleAudio: () => number;
  /** Rewind the shared audio clock (called on track change). */
  resetClock: () => void;
  /** Clock ref + measured output latency, for callers that sample directly. */
  audioClockRef: React.RefObject<ReturnType<typeof createAudioClock>>;
  latencyRef: React.RefObject<number>;
  /** Flatten gain + EQ back to a neutral state for a new track. */
  resetGraph: () => void;
}

export function useAudioGraph(audioElRef: React.RefObject<HTMLMediaElement | null>): AudioGraph {
  const mainGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const eqRef = useRef<EQHandle | null>(null);
  const latencyRef = useRef(0);
  const connectedElements = useRef<WeakSet<HTMLMediaElement>>(new WeakSet());
  const audioClockRef = useRef(createAudioClock());

  const ensureAudioContext = useCallback(async () => {
    if (!audioCtxRef.current) {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      latencyRef.current = estimateOutputLatency(ctx);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      // Light analyser smoothing (was 0.8, which trailed onsets ~100 ms+);
      // punch/decay shaping lives in our own attack/release stage instead.
      analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
      analyserRef.current = analyser;
      const mainGain = ctx.createGain();
      mainGainRef.current = mainGain;
      const eq = createEQ(ctx, []);
      eqRef.current = eq;
      // Graph: source → eq → analyser → mainGain → destination
      eq.output.connect(analyser);
      analyser.connect(mainGain);
      mainGain.connect(ctx.destination);
    } else {
      latencyRef.current = estimateOutputLatency(audioCtxRef.current);
      if (audioCtxRef.current.state === "suspended") {
        try {
          await audioCtxRef.current.resume();
        } catch {
          /* ignore */
        }
      }
    }
  }, []);

  const setupAudio = useCallback(
    async (el: HTMLMediaElement | null) => {
      if (!el) return;
      // Element already wired: just ensure the context is running (autoplay-policy
      // suspensions need resume(), not a rebuild — rebuilding throws "already connected").
      if (connectedElements.current.has(el)) {
        latencyRef.current = estimateOutputLatency(audioCtxRef.current);
        if (audioCtxRef.current?.state === "suspended") {
          try {
            await audioCtxRef.current.resume();
          } catch {
            /* ignore */
          }
        }
        return;
      }
      try {
        connectedElements.current.add(el);

        // Disconnect previous source from shared context if switching elements
        if (sourceRef.current) {
          try {
            sourceRef.current.disconnect();
          } catch {
            /* already disconnected */
          }
          sourceRef.current = null;
        }

        await ensureAudioContext();

        const ctx = audioCtxRef.current!;
        const source = ctx.createMediaElementSource(el);
        sourceRef.current = source;
        const eq = eqRef.current;
        if (eq) {
          source.connect(eq.input);
        } else {
          source.connect(analyserRef.current!);
        }
      } catch (e) {
        throw e instanceof Error ? e : new Error("Web Audio setup failed");
      }
    },
    [ensureAudioContext],
  );

  const sampleAudio = useCallback(() => {
    const el = audioElRef.current;
    return el ? audioClockRef.current.sample(el, latencyRef.current) : 0;
  }, [audioElRef]);

  const resetClock = useCallback(() => {
    audioClockRef.current.reset();
  }, []);

  const resetGraph = useCallback(() => {
    if (mainGainRef.current) {
      mainGainRef.current.gain.setTargetAtTime(1, mainGainRef.current.context.currentTime, 0.06);
    }
    if (eqRef.current) {
      try {
        eqRef.current.applyPreset("flat");
      } catch {
        /* ignore */
      }
    }
  }, []);

  // Close the shared context on unmount.
  useEffect(() => {
    return () => {
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
    };
  }, []);

  return {
    audioCtxRef,
    analyserRef,
    mainGainRef,
    eqRef,
    ensureAudioContext,
    setupAudio,
    sampleAudio,
    resetGraph,
    resetClock,
    audioClockRef,
    latencyRef,
  };
}
