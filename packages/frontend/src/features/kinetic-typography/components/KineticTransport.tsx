/**
 * KineticTransport — the kinetic-typography preview's playback strip:
 * restart / play-pause / forward-5s, scrubber, time readout, mute and
 * volume, plus the keyboard-hint footer. Extracted from
 * KineticTypographyPage so the page component stays focused on track
 * loading, presets and render orchestration.
 */
import type { MutableRefObject } from "react";
import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { formatTime } from "../../../utils/format";

export interface KineticTransportProps {
  isPlaying: boolean;
  elapsed: number;
  /** Live elapsed mirror — the +5s button reads it without a stale closure. */
  elapsedRef: MutableRefObject<number>;
  playbackDuration: number;
  isMuted: boolean;
  volume: number;
  onTogglePlay: () => void;
  onSeek: (t: number) => void;
  onToggleMute: () => void;
  /** Sets volume and clears mute in one step. */
  onVolumeChange: (v: number) => void;
}

export function KineticTransport({
  isPlaying,
  elapsed,
  elapsedRef,
  playbackDuration,
  isMuted,
  volume,
  onTogglePlay,
  onSeek,
  onToggleMute,
  onVolumeChange,
}: KineticTransportProps) {
  return (
    <>
      {/* Transport */}
      <div className="kt-transport" role="group" aria-label="Playback controls">
        <button
          className="kt-transport-btn"
          onClick={() => onSeek(0)}
          aria-label="Restart"
          title="Restart (R)"
        >
          <SkipBack size={14} />
        </button>
        <button
          className="kt-transport-btn kt-transport-play"
          onClick={onTogglePlay}
          aria-label={isPlaying ? "Pause" : "Play"}
          title="Play/Pause (Space)"
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button
          className="kt-transport-btn"
          onClick={() => onSeek(elapsedRef.current + 5)}
          aria-label="Forward 5 seconds"
          title="Forward 5s (→)"
        >
          <SkipForward size={14} />
        </button>
        <div className="kt-scrubber">
          <input
            type="range"
            min="0"
            max={playbackDuration}
            step="0.1"
            value={Math.min(elapsed, playbackDuration)}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="kt-scrubber-input"
            aria-label="Seek"
          />
        </div>
        <span className="kt-time">
          {formatTime(elapsed)} / {formatTime(playbackDuration)}
        </span>
        <button
          className="kt-transport-btn"
          onClick={onToggleMute}
          aria-label={isMuted ? "Unmute" : "Mute"}
          title="Mute (M)"
        >
          {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={isMuted ? 0 : volume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          className="kt-volume-slider"
          aria-label="Volume"
        />
      </div>

      {/* Keyboard hints */}
      <div className="kt-keyboard-hints">
        <span className="kt-keyboard-hint">
          <kbd>Space</kbd> Play/Pause
        </span>
        <span className="kt-keyboard-hint">
          <kbd>←</kbd>
          <kbd>→</kbd> Scrub
        </span>
        <span className="kt-keyboard-hint">
          <kbd>R</kbd> Restart
        </span>
        <span className="kt-keyboard-hint">
          <kbd>M</kbd> Mute
        </span>
      </div>
    </>
  );
}
