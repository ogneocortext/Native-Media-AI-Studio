import { useEffect, useRef } from "react";
import { useBeatTimeline } from "../../../hooks/useBeatTimeline";
import { listAudioFiles } from "../../../services/api";
import type { UseTrackManagerOptions, UseTrackManagerResult } from "./types";

export function useTrackManager({
  selectedTrack,
  setSelectedTrack,
  isAudioPlaying,
  setIsAudioPlaying,
  setIsPlaying,
  setRenderPlaying,
  setBeatSync,
  setBpm,
  setTrackMetadata,
  setLibraryTracks,
  setTracksLoading,
  setTracksError,
  addObject,
  audioElementRef,
  audioContextRef,
  analyserRef,
  audioSourceRef,
}: UseTrackManagerOptions): UseTrackManagerResult {
  const {
    analysis: beatAnalysis,
    loading: beatLoading,
    error: beatError,
    getCurrentBeat,
  } = useBeatTimeline(selectedTrack || null);

  const getCurrentBeatRef = useRef(getCurrentBeat);
  useEffect(() => {
    getCurrentBeatRef.current = getCurrentBeat;
  }, [getCurrentBeat]);

  // Load library tracks
  useEffect(() => {
    setTracksLoading(true);
    setTracksError(null);
    listAudioFiles()
      .then((f: any) => {
        if (Array.isArray(f) && f.length > 0) {
          setLibraryTracks(f);
        } else {
          setLibraryTracks([]);
        }
      })
      .catch((err: any) => {
        setTracksError(err.message || "Failed to load tracks");
        setLibraryTracks([]);
      })
      .finally(() => setTracksLoading(false));
  }, [setLibraryTracks, setTracksLoading, setTracksError]);

  // Fetch metadata (BPM/duration) for selected track only
  useEffect(() => {
    if (!selectedTrack) {
      setTrackMetadata({});
      return;
    }
    const fetchMetadata = async () => {
      const metadata: Record<string, { bpm?: number; duration?: number }> = {};
      try {
        const res = await fetch(
          `/api/audio/analysis/${encodeURIComponent(selectedTrack)}`,
        );
        if (res.ok) {
          const data: any = await res.json();
          metadata[selectedTrack] = {
            bpm: data.tempo_bpm ? Math.round(data.tempo_bpm) : undefined,
            duration: data.duration_seconds
              ? Math.round(data.duration_seconds)
              : undefined,
          };
        }
      } catch {
        /* ignore */
      }
      setTrackMetadata(metadata);
    };
    fetchMetadata();
  }, [selectedTrack, setTrackMetadata]);

  // Auto-set BPM from analysis metadata when it loads
  useEffect(() => {
    if (beatAnalysis?.tempo_bpm) {
      setBpm(Math.round(beatAnalysis.tempo_bpm));
    }
  }, [beatAnalysis, setBpm]);

  const handleSelectTrack = (filename: string) => {
    const wasPlaying = isAudioPlaying;
    setSelectedTrack(filename);
    setBeatSync(true);
    if (wasPlaying && audioElementRef.current) {
      setIsAudioPlaying(false);
      setTimeout(() => {
        audioElementRef.current?.play().catch(() => {});
      }, 50);
    }
  };

  const toggleAudio = async () => {
    if (!audioElementRef.current) return;
    try {
      if (!audioContextRef.current) {
        const AudioCtx =
          window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        if (!audioSourceRef.current) {
          const source = ctx.createMediaElementSource(audioElementRef.current);
          source.connect(analyser);
          analyser.connect(ctx.destination);
          audioSourceRef.current = source;
        }
      }
      if (audioContextRef.current.state === "suspended")
        await audioContextRef.current.resume();
      if (isAudioPlaying) {
        audioElementRef.current.pause();
        setIsAudioPlaying(false);
        setIsPlaying(false);
      } else {
        await audioElementRef.current.play();
        setIsAudioPlaying(true);
        setIsPlaying(true);
        setRenderPlaying(true);
      }
    } catch (err) {
      console.error("Audio playback error:", err);
    }
  };

  // Handoff from Generation3DPage / Media Library
  const handoffConsumedRef = useRef(false);
  useEffect(() => {
    if (handoffConsumedRef.current) return;
    handoffConsumedRef.current = true;
    try {
      const raw = localStorage.getItem("pendingCharacter");
      if (!raw) return;
      localStorage.removeItem("pendingCharacter");
      const handoff = JSON.parse(raw) as { modelUrl?: string; name?: string; bible?: string };
      if (!handoff?.modelUrl) return;
      addObject("character", {
        ...(handoff.name ? { name: handoff.name } : {}),
        modelUrl: handoff.modelUrl,
        ...(handoff.bible ? { characterBible: handoff.bible } : {}),
      });
    } catch {
      /* malformed handoff — ignore */
    }
  }, [addObject]);

  // Live queue from Media Library while Studio stays open
  useEffect(() => {
    const handleQueue = (raw: string | null) => {
      if (!raw) return;
      try {
        const handoff = JSON.parse(raw) as { modelUrl?: string; name?: string; bible?: string };
        if (!handoff?.modelUrl) return;
        addObject("character", {
          ...(handoff.name ? { name: handoff.name } : {}),
          modelUrl: handoff.modelUrl,
          ...(handoff.bible ? { characterBible: handoff.bible } : {}),
        });
        localStorage.removeItem("pendingCharacter");
      } catch {}
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === "pendingCharacter" && e.newValue) handleQueue(e.newValue);
    };
    const onCustom = (e: Event) => {
      const custom = e as CustomEvent<string>;
      if (custom.detail) handleQueue(custom.detail);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pendingCharacter", onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pendingCharacter", onCustom as EventListener);
    };
  }, [addObject]);

  return {
    beatAnalysis,
    beatLoading,
    beatError,
    getCurrentBeat,
    getCurrentBeatRef,
    handleSelectTrack,
    toggleAudio,
  };
}
