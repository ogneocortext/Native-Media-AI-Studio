import { Pause, Play, Square } from "lucide-react";

interface PlaybackControlsProps {
  renderPlaying: boolean;
  animationTime: number;
  animationDuration: number;
  isAudioPlaying: boolean;
  keyframeTracks: any[];
  focusMode: boolean;
  onRenderPlayPause: () => void;
  onRenderRewind: () => void;
  onAudioPlayPause: () => void;
  onAudioStop: () => void;
  onTimelineChange: (time: number) => void;
}

export function PlaybackControls({
  renderPlaying,
  animationTime,
  animationDuration,
  isAudioPlaying,
  keyframeTracks,
  focusMode,
  onRenderPlayPause,
  onRenderRewind,
  onAudioPlayPause,
  onAudioStop,
  onTimelineChange,
}: PlaybackControlsProps) {
  return (
    <div
      className={`playback-controls absolute bottom-10 left-2 right-2 bg-[#12121a]/95 backdrop-blur-md rounded-xl border border-gray-700/60 shadow-2xl shadow-black/40 ${focusMode ? "hidden" : ""}`}
    >
      {/* Main transport row */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        {/* Render Transport */}
        <div className="flex items-center gap-2">
          <button
            onClick={onRenderPlayPause}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${renderPlaying ? "bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-900/40" : "bg-gray-700 hover:bg-gray-600"}`}
            title={renderPlaying ? "Pause render" : "Play render"}
          >
            {renderPlaying ? (
              <Pause size={16} />
            ) : (
              <Play size={16} className="ml-0.5" />
            )}
          </button>
          <button
            onClick={onRenderRewind}
            className="w-9 h-9 rounded-lg bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors"
            title="Rewind to start"
          >
            <Square size={14} />
          </button>
          <div className="flex flex-col items-center">
            <span
              className={`text-xs font-mono font-bold ${renderPlaying ? "text-emerald-400" : "text-gray-300"}`}
            >
              {Math.floor(animationTime / 60)}:
              {String(Math.floor(animationTime % 60)).padStart(2, "0")}
            </span>
            <span className="text-[9px] text-gray-500 uppercase tracking-wider">
              Render
            </span>
          </div>
        </div>

        {/* Divider */}
        <div className="w-px h-8 bg-gray-700/60" />

        {/* Audio Transport */}
        <div className="flex items-center gap-2">
          <button
            onClick={onAudioPlayPause}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${isAudioPlaying ? "bg-purple-600 hover:bg-purple-500 shadow-lg shadow-purple-900/40" : "bg-gray-700 hover:bg-gray-600"}`}
            title={isAudioPlaying ? "Pause audio" : "Play audio"}
          >
            {isAudioPlaying ? (
              <Pause size={16} />
            ) : (
              <Play size={16} className="ml-0.5" />
            )}
          </button>
          <button
            onClick={onAudioStop}
            className="w-9 h-9 rounded-lg bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors"
            title="Stop all"
          >
            <Square size={14} />
          </button>
          <div className="flex flex-col items-center">
            <span
              className={`text-xs font-mono font-bold ${isAudioPlaying ? "text-purple-400" : "text-gray-300"}`}
            >
              {isAudioPlaying ? "LIVE" : "— : —"}
            </span>
            <span className="text-[9px] text-gray-500 uppercase tracking-wider">
              Audio
            </span>
          </div>
        </div>

        {/* Divider */}
        <div className="w-px h-8 bg-gray-700/60" />

        {/* Timeline Scrubber */}
        <div className="flex-1 flex items-center gap-2 px-2">
          <span className="text-[10px] text-gray-500 font-mono">
            {animationTime.toFixed(1)}s
          </span>
          <div className="flex-1 relative">
            <input
              type="range"
              min={0}
              max={animationDuration}
              step={0.1}
              value={animationTime}
              onChange={(e) => onTimelineChange(Number(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-full appearance-none cursor-pointer accent-purple-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-purple-900/50"
            />
          </div>
          <span className="text-[10px] text-gray-500 font-mono">
            {animationDuration.toFixed(0)}s
          </span>
        </div>

        {/* Keyframe indicator */}
        {keyframeTracks.length > 0 && (
          <span className="text-[10px] text-purple-400 bg-purple-900/30 px-2 py-1 rounded-md font-medium">
            {keyframeTracks.length} keyframes
          </span>
        )}
      </div>
    </div>
  );
}
