/**
 * VizAudioBar — the bottom transport strip: custom AudioTransport plus the
 * visually-hidden <audio> element that owns playback, feeding the shared
 * analyser graph via its event handlers.
 *
 * Extracted from Visualizer.tsx (T-VIZ-33) — the element itself must stay
 * mounted for refs/analyser/keyboard to work; only the chrome moved out.
 */
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { AudioTransport } from "../../../components/audio";

interface VizAudioBarProps {
  audioUrl: string;
  audioElRef: MutableRefObject<HTMLAudioElement | null>;
  setupAudio: (el: HTMLMediaElement | null) => Promise<void>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setIsPaused: Dispatch<SetStateAction<boolean>>;
  setAudioDuration: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<string | null>>;
  resetAudioDerivedState: () => void;
}

export function VizAudioBar({
  audioUrl,
  audioElRef,
  setupAudio,
  setIsPlaying,
  setIsPaused,
  setAudioDuration,
  setError,
  resetAudioDerivedState,
}: VizAudioBarProps) {
  return (
    <div className="viz-audio-player">
      {/* Plan 1.1 — one custom transport replaces the browser's stock
          <audio controls>; the element itself stays (refs, analyser and
          keyboard map all drive it) but renders nothing. */}
      <AudioTransport audioRef={audioElRef} ariaLabel="Playback transport" className="mb-2" />
      <audio
        key={audioUrl}
        ref={audioElRef}
        src={audioUrl}
        data-main-player
        className="viz-audio"
        crossOrigin={
          audioUrl.startsWith("http://") || audioUrl.startsWith("https://")
            ? "anonymous"
            : undefined
        }
        onPlay={() => {
          setIsPlaying(true);
          setIsPaused(false);
          if (audioElRef.current) void setupAudio(audioElRef.current);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          setAudioDuration(Number.isFinite(d) && d > 0 ? d : 0);
        }}
        onPause={() => {
          setIsPlaying(false);
          setIsPaused(true);
        }}
        onEnded={() => {
          setIsPlaying(false);
          setIsPaused(false);
          resetAudioDerivedState();
        }}
        onError={() => {
          setIsPlaying(false);
          setError(
            `Couldn't load audio — the file may have moved. Pick another track or re-upload.`,
          );
        }}
        onCanPlay={() => {
          setError(null);
        }}
      />
      {/* Mixer / EQ / Remix live in the inspector drawer now — the
          bottom bar stays a slim transport strip. */}
    </div>
  );
}
