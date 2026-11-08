/**
 * useVisualizerPlayback &mdash; playback clock, seek and blob-URL lifecycle.
 *
 * Extracted from Visualizer.tsx (T-VIZ-11). Owns everything that happens
 * between pressing play and the audio stopping:
 *
 * - the rAF elapsed/beat clock (latency-compensated via audioClockRef),
 *   throttled to ~20 fps React state with full-rate LRC sync ref,
 * - the one-final-elapsed sync on pause so lyrics don't freeze stale,
 * - blob object-URL revocation when playback moves away from them,
 * - object-URL revocation on unmount,
 * - togglePlayPause / cycleVizMode / handlePlayheadClick callbacks.
 *
 * Zero behavior change.
 */
import { useCallback, useEffect, useRef } from "react";
import { computeLrcSync } from "./useLrcSync";
import type { AudioClock } from "./audioTiming";
import type { LrcSyncData } from "./useLrcSync";
import type { LyricLine } from "./components/LyricOverlay";
import type { VizMode } from "./visualizerHelpers";
import { VIZ_MODE_ORDER } from "./visualizerHelpers";

export interface UseVisualizerPlaybackApi {
  audioClockRef: React.RefObject<AudioClock>;
  latencyRef: React.RefObject<number>;
  resetClock(): void;
}

export interface UseVisualizerPlaybackOptions {
  state: {
    isPlaying: boolean;
    audioUrl: string | null;
  };
  setters: {
    setElapsed: (value: number) => void;
    setVizMode: (value: VizMode | ((prev: VizMode) => VizMode)) => void;
  };
  refs: {
    audioElRef: React.MutableRefObject<HTMLAudioElement | null>;
    objectUrlRef: React.MutableRefObject<string | null>;
    audioElapsedRef: React.MutableRefObject<number>;
    lrcSyncLiveRef: React.MutableRefObject<LrcSyncData | null>;
    liveTimingRefs: React.MutableRefObject<{
      lyrics: LyricLine[];
      sectionBounds: Map<string, { start: number; end: number }>;
    }>;
    loopRegionRef: React.MutableRefObject<{ start: number; end: number } | null>;
    userPickedVizModeRef: React.MutableRefObject<boolean>;
  };
  api: {
    audioClockRef: React.RefObject<AudioClock>;
    latencyRef: React.RefObject<number>;
  };
}

// Function-typed properties so destructuring can't trip unbound-method.
export interface UseVisualizerPlaybackResult {
  togglePlayPause: () => void;
  cycleVizMode: (dir: 1 | -1) => void;
  handlePlayheadClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export function useVisualizerPlayback({
  state,
  setters,
  refs,
  api,
}: UseVisualizerPlaybackOptions): UseVisualizerPlaybackResult {
  const { isPlaying, audioUrl } = state;
  const { setElapsed, setVizMode } = setters;
  const {
    audioElRef,
    objectUrlRef,
    audioElapsedRef,
    lrcSyncLiveRef,
    liveTimingRefs,
    loopRegionRef,
    userPickedVizModeRef,
  } = refs;
  const { audioClockRef, latencyRef } = api;

  // Audio elapsed tracking — rAF updates ref + throttled React state for LRC sync.
  // Runs only while playing; on pause it syncs one final value and stops.
  // Re-resolves the <audio> element on every start since key={audioUrl} remounts
  // the node on track change.
  // Timing uses the interpolated, latency-compensated clock (see audioTiming.ts):
  // raw currentTime ticks coarsely (50–250 ms steps) and ignores output latency,
  // which is why beats and LRC pulses used to land late relative to the heard music.
  useEffect(() => {
    if (!audioUrl || !isPlaying) return;
    const el = audioElRef.current;
    if (!el) return;
    let rafId: number;
    let lastUpdate = 0;
    const track = () => {
      // Hidden tabs: rAF usually pauses, but detached/PiP windows keep
      // firing — skip sampling and re-check at low frequency.
      if (typeof document !== "undefined" && document.hidden) {
        rafId = requestAnimationFrame(track);
        return;
      }
      // A-B loop: wrap at the region end before sampling so the clock
      // picks up the seeked position on the same frame.
      const loop = loopRegionRef.current;
      if (loop && el.currentTime >= loop.end) {
        el.currentTime = loop.start;
      }
      const heard = audioClockRef.current.sample(el, latencyRef.current);
      audioElapsedRef.current = heard;
      // Full-rate LRC state for frame-critical visuals (phrase pulses are 150 ms —
      // invisible to the ~20 fps React-state path if sampled there).
      const { lyrics: liveLyrics, sectionBounds: liveBounds } = liveTimingRefs.current;
      lrcSyncLiveRef.current = liveLyrics.length
        ? computeLrcSync(liveLyrics, heard, liveBounds)
        : null;
      const now = performance.now();
      if (now - lastUpdate > 50) {
        // ~20fps React update for lyric DOM + slow consumers
        lastUpdate = now;
        setElapsed(heard);
      }
      rafId = requestAnimationFrame(track);
    };
    rafId = requestAnimationFrame(track);
    return () => cancelAnimationFrame(rafId);
  }, [audioUrl, isPlaying]);

  // Sync one final elapsed value on pause so lyrics don't freeze up to a throttle-window stale.
  // Uses the same latency-compensated clock as the playing loop — raw currentTime
  // would jump the lyrics/beat state forward by the output latency on every pause.
  useEffect(() => {
    if (!isPlaying && audioElRef.current) {
      const heard = audioClockRef.current.sample(audioElRef.current, latencyRef.current);
      audioElapsedRef.current = heard;
      setElapsed(heard);
    }
  }, [isPlaying]);

  // Revoke blob: object URLs once playback moves away from them (upload → library
  // switches previously leaked the blob until the next upload or unmount).
  const prevAudioUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevAudioUrlRef.current;
    if (prev && prev.startsWith("blob:") && prev !== audioUrl) {
      URL.revokeObjectURL(prev);
      if (objectUrlRef.current === prev) objectUrlRef.current = null;
    }
    prevAudioUrlRef.current = audioUrl;
  }, [audioUrl]);

  // Cleanup the audio object URL on unmount. AudioContext teardown is owned by
  // useAudioGraph and recorder teardown by useVisualizerRecording.
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const togglePlayPause = useCallback(() => {
    const el = audioElRef.current;
    if (!el) return;
    // onPlay/onPause on the <audio> element sync isPlaying/isPaused state.
    if (el.paused)
      void el.play().catch(() => {
        /* autoplay blocked: user gesture required */
      });
    else el.pause();
  }, []);

  const cycleVizMode = useCallback((dir: 1 | -1) => {
    userPickedVizModeRef.current = true;
    setVizMode((m) => {
      const i = VIZ_MODE_ORDER.indexOf(m);
      return VIZ_MODE_ORDER[(i + dir + VIZ_MODE_ORDER.length) % VIZ_MODE_ORDER.length];
    });
  }, []);

  const handlePlayheadClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioElRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const duration = el.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    el.currentTime = pct * duration;
  }, []);

  return { togglePlayPause, cycleVizMode, handlePlayheadClick };
}
