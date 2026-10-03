import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatTime } from "../../utils/format";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export interface AudioTransportProps {
  /**
   * Drive an existing element (renders no `<audio>` of its own). The ref is
   * polled each commit so a remounted element (`key={audioUrl}` on track
   * change) is re-attached without the caller re-keying the transport.
   */
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  /**
   * Render an owned hidden element with this src. When both are given, the
   * owned element is also exposed through `audioRef` (merged ref), so pages
   * that pause their player from elsewhere keep working.
   */
  src?: string;
  crossOrigin?: "anonymous" | "use-credentials" | "";
  autoPlay?: boolean;
  /** Forwarded to an owned `<audio>`; ignored in external-element mode. */
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onError?: () => void;
  onCanPlay?: () => void;
  className?: string;
  ariaLabel?: string;
}

/**
 * One custom transport for every `<audio controls>` in the app (plan 1.1):
 * play/pause, time, seek, volume, speed. Chrome's stock player was visually
 * unrelated to the studio's dark chrome and trippedlicate — this replaces all
 * browser-native audio controls.
 */
export function AudioTransport({
  audioRef,
  src,
  crossOrigin,
  autoPlay,
  onPlay,
  onPause,
  onEnded,
  onError,
  onCanPlay,
  className = "",
  ariaLabel = "Audio transport",
}: AudioTransportProps) {
  const ownedRef = useRef<HTMLAudioElement | null>(null);
  const [el, setEl] = useState<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const scrubbingRef = useRef(false);

  // Resolve the element to drive. Owned elements are picked up through the
  // ref after commit; external refs are re-read every commit so a remounted
  // element (track change) re-attaches without a transport re-key.
  useEffect(() => {
    const next = src ? ownedRef.current : (audioRef?.current ?? null);
    setEl((prev) => (prev === next ? prev : next));
  });

  useEffect(() => {
    if (!el) return;
    const syncTime = () => {
      if (!scrubbingRef.current) setCurrent(el.currentTime);
    };
    const syncMeta = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const syncPlay = () => setPlaying(!el.paused);
    const syncVol = () => {
      setVolume(el.volume);
      setMuted(el.muted);
    };
    const syncRate = () => setRate(el.playbackRate);
    syncTime();
    syncMeta();
    syncPlay();
    syncVol();
    syncRate();
    el.addEventListener("timeupdate", syncTime);
    el.addEventListener("seeked", syncTime);
    el.addEventListener("loadedmetadata", syncMeta);
    el.addEventListener("durationchange", syncMeta);
    el.addEventListener("play", syncPlay);
    el.addEventListener("pause", syncPlay);
    el.addEventListener("ended", syncPlay);
    el.addEventListener("volumechange", syncVol);
    el.addEventListener("ratechange", syncRate);
    return () => {
      el.removeEventListener("timeupdate", syncTime);
      el.removeEventListener("seeked", syncTime);
      el.removeEventListener("loadedmetadata", syncMeta);
      el.removeEventListener("durationchange", syncMeta);
      el.removeEventListener("play", syncPlay);
      el.removeEventListener("pause", syncPlay);
      el.removeEventListener("ended", syncPlay);
      el.removeEventListener("volumechange", syncVol);
      el.removeEventListener("ratechange", syncRate);
    };
  }, [el]);

  const toggle = () => {
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  };

  const seek = (value: number) => {
    if (!el) return;
    el.currentTime = value;
    setCurrent(value);
  };

  const setVol = (value: number) => {
    if (!el) return;
    el.volume = value;
    el.muted = value === 0 ? el.muted : false;
    setVolume(value);
    setMuted(el.muted);
  };

  const toggleMute = () => {
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };

  const changeRate = (value: number) => {
    if (!el) return;
    el.playbackRate = value;
    setRate(value);
  };

  const max = duration > 0 ? duration : 0;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`flex items-center gap-3 min-w-0 flex-1 ${className}`}
    >
      {src && (
        <audio
          ref={(node) => {
            ownedRef.current = node;
            if (audioRef) audioRef.current = node;
          }}
          src={src}
          crossOrigin={crossOrigin}
          autoPlay={autoPlay}
          preload="metadata"
          className="hidden"
          onPlay={onPlay}
          onPause={onPause}
          onEnded={onEnded}
          onError={onError}
          onCanPlay={onCanPlay}
        />
      )}

      <button
        type="button"
        onClick={toggle}
        disabled={!el}
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause" : "Play"}
        className="shrink-0 w-9 h-9 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>

      <span
        className="shrink-0 text-xs font-mono text-[var(--text-secondary)] tabular-nums"
        aria-hidden="true"
      >
        {formatTime(current)} / {formatTime(duration)}
      </span>

      <input
        type="range"
        min={0}
        max={max}
        step={0.01}
        value={Math.min(current, max)}
        disabled={!el || max === 0}
        aria-label="Seek"
        onPointerDown={() => {
          scrubbingRef.current = true;
        }}
        onPointerUp={() => {
          scrubbingRef.current = false;
        }}
        onPointerCancel={() => {
          scrubbingRef.current = false;
        }}
        onChange={(e) => seek(Number(e.target.value))}
        className="flex-1 min-w-16 h-1.5 accent-[var(--color-primary)] cursor-pointer disabled:opacity-40"
      />

      <div className="shrink-0 flex items-center gap-1.5">
        <button
          type="button"
          onClick={toggleMute}
          disabled={!el}
          aria-label={muted ? "Unmute" : "Mute"}
          aria-pressed={muted}
          title={muted ? "Unmute" : "Mute"}
          className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors disabled:opacity-40"
        >
          {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          disabled={!el}
          aria-label="Volume"
          onChange={(e) => setVol(Number(e.target.value))}
          className="w-20 h-1.5 accent-[var(--color-primary)] cursor-pointer disabled:opacity-40"
        />
      </div>

      <label className="shrink-0 flex items-center gap-1 text-xs text-[var(--text-secondary)]">
        <select
          value={rate}
          disabled={!el}
          aria-label="Playback speed"
          title="Playback speed"
          onChange={(e) => changeRate(Number(e.target.value))}
          className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs rounded-md px-1.5 py-1 disabled:opacity-40"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
