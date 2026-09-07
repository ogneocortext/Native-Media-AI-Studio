import {
  Box,
  ChevronDown,
  ChevronUp,
  Download,
  FileCode,
  Maximize2,
  Minimize2,
  Music,
  Sparkles,
  User,
  Zap,
} from "lucide-react";

interface StudioHeaderProps {
  focusMode: boolean;
  drawerOpen: boolean;
  codePanelOpen: boolean;
  performanceMode: boolean;
  selectedTrack: string;
  isAudioPlaying: boolean;
  tracksLoading: boolean;
  tracksError: string | null;
  libraryTracks: Array<{ filename: string }>;
  trackMetadata: Record<string, { bpm?: number; duration?: number }>;
  onExportFrame: () => void;
  onToggleCodePanel: () => void;
  onTogglePerformanceMode: () => void;
  onToggleFocusMode: () => void;
  onToggleDrawer: () => void;
  onAddObject: (type: "crown" | "sphere" | "box" | "character") => void;
  onSelectTrack: (filename: string) => void;
  onViewportReset: () => void;
}

export function StudioHeader({
  focusMode,
  drawerOpen,
  codePanelOpen,
  performanceMode,
  selectedTrack,
  isAudioPlaying,
  tracksLoading,
  tracksError,
  libraryTracks,
  trackMetadata,
  onExportFrame,
  onToggleCodePanel,
  onTogglePerformanceMode,
  onToggleFocusMode,
  onToggleDrawer,
  onAddObject,
  onSelectTrack,
  onViewportReset,
}: StudioHeaderProps) {
  const meta = selectedTrack ? trackMetadata[selectedTrack] : undefined;
  const metaStr = meta?.bpm && meta?.duration ? ` (${meta.bpm} BPM, ${meta.duration}s)` : "";

  return (
    <div
      className={`header-bar flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 bg-[#0f0f14]/90 backdrop-blur-xl border-b border-white/5 shrink-0 min-w-0 ${focusMode ? "hidden" : ""}`}
    >
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center">
          <Sparkles size={14} className="text-white" />
        </div>
        <span className="font-semibold text-sm hidden lg:inline">Three.js Studio</span>
      </div>
      <div className="w-px h-6 bg-white/10 mx-1 hidden lg:block" />
      {/* Object palette — grouped, larger hit area */}
      <div className="flex items-center gap-1 p-1 bg-black/30 rounded-xl border border-white/5 shrink-0">
        <button onClick={() => onAddObject("crown")} className="p-2 bg-white/5 hover:bg-violet-600 hover:text-white rounded-lg text-xs transition-all hover:scale-105 active:scale-95" title="Add Crown"><span className="text-sm">👑</span></button>
        <button onClick={() => onAddObject("sphere")} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-all hover:scale-105 active:scale-95 hidden sm:flex" title="Add Sphere"><Box size={14} /></button>
        <button onClick={() => onAddObject("box")} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-all hover:scale-105 active:scale-95 hidden sm:flex" title="Add Box"><Box size={14} /></button>
        <button onClick={() => onAddObject("character")} className="p-2 bg-amber-500/20 hover:bg-amber-500/30 rounded-lg border border-amber-500/20 transition-all hover:scale-105 active:scale-95" title="Add Character"><User size={14} className="text-amber-300" /></button>
      </div>
      <button onClick={onViewportReset} className="p-2 bg-white/5 hover:bg-white/10 rounded-xl border border-white/5 transition-all hover:scale-105 active:scale-95 shrink-0" title="Reset Camera"><Maximize2 size={14} /></button>
      {/* Track selector — larger, clearer */}
      <div className="flex items-center gap-2 ml-1 sm:ml-2 bg-black/30 px-3 py-1.5 rounded-xl border border-white/5 flex-1 min-w-0 max-w-[280px]">
        <Music size={14} className="text-violet-400 shrink-0" />
        <select
          value={selectedTrack}
          onChange={(e) => onSelectTrack(e.target.value)}
          className="bg-transparent text-sm text-white outline-none flex-1 min-w-0 truncate placeholder:text-white/40"
          disabled={tracksLoading}
        >
          {tracksLoading && (
            <option value="" className="bg-gray-800">Loading tracks…</option>
          )}
          {!tracksLoading && tracksError && (
            <option value="" className="bg-gray-800">Error loading tracks</option>
          )}
          {!tracksLoading && !tracksError && libraryTracks.length === 0 && (
            <option value="" className="bg-gray-800">No tracks in library</option>
          )}
          {!tracksLoading && !tracksError && libraryTracks.length > 0 && (
            <option value="" className="bg-gray-800">Select track…</option>
          )}
          {!tracksLoading &&
            !tracksError &&
            libraryTracks.map((t) => {
              const displayName = t.filename
                .replace(/^[0-9a-f]{8}_[0-9a-f]{8}_/i, "")
                .replace(/\.(mp3|wav|flac|ogg)$/i, "");
              const sameNameCount = libraryTracks.filter((x) => {
                const xName = x.filename
                  .replace(/^[0-9a-f]{8}_[0-9a-f]{8}_/i, "")
                  .replace(/\.(mp3|wav|flac|ogg)$/i, "");
                return xName === displayName;
              }).length;
              const needsDisambiguation = sameNameCount > 1;
              const shortHash = t.filename.match(/^[0-9a-f]{8}/)?.[0] || "";
              const label =
                needsDisambiguation && shortHash
                  ? `${displayName} [${shortHash}]${metaStr}`
                  : `${displayName}${metaStr}`;
              return (
                <option key={t.filename} value={t.filename} className="bg-gray-800">
                  {label}
                </option>
              );
            })}
        </select>
        {!tracksLoading && selectedTrack && isAudioPlaying && (
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0 shadow-lg shadow-emerald-400/50" title="Playing" />
        )}
      </div>
      {/* Right controls — grouped, larger, performance toggle */}
      <div className="flex items-center gap-1 p-1 bg-black/30 rounded-xl border border-white/5 shrink-0">
        <button onClick={onExportFrame} className="p-2.5 bg-white/5 hover:bg-white/10 rounded-lg transition-all hover:scale-105 active:scale-95" title="Export frame as PNG"><Download size={14} /></button>
        <button onClick={onToggleCodePanel} className={`p-2.5 rounded-lg transition-all hover:scale-105 active:scale-95 ${codePanelOpen ? "bg-emerald-600 text-white shadow-lg" : "bg-white/5 hover:bg-white/10"}`} title="Paste generated code"><FileCode size={14} /></button>
        <button onClick={onTogglePerformanceMode} className={`p-2.5 rounded-lg transition-all hover:scale-105 active:scale-95 ${performanceMode ? "bg-amber-600 text-white shadow-lg shadow-amber-500/20" : "bg-white/5 hover:bg-white/10"}`} title={performanceMode ? "Performance mode ON (reduced effects)" : "Performance mode OFF"}><Zap size={14} /></button>
        <button onClick={onToggleFocusMode} className={`p-2.5 rounded-lg transition-all hover:scale-105 active:scale-95 ${focusMode ? "bg-violet-600 text-white" : "bg-white/5 hover:bg-white/10"}`} title={focusMode ? "Exit focus mode" : "Focus mode"}>{focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        <button onClick={onToggleDrawer} className={`p-2.5 rounded-lg transition-all hover:scale-105 active:scale-95 ${drawerOpen ? "bg-violet-600 text-white" : "bg-white/5 hover:bg-white/10"}`} title="Toggle controls panel">{drawerOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
      </div>
    </div>
  );
}
