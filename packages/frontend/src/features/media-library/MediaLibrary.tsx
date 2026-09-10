import React, { useState, useEffect, useMemo, useDeferredValue, useRef, memo } from "react";
import { useNavigate } from "react-router-dom";
import { useOutputStore, OutputFile } from "../../state/outputStore";
import { formatFileSize, formatDate, formatDateTime } from "../../utils/format";
import { getOutputUrl } from "../../utils/url";
import { StatCard } from "./MediaLibraryStats";
import { openInBlender, openInUnity, probeMedia, getMediaLoudness, getMediaWaveform, extractThumbnailAtTime, regenerateAudioCover, ensureAnalysis } from "../../services/api";
import { setPendingTrack } from "../../utils/pendingTrack";
import { MediaDetailModal, MediaInfoPayload, LoudnessResult, WaveformResult } from "./MediaDetailModal";
import {
  Image,
  Video,
  Music,
  Grid,
  List,
  Download,
  RefreshCw,
  Search,
  Calendar,
  FileType,
  HardDrive,
  X,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Clock,
  Trash2,
  AlertTriangle,
  Pencil,
  Copy,
  CheckSquare,
  Check,
  Square,
  Users,
  ArrowUpDown,
  Layers,
  Box,
  Sparkles,
  Eye,
  Play,
  Activity,
  MoreHorizontal,
} from "lucide-react";

const categoryConfig = [
  { key: "all", label: "All Files", icon: HardDrive, color: "text-primary" },
  { key: "image", label: "Images", icon: Image, color: "text-purple-400" },
  { key: "video", label: "Videos", icon: Video, color: "text-blue-400" },
  { key: "audio", label: "Audio", icon: Music, color: "text-green-400" },
  { key: "3d", label: "3D Models", icon: Box, color: "text-amber-400" },
] as const;

function useDebounce<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const id = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(id); }, [value, delay]);
  return debounced;
}

const ITEMS_PER_PAGE = 24;

const typeAccent: Record<string, string> = {
  video: "border-l-4 border-l-blue-500/60 bg-blue-500/[0.04] hover:bg-blue-500/[0.08]",
  audio: "border-l-4 border-l-emerald-500/60 bg-emerald-500/[0.04] hover:bg-emerald-500/[0.08]",
  image: "border-l-4 border-l-purple-500/60 bg-purple-500/[0.04] hover:bg-purple-500/[0.08]",
  "3d": "border-l-4 border-l-amber-500/60 bg-amber-500/[0.04] hover:bg-amber-500/[0.08]",
  other: "",
};

function is3DModelFile(filename: string) { return /\.(glb|gltf|fbx|obj)$/i.test(filename || ""); }

const MediaCard = memo(function MediaCard({ output, index, selected, isDup, onSelect, onToggle, onDelete, onRename, onOpenBlender, onOpenUnity, onAddToStudio, onAnalyze, onSendToVisualizer, onSendToWizard }: {
  output: OutputFile; index: number; selected: boolean; isDup: boolean;
  onSelect: () => void; onToggle: (e: React.MouseEvent) => void; onDelete: (e: React.MouseEvent) => void; onRename: (e: React.MouseEvent) => void; onOpenBlender?: (e: React.MouseEvent) => void; onOpenUnity?: (e: React.MouseEvent) => void; onAddToStudio?: (e: React.MouseEvent) => void; onAnalyze?: (e: React.MouseEvent) => void; onSendToVisualizer?: (output: OutputFile) => void; onSendToWizard?: (output: OutputFile) => void;
}) {
  const [previewArmed, setPreviewArmed] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);

  const armPreview = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setPreviewArmed(true), 180);
  };
  const disarmPreview = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    setPreviewArmed(false);
    setShowActions(false);
  };
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  useEffect(() => {
    if (!showActions) return;
    const onDocClick = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) setShowActions(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showActions]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${output.file_type} ${output.filename}${selected ? " (selected)" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); }
      }}
      onMouseEnter={armPreview}
      onMouseLeave={disarmPreview}
      onFocus={armPreview}
      onBlur={disarmPreview}
      style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
      className={`group card overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/30 focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none transition-all duration-300 hover:shadow-xl hover:shadow-primary/10 hover:-translate-y-1 animate-in fade-in slide-in-from-bottom-2 fill-mode-both ${typeAccent[output.file_type] || ""}`}
    >
      <div className="aspect-square bg-surface flex items-center justify-center relative overflow-hidden">
        <button onClick={onToggle} className={`absolute top-2 right-2 z-20 w-7 h-7 rounded-lg flex items-center justify-center border backdrop-blur transition-all ${selected ? "bg-violet-600 border-violet-500 text-white shadow-lg" : "bg-black/40 border-white/20 text-white/70 hover:bg-black/60"}`} title={selected ? "Deselect" : "Select for bulk"}><span className="transition-transform group-hover:scale-110">{selected ? <CheckSquare size={14} /> : <Square size={14} />}</span></button>
        {isDup && <div className="absolute top-2 left-2 z-20 w-6 h-6 rounded-full bg-amber-500/90 border border-amber-600 flex items-center justify-center" title="Duplicate"><Copy size={10} className="text-white" /></div>}
        {output.file_type === "image" ? (
          <img src={getOutputUrl(output.relative_path)} alt={output.filename} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
        ) : is3DModelFile(output.filename) ? (
          <div className="w-full h-full relative group-hover:scale-105 transition-transform duration-500"><img src={`/api/outputs/3d/thumbnail/${encodeURIComponent(output.filename)}`} alt={output.filename} className="w-full h-full object-cover" loading="lazy" /><div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" /></div>
        ) : output.file_type === "video" && output.cover_image ? (
          <img src={getOutputUrl(output.cover_image)} alt={output.filename} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
        ) : output.file_type === "video" && output.metadata?.corrupted ? (
          <div className="flex flex-col items-center gap-2 text-red-400"><AlertTriangle className="w-10 h-10 animate-pulse" /><span className="text-xs uppercase tracking-widest">Corrupted</span></div>
        ) : output.file_type === "video" ? (
          previewArmed ? <video src={getOutputUrl(output.relative_path)} muted loop playsInline autoPlay preload="metadata" disablePictureInPicture className="w-full h-full object-cover" /> : <div className="flex flex-col items-center gap-2 text-muted group-hover:text-blue-400 transition-colors"><Video className="w-12 h-12" /><span className="text-xs uppercase tracking-widest">Video</span><span className="absolute bottom-2 left-2 flex items-center gap-1 text-[11px] bg-black/60 px-1.5 py-0.5 rounded text-white"><Play size={10} /> hover to preview</span></div>
        ) : output.file_type === "audio" && output.cover_image ? (
          <img src={getOutputUrl(output.cover_image)} alt={output.filename} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
        ) : output.file_type === "audio" ? (
          <div className="flex flex-col items-center gap-2 text-muted group-hover:text-emerald-400 transition-colors"><Music className="w-12 h-12" /><span className="text-xs uppercase tracking-widest">Audio</span></div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted"><FileType className="w-12 h-12" /><span className="text-xs uppercase">{output.file_type}</span></div>
        )}
        {output.file_type === "audio" && output.cover_image && <div className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-black/60 backdrop-blur flex items-center justify-center border border-white/10"><Music size={12} className="text-white" /></div>}

        {/* Primary hover actions */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center gap-2 p-2">
          <a href={getOutputUrl(output.relative_path)} download onClick={stop} className="p-2.5 bg-white/10 backdrop-blur rounded-xl hover:bg-white/20 text-white hover:scale-110 transition-all" title="Download"><Download size={16} /></a>
          {output.file_type === "audio" && (
            <>
              <button onClick={(e) => { stop(e); onAnalyze?.(e as any); }} className="p-2.5 bg-emerald-500/20 backdrop-blur rounded-xl hover:bg-emerald-500/40 text-emerald-300 hover:text-emerald-200 hover:scale-110 transition-all" title="Analyze audio"><Activity size={16} /></button>
              <button onClick={(e) => { stop(e); onSendToVisualizer?.(output); }} className="p-2.5 bg-violet-500/20 backdrop-blur rounded-xl hover:bg-violet-500/40 text-violet-300 hover:text-violet-200 hover:scale-110 transition-all" title="Send to Visualizer"><Sparkles size={16} /></button>
              <button onClick={(e) => { stop(e); onSendToWizard?.(output); }} className="p-2.5 bg-blue-500/20 backdrop-blur rounded-xl hover:bg-blue-500/40 text-blue-300 hover:text-blue-200 hover:scale-110 transition-all" title="Send to Music Video Wizard"><Video size={16} /></button>
            </>
          )}
          {is3DModelFile(output.filename) && onAddToStudio && (
            <button onClick={onAddToStudio} className="p-2.5 bg-violet-600/80 backdrop-blur rounded-xl hover:bg-violet-500 text-white hover:scale-110 transition-all shadow-lg" title="Add to Studio"><Sparkles size={16} /></button>
          )}
          <div className="relative" ref={actionsRef}>
            <button onClick={(e) => { stop(e); setShowActions(v => !v); }} className="p-2.5 bg-white/10 backdrop-blur rounded-xl hover:bg-white/20 text-white hover:scale-110 transition-all" title="More actions"><MoreHorizontal size={16} /></button>
            {showActions && (
              <div className="absolute bottom-full mb-2 right-0 bg-gray-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden min-w-[180px] z-30">
                <button onClick={(e) => { stop(e); onRename(e); setShowActions(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white hover:bg-white/10"><Pencil size={14} />Rename</button>
                <button onClick={(e) => { stop(e); onDelete(e); setShowActions(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10"><Trash2 size={14} />Delete</button>
                <button onClick={(e) => { stop(e); onSelect(); setShowActions(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white hover:bg-white/10"><Eye size={14} />Quick view</button>
                {is3DModelFile(output.filename) && (
                  <>
                    {onOpenBlender && <button onClick={(e) => { stop(e); onOpenBlender(e); setShowActions(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-orange-300 hover:bg-orange-500/10"><Box size={14} />Open in Blender</button>}
                    {onOpenUnity && <button onClick={(e) => { stop(e); onOpenUnity(e); setShowActions(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-300 hover:bg-blue-500/10"><Layers size={14} />Open in Unity</button>}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="absolute top-2 left-2 flex gap-1.5">
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border backdrop-blur ${output.file_type==="video"?"bg-blue-500/20 text-blue-300 border-blue-500/30":output.file_type==="audio"?"bg-emerald-500/20 text-emerald-300 border-emerald-500/30":output.file_type==="image"?"bg-purple-500/20 text-purple-300 border-purple-500/30":"bg-gray-500/20 text-gray-300 border-gray-500/30"}`}>{output.file_type}</span>
        </div>
        {is3DModelFile(output.filename) && <div className="absolute top-2 left-20 z-10 w-6 h-6 rounded-md bg-violet-500/20 border border-violet-500/50 flex items-center justify-center backdrop-blur" title="3D"><Box size={12} className="text-violet-300" /></div>}
      </div>
      <div className="p-3">
        <p className="text-sm text-white truncate font-medium" title={output.filename}>{output.filename}</p>
        <div className="flex items-center justify-between mt-1.5 text-xs text-muted">
          <span className="flex items-center gap-1 whitespace-nowrap"><HardDrive size={11} />{formatFileSize(output.size_bytes)}</span>
          <span className="flex items-center gap-1 whitespace-nowrap"><Clock size={11} />{formatDate(output.created_at)}</span>
        </div>
        {output.file_type === "audio" && onAnalyze && (
          <button onClick={(e) => { stop(e); onAnalyze(e); }} className="mt-2 w-full py-1.5 px-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-300 hover:bg-emerald-500/20 hover:text-emerald-200 transition-all flex items-center justify-center gap-1.5">
            <Activity size={12} />
            <span>Analyze audio</span>
          </button>
        )}
      </div>
    </div>
  );
});

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {Array.from({length: 10}).map((_,i)=>(
        <div key={i} className="card overflow-hidden animate-pulse">
          <div className="aspect-square bg-surface flex items-center justify-center"><div className="w-full h-full bg-white/5 shimmer" /></div>
          <div className="p-3 space-y-2"><div className="h-3 bg-white/10 rounded w-3/4 shimmer" /><div className="h-2 bg-white/5 rounded w-1/2" /></div>
        </div>
      ))}
    </div>
  );
}

export function MediaLibrary() {
  const navigate = useNavigate();
  const { outputs, isLoading, error, filter, counts, fetchOutputs, fetchRecent, setFilter, fetchByType, deleteOutput } = useOutputStore();
  const [viewMode, setViewMode] = useState<"grid"|"list">("grid");
  const [selectedOutput, setSelectedOutput] = useState<OutputFile|null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 350);
  const deferredSearch = useDeferredValue(debouncedSearch);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [outputToDelete, setOutputToDelete] = useState<OutputFile|null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showFullImage, setShowFullImage] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [renameTarget, setRenameTarget] = useState<OutputFile|null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<Array<{hash:string;count:number;size_bytes:number;wasted_bytes:number;files:Array<{filename:string;relative_path:string;size_bytes:number;created_at:string}>}>|null>(null);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [isFindingDupes, setIsFindingDupes] = useState(false);
  const [sortBy, setSortBy] = useState<"newest"|"oldest"|"name-asc"|"name-desc"|"size-desc"|"size-asc"|"type">("newest");
  const [groupByType, setGroupByType] = useState(false);
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [openingApp, setOpeningApp] = useState<null | "blender" | "unity" | "studio">(null);
  const [studioToast, setStudioToast] = useState<string | null>(null);
  const [mediaInfo, setMediaInfo] = useState<MediaInfoPayload | null>(null);
  const [mediaInfoLoading, setMediaInfoLoading] = useState(false);
  const [mediaInfoError, setMediaInfoError] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [thumbnailLoading, setThumbnailLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const mediaInfoCache = useRef<Map<string, MediaInfoPayload>>(new Map());
  const MEDIA_INFO_CACHE_MAX = 50;

  useEffect(() => { fetchOutputs(); fetchRecent(12); }, [fetchOutputs, fetchRecent, filter.type]);
  useEffect(() => { if (deferredSearch !== filter.search) setFilter({ search: deferredSearch }); }, [deferredSearch]);
  useEffect(() => { setVisibleCount(ITEMS_PER_PAGE); }, [filter.type, deferredSearch, sortBy, groupByType, outputs.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key==="/") && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); searchInputRef.current?.focus(); }
      if (e.key==="Escape") { setSelectedOutput(null); setShowFullImage(false); setOutputToDelete(null); setRenameTarget(null); }
      if (e.key==="g" && !e.ctrlKey && !(e.target instanceof HTMLInputElement)) setGroupByType(v=>!v);
    };
    window.addEventListener("keydown", onKey); return ()=> window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!selectedOutput || !["audio","video"].includes(selectedOutput.file_type)) { setMediaInfo(null); setMediaInfoError(null); setThumbnailUrl(null); return; }
    const cached = mediaInfoCache.current.get(selectedOutput.relative_path);
    if (cached) { setMediaInfo(cached); setMediaInfoLoading(false); setMediaInfoError(null); return; }
    let cancelled = false;
    setMediaInfoLoading(true); setMediaInfoError(null); setMediaInfo(null); setThumbnailUrl(null);
    (async () => {
      try {
        const [probe, loudness, waveform] = await Promise.all([
          probeMedia(selectedOutput.relative_path).catch(() => ({ probe: null }) as Record<string, unknown>),
          selectedOutput.file_type === "audio" ? getMediaLoudness(selectedOutput.relative_path).catch(() => ({ integrated_lufs: null, loudness_range: null, true_peak: null } as Record<string, unknown>)) : Promise.resolve(null),
          selectedOutput.file_type === "audio" ? getMediaWaveform(selectedOutput.relative_path, 120).catch(() => ({ peaks: [] } as Record<string, unknown>)) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const payload: MediaInfoPayload = { probe: probe as MediaInfoPayload["probe"], loudness: loudness as LoudnessResult | null, waveform: waveform as WaveformResult | null };
        const cache = mediaInfoCache.current;
        if (cache.size >= MEDIA_INFO_CACHE_MAX) {
          const firstKey = cache.keys().next().value;
          if (firstKey) cache.delete(firstKey);
        }
        cache.set(selectedOutput.relative_path, payload);
        setMediaInfo(payload);
      } catch (err) {
        if (!cancelled) setMediaInfoError(err instanceof Error ? err.message : "Failed to load media info");
      } finally {
        if (!cancelled) setMediaInfoLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedOutput]);

  const handleRefresh = async () => { setIsRefreshing(true); await fetchOutputs(); await fetchRecent(12); setIsRefreshing(false); };
  const handleFilterChange = (type: "all"|"image"|"video"|"audio"|"3d") => {
    setFilter({ type }); if (type!=="all") fetchByType(type==="image"?"images": type==="video"?"video": type==="3d"?"3d":"audio" as any); else fetchOutputs();
  };
  const handleSearch = () => setFilter({ search: searchTerm, dateFrom, dateTo });
  const handleClearFilters = () => { setSearchTerm(""); setDateFrom(""); setDateTo(""); setFilter({ search:"", dateFrom:"", dateTo:"" }); };
  const handleDelete = async (output: OutputFile) => {
    setIsDeleting(true); try { await deleteOutput(output.relative_path); setOutputToDelete(null); setSelectedOutput(null); setSelectedPaths(prev=>{const n=new Set(prev); n.delete(output.relative_path); return n;}); await fetchOutputs(); } catch(e){ console.error(e);} finally{ setIsDeleting(false); }
  };
  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim() || renameValue===renameTarget.filename){ setRenameTarget(null); return; }
    setIsRenaming(true); try { await useOutputStore.getState().renameOutput(renameTarget.relative_path, renameValue.trim()); setRenameTarget(null); setRenameValue(""); setSelectedOutput(null);} catch(e){ alert(e instanceof Error?e.message:"Rename failed");} finally{ setIsRenaming(false); }
  };
  const toggleSelect = (path:string)=> setSelectedPaths(prev=>{const n=new Set(prev); if(n.has(path)) n.delete(path); else n.add(path); return n;});
  const lastSelectedIdx = useRef<number | null>(null);
  /** Shift+click selects the range since the last toggle (flat view). */
  const toggleSelectRange = (e: React.MouseEvent, idx: number, path: string, list: OutputFile[]) => {
    if (e.shiftKey && lastSelectedIdx.current !== null && list[lastSelectedIdx.current]) {
      const [a, b] = [Math.min(lastSelectedIdx.current, idx), Math.max(lastSelectedIdx.current, idx)];
      setSelectedPaths(prev => {
        const n = new Set(prev);
        for (let k = a; k <= b; k++) n.add(list[k].relative_path);
        return n;
      });
    } else {
      toggleSelect(path);
    }
    lastSelectedIdx.current = idx;
  };
  const handleBulkDelete = async () => {
    if(selectedPaths.size===0) return; if(!confirm(`Delete ${selectedPaths.size} selected file(s)? This also removes sidecars and cannot be undone.`)) return;
    setIsDeleting(true); try{ await useOutputStore.getState().bulkDelete(Array.from(selectedPaths)); setSelectedPaths(new Set()); setSelectedOutput(null);}catch(e){ alert(e instanceof Error?e.message:"Bulk delete failed");} finally{ setIsDeleting(false); }
  };
  const handleFindDuplicates = async () => {
    if(showDuplicates){ setShowDuplicates(false); return;} setIsFindingDupes(true);
    try{ const groups=await useOutputStore.getState().fetchDuplicates(true); setDuplicateGroups(groups); setShowDuplicates(true);}catch(e){ alert(e instanceof Error?e.message:"Failed");} finally{ setIsFindingDupes(false); }
  };
  const handleDeleteGroupKeepOldest = async (group:{files:Array<{relative_path:string;filename:string}>})=>{
    const toDelete=group.files.slice(1).map(f=>f.relative_path); if(toDelete.length===0) return; if(!confirm(`Keep oldest "${group.files[0].filename}" and delete ${toDelete.length} duplicate(s)?`)) return;
    setIsDeleting(true); try{ await useOutputStore.getState().bulkDelete(toDelete); const groups=await useOutputStore.getState().fetchDuplicates(true); setDuplicateGroups(groups);}catch(e){ alert(e instanceof Error?e.message:"Delete failed");} finally{ setIsDeleting(false); }
  };
  const handleOpenBlender = async (output: OutputFile) => {
    setOpeningApp("blender");
    try {
      const res = await openInBlender(output.relative_path);
      // brief toast via alert — keep local-first simple
      console.log("Blender open:", res);
    } catch (e) { alert(e instanceof Error ? e.message : "Failed to open in Blender"); } finally { setOpeningApp(null); }
  };
  const handleOpenUnity = async (output: OutputFile) => {
    setOpeningApp("unity");
    try {
      const res = await openInUnity(output.relative_path);
      console.log("Unity open:", res);
    } catch (e) { alert(e instanceof Error ? e.message : "Failed to open in Unity"); } finally { setOpeningApp(null); }
  };
  const handleExtractThumbnail = async () => {
    if (!selectedOutput || selectedOutput.file_type !== "video") return;
    setThumbnailLoading(true);
    try {
      const res = await extractThumbnailAtTime({ path: selectedOutput.relative_path, time_sec: 1.0, width: 480 });
      if (res.thumbnail_path) setThumbnailUrl(getOutputUrl(res.thumbnail_path));
      else if (res.error) alert(res.error);
    } catch (e) { alert(e instanceof Error ? e.message : "Thumbnail extraction failed"); } finally { setThumbnailLoading(false); }
  };
  const handleRegenerateCover = async () => {
    if (!selectedOutput || selectedOutput.file_type !== "audio") return;
    setThumbnailLoading(true);
    try {
      const res = await regenerateAudioCover(selectedOutput.relative_path);
      if (res.cover_image) setThumbnailUrl(getOutputUrl(res.cover_image));
      else if (res.error) alert(res.error);
    } catch (e) { alert(e instanceof Error ? e.message : "Cover regeneration failed"); } finally { setThumbnailLoading(false); }
  };
  const handleAnalyzeAudio = async (output: OutputFile) => {
    if (output.file_type !== "audio") return;
    try {
      const filename = output.filename;
      const res = await ensureAnalysis(filename, "sonara");
      if (res.status === "already_analyzed" || res.analysis) {
        alert(`Analysis complete for ${filename}`);
      } else {
        alert(`Analysis started for ${filename} — check the Audio Analysis page for results.`);
      }
      navigate(`/audio-analysis?file=${encodeURIComponent(filename)}`);
    } catch (e) { alert(e instanceof Error ? e.message : "Audio analysis failed"); }
  };
  const handleSendToVisualizer = (output: OutputFile) => {
    if (output.file_type !== "audio") return;
    setPendingTrack(output.filename);
    navigate("/visualizer");
  };
  const handleSendToWizard = (output: OutputFile) => {
    if (output.file_type !== "audio") return;
    setPendingTrack(output.filename);
    navigate("/music-video-wizard");
  };
  const handleAddToStudio = async (output: OutputFile, openInNewTab = false) => {
    if (!is3DModelFile(output.filename)) { alert("Only 3D models (.glb/.gltf/.fbx/.obj) can be added to Studio"); return; }
    setOpeningApp("studio");
    try {
      const servable = output.relative_path.startsWith("generated_3d/") ? `/output/${output.relative_path}` : getOutputUrl(output.relative_path);
      // Queue for Three.js Studio handoff (read on next mount, without leaving page) + live dispatch for same-tab open Studio
      const payload = { modelUrl: servable, name: output.filename.replace(/\.(glb|gltf|fbx|obj)$/i, ""), bible: output.filename };
      try { localStorage.setItem("pendingCharacter", JSON.stringify(payload)); } catch { /* private mode — ignore */ }
      try { window.dispatchEvent(new CustomEvent("pendingCharacter", { detail: JSON.stringify(payload) })); } catch { /* ignore */ }
      try { const { updateMCPContext } = await import("../../services/api"); await updateMCPContext({ character: { name: payload.name, notes: payload.bible, visible: true } } as any); } catch { /* MCP optional — ignore */ }
      setStudioToast(`Queued “${output.filename}” for Studio — ${openInNewTab ? "opening in new tab…" : "stay here, open Studio when ready"}`);
      setTimeout(() => setStudioToast(null), 3000);
      if (openInNewTab) window.open("/three-js-studio", "_blank");
    } catch (e) { alert(e instanceof Error ? e.message : "Failed to queue for Studio"); } finally { setOpeningApp(null); }
  };

  const hasActiveFilters = !!(searchTerm||dateFrom||dateTo);
  const duplicatePaths = useMemo(()=> new Set(duplicateGroups?.flatMap(g=> g.files.map(f=>f.relative_path))||[]),[duplicateGroups]);

  const filteredOutputs = useMemo(()=>{
    const sorted=[...outputs];
    switch(sortBy){
      case "newest": sorted.sort((a,b)=> new Date(b.created_at).getTime()-new Date(a.created_at).getTime()); break;
      case "oldest": sorted.sort((a,b)=> new Date(a.created_at).getTime()-new Date(b.created_at).getTime()); break;
      case "name-asc": sorted.sort((a,b)=> a.filename.localeCompare(b.filename)); break;
      case "name-desc": sorted.sort((a,b)=> b.filename.localeCompare(a.filename)); break;
      case "size-desc": sorted.sort((a,b)=> b.size_bytes-a.size_bytes); break;
      case "size-asc": sorted.sort((a,b)=> a.size_bytes-b.size_bytes); break;
      case "type": { const order={video:0,audio:1,image:2,other:3} as const; sorted.sort((a,b)=>{const ao=(order as any)[a.file_type]??3; const bo=(order as any)[b.file_type]??3; if(ao!==bo) return ao-bo; return new Date(b.created_at).getTime()-new Date(a.created_at).getTime();}); break; }
    }
    if(deferredSearch){
      const q=deferredSearch.toLowerCase();
      return sorted.filter(o=> o.filename.toLowerCase().includes(q) || o.relative_path.toLowerCase().includes(q) || (o.job_id||"").toLowerCase().includes(q));
    }
    return sorted;
  },[outputs,sortBy,deferredSearch]);

  const groupedOutputs = useMemo(()=>{
    if(!groupByType) return null;
    const groups: Record<string, OutputFile[]>={video:[],audio:[],image:[],"3d":[],other:[]};
    for(const o of filteredOutputs){ const k=(["video","audio","image","3d"].includes(o.file_type)?o.file_type:"other") as keyof typeof groups; groups[k].push(o); }
    return groups;
  },[filteredOutputs, groupByType]);

  const visibleOutputs = useMemo(()=> filteredOutputs.slice(0, visibleCount),[filteredOutputs, visibleCount]);
  const canLoadMore = visibleCount < filteredOutputs.length;
  const currentCategory = categoryConfig.find(c=> c.key===filter.type)||categoryConfig[0];

  return (
    <div className="flex h-full">
      <div className={`transition-all duration-300 ${sidebarCollapsed?"w-16":"w-56"} border-r border-white/5 bg-black/20 backdrop-blur-xl flex flex-col shrink-0`}>
        <div className="p-4 border-b border-white/5">
          <button onClick={()=> setSidebarCollapsed(!sidebarCollapsed)} className="flex items-center gap-2 text-sm text-muted hover:text-white transition-colors group">
            <span className="p-1 rounded-lg bg-white/5 group-hover:bg-white/10 transition-colors">{sidebarCollapsed?<ChevronRight size={16}/>:<ChevronLeft size={16}/>}</span>
            {!sidebarCollapsed && <span className="font-medium">Collapse</span>}
          </button>
        </div>
        <nav className="flex-1 p-2 space-y-1 overflow-auto">
          {categoryConfig.map(category=>{
            const Icon=category.icon; const isActive=filter.type===category.key;
            return <button key={category.key} onClick={()=> handleFilterChange(category.key as any)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${isActive?"bg-primary text-white shadow-lg shadow-primary/20 scale-[1.02]":"text-muted hover:text-white hover:bg-white/5 hover:translate-x-0.5"}`}>
              <Icon size={18} className={isActive?"":category.color} />
              {!sidebarCollapsed && <><span className="font-medium text-sm">{category.label}</span><span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${isActive?"bg-white/20":"bg-white/5"}`}>{category.key==="all"?counts.total: category.key==="image"?counts.images: category.key==="video"?counts.videos: category.key==="3d"?(counts as any).models_3d||0:counts.audio}</span></>}
            </button>;
          })}
          {!sidebarCollapsed && <div className="pt-4 mt-4 border-t border-white/5"><p className="text-[11px] text-muted uppercase tracking-widest px-3 mb-2">Tips</p><p className="text-xs text-muted/70 px-3 leading-relaxed">Press <kbd className="px-1 py-0.5 bg-white/10 rounded text-[11px]">/</kbd> to search • <kbd className="px-1 py-0.5 bg-white/10 rounded text-[11px]">g</kbd> to group • hover video for preview</p></div>}
        </nav>
      </div>

      <div className="flex-1 space-y-5 p-6 overflow-auto">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2"><Sparkles size={20} className="text-primary" /> Media Library</h1>
            <p className="text-sm text-muted mt-1">Browse, preview, rename and deduplicate — covers auto-extracted from audio</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={handleFindDuplicates} disabled={isFindingDupes} className={`btn flex items-center gap-2 transition-all ${showDuplicates?"btn-primary shadow-lg shadow-amber-500/20":"btn-secondary hover:shadow-md"}`} title="Find duplicates by hash"><Copy size={16} className={isFindingDupes?"animate-spin":""} />{showDuplicates?"Hide Duplicates":"Find Duplicates"}</button>
            <button onClick={handleRefresh} disabled={isRefreshing} className="btn btn-secondary flex items-center gap-2 hover:shadow-md"><RefreshCw size={16} className={isRefreshing?"animate-spin":""} />Refresh</button>
          </div>
        </div>

        {studioToast && (
          <div className="fixed top-20 right-4 z-[60] bg-violet-600 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 animate-in slide-in-from-top-2 border border-violet-500/30">
            <Sparkles size={16} className="animate-pulse" /> <span className="text-sm font-medium">{studioToast}</span>
            <button onClick={() => setStudioToast(null)} className="ml-2 p-1 hover:bg-white/20 rounded-lg"><X size={14} /></button>
          </div>
        )}

        {selectedPaths.size>0 && (
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-violet-500/10 border border-violet-500/20 backdrop-blur animate-in slide-in-from-top-2 duration-300">
            <span className="text-sm text-white font-medium flex items-center gap-2"><CheckSquare size={16} className="text-violet-400" />{selectedPaths.size} selected</span>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={()=> setSelectedPaths(new Set())} className="btn btn-ghost btn-sm hover:bg-white/10">Clear</button>
              <button onClick={handleBulkDelete} disabled={isDeleting} className="btn btn-danger btn-sm flex items-center gap-2 shadow-lg shadow-red-500/20"><Trash2 size={14} />Delete Selected</button>
            </div>
          </div>
        )}

        {showDuplicates && duplicateGroups && (
          <div className="card p-4 border-amber-500/20 bg-amber-500/[0.03] backdrop-blur animate-in slide-in-from-top-2">
            <div className="flex items-center gap-2 mb-3">
              <Users size={16} className="text-amber-400" /><h3 className="text-sm font-bold text-white">Duplicate groups — {duplicateGroups.length} found</h3>
              <span className="text-xs text-muted ml-2 hidden sm:inline">Exact hash • keeps oldest</span>
              <button onClick={()=> setShowDuplicates(false)} className="ml-auto btn btn-ghost btn-sm">Hide</button>
            </div>
            {duplicateGroups.length===0? <p className="text-sm text-muted py-2">No duplicates — library is clean ✨</p> : (
              <div className="space-y-3 max-h-[45vh] overflow-auto pr-1">
                {duplicateGroups.map(g=>(
                  <div key={g.hash} className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs"><span className="font-mono text-amber-300">#{g.hash.slice(0,12)}</span><span className="text-muted ml-2">{g.count} files • {(g.wasted_bytes/(1024*1024)).toFixed(1)} MB wasted</span></div>
                      <button onClick={()=> handleDeleteGroupKeepOldest(g)} disabled={isDeleting} className="btn btn-danger btn-sm shrink-0">Keep oldest, delete {g.count-1}</button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                      {g.files.map((f,idx)=>(
                        <div key={f.relative_path} className={`flex items-center gap-2 p-2 rounded-lg border text-xs ${idx===0?"border-emerald-500/30 bg-emerald-500/10":"border-white/5 bg-white/5"}`}>
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${idx===0?"bg-emerald-500 text-white":"bg-white/10 text-muted"}`}>{idx===0?"✓":idx+1}</span>
                          <div className="min-w-0 flex-1"><p className="truncate text-white font-medium" title={f.filename}>{f.filename}</p><p className="text-muted">{(f.size_bytes/(1024*1024)).toFixed(2)} MB • {new Date(f.created_at).toLocaleDateString()}</p></div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard icon={HardDrive} iconWrapperClass="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center backdrop-blur" iconClass="w-5 h-5 text-primary" value={counts.total} label="Total Files" />
          <StatCard icon={Image} iconWrapperClass="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center backdrop-blur" iconClass="w-5 h-5 text-purple-400" value={counts.images} label="Images" />
          <StatCard icon={Video} iconWrapperClass="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center backdrop-blur" iconClass="w-5 h-5 text-blue-400" value={counts.videos} label="Videos" />
          <StatCard icon={Music} iconWrapperClass="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center backdrop-blur" iconClass="w-5 h-5 text-green-400" value={counts.audio} label="Audio" />
          <StatCard icon={Box} iconWrapperClass="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center backdrop-blur" iconClass="w-5 h-5 text-amber-400" value={counts.models_3d ?? 0} label="3D Models" />
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center justify-between">
            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
              <div className="relative flex-1 min-w-[220px] lg:flex-none">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                <input ref={searchInputRef} type="text" placeholder="Search files, job IDs...  (/ to focus)" value={searchTerm} onChange={e=> setSearchTerm(e.target.value)} onKeyDown={e=> e.key==="Enter" && handleSearch()} className="input pl-10 w-full lg:w-72 bg-black/20 backdrop-blur border-white/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all" />
                {searchTerm && <button onClick={()=> setSearchTerm("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded"><X size={14} /></button>}
              </div>
              <button onClick={()=> setShowFilters(!showFilters)} className={`btn flex items-center gap-2 ${showFilters||hasActiveFilters?"btn-primary shadow-lg":"btn-secondary"}`}><SlidersHorizontal size={16} />Filters {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-white animate-pulse" />}</button>
              <div className="flex items-center bg-black/20 backdrop-blur rounded-xl p-1 border border-white/10">
                <button onClick={()=> setViewMode("grid")} className={`p-2 rounded-lg transition-all ${viewMode==="grid"?"bg-primary text-white shadow":"text-muted hover:text-white hover:bg-white/10"}`} aria-label="Grid view"><Grid size={16} /></button>
                <button onClick={()=> setViewMode("list")} className={`p-2 rounded-lg transition-all ${viewMode==="list"?"bg-primary text-white shadow":"text-muted hover:text-white hover:bg-white/10"}`} aria-label="List view"><List size={16} /></button>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="relative">
                <select value={sortBy} onChange={e=> setSortBy(e.target.value as any)} className="input pl-3 pr-8 py-2 text-sm appearance-none min-w-[140px] bg-black/20 backdrop-blur border-white/10" title="Sort">
                  <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name-asc">Name A→Z</option><option value="name-desc">Name Z→A</option><option value="size-desc">Largest</option><option value="size-asc">Smallest</option><option value="type">By Type</option>
                </select>
                <ArrowUpDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              </div>
              <button onClick={()=> setGroupByType(!groupByType)} className={`btn btn-sm flex items-center gap-1.5 whitespace-nowrap ${groupByType?"btn-primary shadow":"btn-secondary"}`} title="Group"><Layers size={14} />{groupByType?"Grouped":"Group"}</button>
            </div>
          </div>

          {showFilters && (
            <div className="card p-4 bg-black/20 backdrop-blur border-white/10 animate-in slide-in-from-top-1">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-muted" /><span className="text-sm text-muted">From:</span><input type="date" value={dateFrom} onChange={e=> setDateFrom(e.target.value)} className="input py-1.5 text-sm w-40 bg-black/20 border-white/10" /></div>
                <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-muted" /><span className="text-sm text-muted">To:</span><input type="date" value={dateTo} onChange={e=> setDateTo(e.target.value)} className="input py-1.5 text-sm w-40 bg-black/20 border-white/10" /></div>
                <button onClick={handleSearch} className="btn btn-primary shadow">Apply</button>
                {hasActiveFilters && <button onClick={handleClearFilters} className="btn btn-secondary">Clear</button>}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-500/20 border border-blue-500/50" /><Video size={12} className="text-blue-400" /> Video</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500/20 border border-emerald-500/50" /><Music size={12} className="text-emerald-400" /> Audio</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-purple-500/20 border border-purple-500/50" /><Image size={12} className="text-purple-400" /> Image</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-500/20 border border-amber-500/50" /><Box size={12} className="text-amber-400" /> 3D</span>
          <span className="text-muted ml-auto hidden sm:inline">Sorted by <b className="text-white capitalize">{sortBy.replace("-"," ")}</b> • {filteredOutputs.length} files{groupByType?" • grouped":""} {visibleCount<filteredOutputs.length && `• showing ${visibleCount}`}</span>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center gap-3 text-red-300 backdrop-blur">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div className="flex-1"><span className="font-medium">Backend Unavailable</span><p className="text-sm text-red-300/80 mt-1">{error.includes("fetch")||error.includes("refused")?"Cannot connect to backend at 127.0.0.1:8000. Start with: cd packages/backend && python -m uvicorn app.main:app --reload":error}</p></div>
            <button onClick={handleRefresh} className="btn btn-sm btn-secondary">Retry</button>
          </div>
        )}

        {isLoading ? <SkeletonGrid /> : (
          <>
            {!groupByType && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {visibleOutputs.map((output, i)=> (
                  <MediaCard key={output.path} output={output} index={i} selected={selectedPaths.has(output.relative_path)} isDup={duplicatePaths.has(output.relative_path)} onSelect={()=> setSelectedOutput(output)} onToggle={(e)=>{e.stopPropagation(); toggleSelectRange(e, i, output.relative_path, visibleOutputs);}} onDelete={(e)=>{e.stopPropagation(); setOutputToDelete(output);}} onRename={(e)=>{e.stopPropagation(); setRenameTarget(output); setRenameValue(output.filename);}} onOpenBlender={(e)=>{e.stopPropagation(); handleOpenBlender(output);}} onOpenUnity={(e)=>{e.stopPropagation(); handleOpenUnity(output);}} onAddToStudio={(e)=>{e.stopPropagation(); handleAddToStudio(output, false);}} onAnalyze={(e)=>{e.stopPropagation(); handleAnalyzeAudio(output);}} onSendToVisualizer={(output)=> handleSendToVisualizer(output)} onSendToWizard={(output)=> handleSendToWizard(output)} />
                ))}
              </div>
            )}
            {groupByType && groupedOutputs && (
              <div className="space-y-6">
                {(["video","audio","image","3d"] as const).map(type=>{
                  const items=groupedOutputs[type]||[]; if(items.length===0) return null;
                  const label=type==="video"?"Videos":type==="audio"?"Audio":type==="3d"?"3D Models":"Images";
                  const Icon=type==="video"?Video:type==="audio"?Music:type==="3d"?Box:Image;
                  const color=type==="video"?"text-blue-400":type==="audio"?"text-emerald-400":type==="3d"?"text-amber-400":"text-purple-400";
                  const visible=items.slice(0, visibleCount);
                  return (
                    <div key={type}>
                      <h3 className="flex items-center gap-2 text-sm font-bold text-white mb-3"><Icon size={16} className={color} />{label} <span className="text-xs font-normal text-muted">({items.length})</span><span className="flex-1 h-px bg-white/5 ml-2" /></h3>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        {visible.map((output,i)=> <MediaCard key={output.path} output={output} index={i} selected={selectedPaths.has(output.relative_path)} isDup={duplicatePaths.has(output.relative_path)} onSelect={()=> setSelectedOutput(output)} onToggle={(e)=>{e.stopPropagation(); toggleSelectRange(e, i, output.relative_path, visible);}} onDelete={(e)=>{e.stopPropagation(); setOutputToDelete(output);}} onRename={(e)=>{e.stopPropagation(); setRenameTarget(output); setRenameValue(output.filename);}} onOpenBlender={(e)=>{e.stopPropagation(); handleOpenBlender(output);}} onOpenUnity={(e)=>{e.stopPropagation(); handleOpenUnity(output);}} onAddToStudio={(e)=>{e.stopPropagation(); handleAddToStudio(output, false);}} onAnalyze={(e)=>{e.stopPropagation(); handleAnalyzeAudio(output);}} onSendToVisualizer={(output)=> handleSendToVisualizer(output)} onSendToWizard={(output)=> handleSendToWizard(output)} />)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {canLoadMore && (
              <div className="flex justify-center pt-4">
                <button onClick={()=> setVisibleCount(v=> v+ITEMS_PER_PAGE)} className="btn btn-secondary flex items-center gap-2 hover:shadow-lg hover:-translate-y-0.5 transition-all">
                  Load more <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full">{filteredOutputs.length - visibleCount} remaining</span>
                </button>
              </div>
            )}
          </>
        )}

        {!isLoading && !error && filteredOutputs.length===0 && (
          <div className="card p-12 text-center bg-black/20 backdrop-blur border-white/10">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500/20 to-primary/20 flex items-center justify-center mx-auto mb-4 backdrop-blur border border-white/5">
              {currentCategory.icon && <currentCategory.icon className="w-10 h-10 text-muted" />}
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No files found</h3>
            <p className="text-muted max-w-md mx-auto">{hasActiveFilters?"No files match your search or filter criteria — try adjusting your filters or search term.":"Generate some images, videos, or audio to see them here. Your creations will appear automatically."}</p>
            {hasActiveFilters ? <button onClick={handleClearFilters} className="btn btn-secondary mt-4">Clear Filters</button> : <p className="text-xs text-muted/60 mt-3">Tip: Press <kbd className="px-1.5 py-0.5 bg-white/10 rounded">/</kbd> to search</p>}
          </div>
        )}

        {selectedOutput && (
          <MediaDetailModal
            output={selectedOutput}
            onClose={() => setSelectedOutput(null)}
            audioRef={audioRef}
            mediaInfo={mediaInfo}
            mediaInfoLoading={mediaInfoLoading}
            mediaInfoError={mediaInfoError}
            thumbnailUrl={thumbnailUrl}
            thumbnailLoading={thumbnailLoading}
            onExtractThumbnail={handleExtractThumbnail}
            onRegenerateCover={handleRegenerateCover}
            onAddToStudio={handleAddToStudio}
            onOpenBlender={handleOpenBlender}
            onOpenUnity={handleOpenUnity}
            onShowFullImage={() => setShowFullImage(true)}
            is3DModelFile={is3DModelFile}
            getOutputUrl={getOutputUrl}
            formatFileSize={formatFileSize}
            formatDateTime={formatDateTime}
            onFetchOutputs={fetchOutputs}
            openingApp={openingApp}
            setOutputToDelete={setOutputToDelete}
            setRenameTarget={setRenameTarget}
            setRenameValue={setRenameValue}
          />
        )}

        {showFullImage && selectedOutput && selectedOutput.file_type==="image" && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur z-[60] flex items-center justify-center p-4 animate-in fade-in" onClick={()=> { setShowFullImage(false); setLightboxZoom(1); }}>
            <button onClick={()=> setShowFullImage(false)} className="absolute top-4 right-4 p-2 bg-white/10 backdrop-blur rounded-xl text-white hover:bg-white/20"><X size={20} /></button>
            <div className="absolute top-4 left-4 flex items-center gap-2">
              <button onClick={e=>{ e.stopPropagation(); setLightboxZoom(z=> Math.min(3, z+0.25));}} className="p-2 bg-white/10 backdrop-blur rounded-xl text-white hover:bg-white/20"><span className="px-1 font-mono text-sm">+</span></button>
              <button onClick={e=>{ e.stopPropagation(); setLightboxZoom(z=> Math.max(0.5, z-0.25));}} className="p-2 bg-white/10 backdrop-blur rounded-xl text-white hover:bg-white/20"><span className="px-1 font-mono text-sm">−</span></button>
              <span className="text-xs text-white/70 bg-black/50 px-2 py-1 rounded-full backdrop-blur">{Math.round(lightboxZoom*100)}%</span>
            </div>
            <img src={getOutputUrl(selectedOutput.relative_path)} alt={selectedOutput.filename} style={{ transform: `scale(${lightboxZoom})` }} className="max-w-[90vw] max-h-[90vh] object-contain transition-transform duration-200 cursor-zoom-out" onClick={()=> setShowFullImage(false)} />
          </div>
        )}

        {outputToDelete && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
            <div className="card max-w-md w-full p-6 animate-in zoom-in-95">
              <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-red-400" /></div><h3 className="text-lg font-semibold text-white">Delete file?</h3></div>
              <p className="text-sm text-muted mb-1">This will permanently delete:</p><p className="text-sm text-white font-mono bg-white/5 p-2 rounded-lg border border-white/10 truncate">{outputToDelete.filename}</p><p className="text-xs text-muted mt-2">Also removes sidecars (.jpg cover, .json) if inside output/. This cannot be undone.</p>
              <div className="flex gap-3 mt-6"><button onClick={()=> setOutputToDelete(null)} className="btn btn-secondary flex-1" disabled={isDeleting}>Cancel</button><button onClick={()=> handleDelete(outputToDelete)} disabled={isDeleting} className="btn btn-danger flex-1 flex items-center justify-center gap-2">{isDeleting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 size={16} />}Delete</button></div>
            </div>
          </div>
        )}

        {renameTarget && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
            <div className="card max-w-md w-full p-6 animate-in zoom-in-95">
              <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2"><Pencil size={16} className="text-primary" />Rename file</h3>
              <p className="text-xs text-muted mb-3 font-mono truncate" title={renameTarget.relative_path}>{renameTarget.relative_path}</p>
              <input value={renameValue} onChange={e=> setRenameValue(e.target.value)} onKeyDown={e=> e.key==="Enter" && handleRename()} placeholder="New filename" className="input w-full bg-black/20 border-white/10 focus:border-primary/50" autoFocus />
              <p className="text-xs text-muted mt-2">Keep extension • no slashes • max 200 chars</p>
              <div className="flex gap-3 mt-6"><button onClick={()=> setRenameTarget(null)} className="btn btn-secondary flex-1" disabled={isRenaming}>Cancel</button><button onClick={handleRename} disabled={isRenaming || !renameValue.trim() || renameValue===renameTarget.filename} className="btn btn-primary flex-1 flex items-center justify-center gap-2">{isRenaming ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check size={16} />}Rename</button></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
