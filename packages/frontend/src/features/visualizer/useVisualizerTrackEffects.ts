/**
 * useVisualizerTrackEffects — track/audio side-effects that fire outside the
 * selection cascade itself.
 *
 * Extracted from Visualizer.tsx. Owns the three effects that react to track
 * and playback-state changes after `handleSelectLibraryTrack` has run:
 *
 * - lazy per-stem visualization fetch (only when FX mode or the inspector
 *   Mixer tab actually needs it — see T-VIZ-32),
 * - auto-play on track select when the setting is armed,
 * - playback resume across a track switch (the <audio key={audioUrl}>
 *   remount starts paused while isPlaying stays true).
 */
import { useEffect, useRef } from "react";
import type { VizMode } from "./visualizerHelpers";
import type { VizInspectorTab } from "./components/VizInspector";
import type { VisualizerStateSetters } from "./useVisualizerState";
import type { StemsAnalysisResponse } from "../../services/api";

export interface UseVisualizerTrackEffectsOptions {
  state: {
    currentFilename: string | null;
    vizMode: VizMode;
    inspectorOpen: boolean;
    inspectorTab: VizInspectorTab;
    audioUrl: string | null;
    autoPlay: boolean;
    isPlaying: boolean;
  };
  refs: {
    audioElRef: React.MutableRefObject<HTMLAudioElement | null>;
  };
  setters: Pick<VisualizerStateSetters, "setStemsData">;
  api: {
    getStemsAnalysis(filename: string): Promise<StemsAnalysisResponse>;
  };
}

export function useVisualizerTrackEffects({
  state,
  refs,
  setters,
  api,
}: UseVisualizerTrackEffectsOptions): void {
  const { currentFilename, vizMode, inspectorOpen, inspectorTab, audioUrl, autoPlay, isPlaying } =
    state;
  const { audioElRef } = refs;
  const { setStemsData } = setters;
  const { getStemsAnalysis } = api;

  // Fetch per-stem visualization data lazily — only when a consumer actually
  // needs it: FX mode (stem-reactive shader layers via ShaderVisualizer) or
  // the inspector Mixer tab (ProfessionalMixer). Previously this fired on
  // EVERY track select; for tracks with separated stems the backend runs
  // per-stem librosa feature extraction (4 stems) whether or not the user
  // ever opened a stem UI. Fetched once per track per session; a failed
  // fetch is retried on the next activation.
  const stemsFetchedRef = useRef<Set<string>>(new Set());
  const stemsNeeded = vizMode === "shader" || (inspectorOpen && inspectorTab === "mixer");
  useEffect(() => {
    if (!currentFilename || !stemsNeeded) return;
    if (stemsFetchedRef.current.has(currentFilename)) return;
    stemsFetchedRef.current.add(currentFilename);
    let cancelled = false;
    getStemsAnalysis(currentFilename)
      .then((data) => {
        if (!cancelled && data.separated && Object.keys(data.stems).length > 0) {
          setStemsData((prev) => ({
            ...prev,
            [currentFilename]: data.stems,
          }));
        }
      })
      .catch(() => {
        /* stems are optional — never block playback on analysis */
        stemsFetchedRef.current.delete(currentFilename);
      });
    return () => {
      cancelled = true;
    };
  }, [currentFilename, stemsNeeded, getStemsAnalysis, setStemsData]);

  // Auto-play when a track is selected, if the setting is enabled.
  // Uses a small delay so the <audio key={audioUrl}> remount completes
  // and the browser sees the play() as part of the active user gesture chain.
  useEffect(() => {
    if (!audioUrl || !autoPlay) return;
    const timer = setTimeout(() => {
      const el = audioElRef.current;
      if (el) {
        el.play()
          .then(() => {
            // onPlay will fire and run setupAudio()
          })
          .catch(() => {
            // Autoplay blocked by browser policy — user can still press Play manually.
          });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [audioUrl, autoPlay, audioElRef]);

  // Resume across a track switch: the <audio key={audioUrl}> remount starts
  // paused, but isPlaying stays true through the swap (no pause event fires
  // on unmount), so restarting here keeps the music going — the behaviour a
  // listener expects when skipping tracks. The autoPlay effect above already
  // covers the paused-at-selection case, so skip when it is armed.
  const lastAudioUrlRef = useRef(audioUrl);
  useEffect(() => {
    if (audioUrl === lastAudioUrlRef.current) return;
    lastAudioUrlRef.current = audioUrl;
    if (!audioUrl || !isPlaying || autoPlay) return;
    const timer = setTimeout(() => {
      audioElRef.current?.play().catch(() => undefined);
    }, 60);
    return () => clearTimeout(timer);
  }, [audioUrl, isPlaying, autoPlay, audioElRef]);
}
