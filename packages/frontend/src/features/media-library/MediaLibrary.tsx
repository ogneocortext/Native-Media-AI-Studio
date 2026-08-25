import { useState, useEffect, useMemo } from "react";
import { useOutputStore, OutputFile } from "../../state/outputStore";
import { formatFileSize, formatDate, formatDateTime } from "../../utils/format";
import { getOutputUrl } from "../../utils/url";
import { StatCard } from "./MediaLibraryStats";
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
  Tag,
  Trash2,
  AlertTriangle,
  Maximize2,
  Pencil,
  Copy,
  CheckSquare,
  Square,
  Users,
  Check,
  ArrowUpDown,
  Layers,
} from "lucide-react";

const categoryConfig = [
  { key: "all", label: "All Files", icon: HardDrive, color: "text-primary" },
  { key: "image", label: "Images", icon: Image, color: "text-purple-400" },
  { key: "video", label: "Videos", icon: Video, color: "text-blue-400" },
  { key: "audio", label: "Audio", icon: Music, color: "text-green-400" },
] as const;

export function MediaLibrary() {
  const {
    outputs,
    isLoading,
    error,
    filter,
    counts,
    fetchOutputs,
    fetchRecent,
    setFilter,
    fetchByType,
    deleteOutput,
  } = useOutputStore();

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedOutput, setSelectedOutput] = useState<OutputFile | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [outputToDelete, setOutputToDelete] = useState<OutputFile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showFullImage, setShowFullImage] = useState(false);
  // File management: selection, rename, duplicates
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [renameTarget, setRenameTarget] = useState<OutputFile | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<Array<{ hash: string; count: number; size_bytes: number; wasted_bytes: number; files: Array<{ filename: string; relative_path: string; size_bytes: number; created_at: string }> }> | null>(null);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [isFindingDupes, setIsFindingDupes] = useState(false);
  // Sorting & grouping for easier video/audio differentiation
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "name-asc" | "name-desc" | "size-desc" | "size-asc" | "type">("newest");
  const [groupByType, setGroupByType] = useState(false);

  useEffect(() => {
    fetchOutputs();
    fetchRecent(12);
  }, [fetchOutputs, fetchRecent, filter.type]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchOutputs();
    await fetchRecent(12);
    setIsRefreshing(false);
  };

  const handleFilterChange = (type: "all" | "image" | "video" | "audio") => {
    setFilter({ type });
    if (type !== "all") {
      fetchByType(type === "image" ? "images" : type === "video" ? "video" : "audio");
    } else {
      fetchOutputs();
    }
  };

  const handleSearch = () => {
    setFilter({ search: searchTerm, dateFrom, dateTo });
  };

  const handleClearFilters = () => {
    setSearchTerm("");
    setDateFrom("");
    setDateTo("");
    setFilter({ search: "", dateFrom: "", dateTo: "" });
  };

  const handleDelete = async (output: OutputFile) => {
    setIsDeleting(true);
    try {
      await deleteOutput(output.relative_path);
      setOutputToDelete(null);
      setSelectedOutput(null);
      setSelectedPaths(prev => { const n = new Set(prev); n.delete(output.relative_path); return n; });
      await fetchOutputs();
    } catch (error) {
      console.error("Failed to delete:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim() || renameValue === renameTarget.filename) { setRenameTarget(null); return; }
    setIsRenaming(true);
    try {
      // Use store's renameOutput via direct fetch to avoid stale closure
      const { useOutputStore } = await import("../../state/outputStore");
      await useOutputStore.getState().renameOutput(renameTarget.relative_path, renameValue.trim());
      setRenameTarget(null);
      setRenameValue("");
      setSelectedOutput(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Rename failed");
    } finally { setIsRenaming(false); }
  };

  const toggleSelect = (path: string) => {
    setSelectedPaths(prev => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path); else n.add(path);
      return n;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedPaths.size === 0) return;
    if (!confirm(`Delete ${selectedPaths.size} selected file(s)? This also removes sidecars (.jpg cover, .json) and cannot be undone.`)) return;
    setIsDeleting(true);
    try {
      const { useOutputStore } = await import("../../state/outputStore");
      await useOutputStore.getState().bulkDelete(Array.from(selectedPaths));
      setSelectedPaths(new Set());
      setSelectedOutput(null);
    } catch (e) { alert(e instanceof Error ? e.message : "Bulk delete failed"); }
    finally { setIsDeleting(false); }
  };

  const handleFindDuplicates = async () => {
    if (showDuplicates) { setShowDuplicates(false); return; }
    setIsFindingDupes(true);
    try {
      const { useOutputStore } = await import("../../state/outputStore");
      const groups = await useOutputStore.getState().fetchDuplicates(true);
      setDuplicateGroups(groups);
      setShowDuplicates(true);
    } catch (e) { alert(e instanceof Error ? e.message : "Failed to find duplicates"); }
    finally { setIsFindingDupes(false); }
  };

  const handleDeleteGroupKeepOldest = async (group: { files: Array<{ filename: string; relative_path: string; size_bytes: number; created_at: string }> }) => {
    // Keep oldest (first), delete rest
    const toDelete = group.files.slice(1).map(f => f.relative_path);
    if (toDelete.length === 0) return;
    if (!confirm(`Keep oldest "${group.files[0].filename}" and delete ${toDelete.length} duplicate(s)?`)) return;
    setIsDeleting(true);
    try {
      const { useOutputStore } = await import("../../state/outputStore");
      await useOutputStore.getState().bulkDelete(toDelete);
      // Refresh duplicates
      const groups = await useOutputStore.getState().fetchDuplicates(true);
      setDuplicateGroups(groups);
    } catch (e) { alert(e instanceof Error ? e.message : "Delete failed"); }
    finally { setIsDeleting(false); }
  };

  const hasActiveFilters = searchTerm || dateFrom || dateTo;

  const duplicatePaths = useMemo(() => new Set(duplicateGroups?.flatMap(g => g.files.map(f => f.relative_path)) || []), [duplicateGroups]);

  const filteredOutputs = useMemo(() => {
    const sorted = [...outputs];
    switch (sortBy) {
      case "newest":
        sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
      case "oldest":
        sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
      case "name-asc":
        sorted.sort((a, b) => a.filename.localeCompare(b.filename));
        break;
      case "name-desc":
        sorted.sort((a, b) => b.filename.localeCompare(a.filename));
        break;
      case "size-desc":
        sorted.sort((a, b) => b.size_bytes - a.size_bytes);
        break;
      case "size-asc":
        sorted.sort((a, b) => a.size_bytes - b.size_bytes);
        break;
      case "type":
        // Group by type: video first, audio second, image third, then by newest
        const order = { video: 0, audio: 1, image: 2, other: 3 } as const;
        sorted.sort((a, b) => {
          const ao = order[a.file_type as keyof typeof order] ?? 3;
          const bo = order[b.file_type as keyof typeof order] ?? 3;
          if (ao !== bo) return ao - bo;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
        break;
    }
    return sorted;
  }, [outputs, sortBy]);

  const groupedOutputs = useMemo(() => {
    if (!groupByType) return null;
    const groups: Record<string, OutputFile[]> = { video: [], audio: [], image: [], other: [] };
    for (const o of filteredOutputs) {
      const k = (["video", "audio", "image"].includes(o.file_type) ? o.file_type : "other") as keyof typeof groups;
      groups[k].push(o);
    }
    return groups;
  }, [filteredOutputs, groupByType]);

  const typeAccent: Record<string, string> = {
    video: "border-l-4 border-l-blue-500/60 bg-blue-500/[0.04] hover:bg-blue-500/[0.08]",
    audio: "border-l-4 border-l-emerald-500/60 bg-emerald-500/[0.04] hover:bg-emerald-500/[0.08]",
    image: "border-l-4 border-l-purple-500/60 bg-purple-500/[0.04] hover:bg-purple-500/[0.08]",
    other: "",
  };

  const renderFileIcon = (fileType: string, className = "w-6 h-6") => {
    switch (fileType) {
      case "image":
        return <Image className={className} />;
      case "video":
        return <Video className={className} />;
      case "audio":
        return <Music className={className} />;
      default:
        return <FileType className={className} />;
    }
  };

  const renderTypeBadge = (fileType: string) => {
    const colors = {
      image: "bg-purple-500/20 text-purple-400 border-purple-500/30",
      video: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      audio: "bg-green-500/20 text-green-400 border-green-500/30",
      other: "bg-gray-500/20 text-gray-400 border-gray-500/30",
    };

    return (
      <span
        className={`px-2 py-0.5 rounded text-xs font-medium border ${
          colors[fileType as keyof typeof colors] || colors.other
        }`}
      >
        {fileType.charAt(0).toUpperCase() + fileType.slice(1)}
      </span>
    );
  };

  const currentCategory = categoryConfig.find((c) => c.key === filter.type) || categoryConfig[0];

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div
        className={` transition-all duration-300 ${
          sidebarCollapsed ? "w-16" : "w-56"
        } border-r border-border bg-surface flex flex-col`}
      >
        <div className="p-4 border-b border-border">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="flex items-center gap-2 text-sm text-muted hover:text-white transition-colors"
          >
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            {!sidebarCollapsed && <span>Collapse</span>}
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {categoryConfig.map((category) => {
            const Icon = category.icon;
            const isActive = filter.type === category.key;
            return (
              <button
                key={category.key}
                onClick={() => handleFilterChange(category.key as "all" | "image" | "video" | "audio")}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  isActive
                    ? "bg-primary text-white"
                    : "text-muted hover:text-white hover:bg-surface-hover"
                }`}
              >
                <Icon size={20} className={isActive ? "" : category.color} />
                {!sidebarCollapsed && (
                  <>
                    <span className="font-medium">{category.label}</span>
                    <span
                      className={`ml-auto text-xs px-2 py-0.5 rounded ${
                        isActive ? "bg-white/20" : "bg-surface"
                      }`}
                    >
                      {category.key === "all"
                        ? counts.total
                        : category.key === "image"
                        ? counts.images
                        : category.key === "video"
                        ? counts.videos
                        : counts.audio}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 space-y-4 p-6 overflow-auto">
        {/* Header — now with file management actions */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Media Library</h1>
            <p className="text-muted mt-1">
              Browse, play, rename, and deduplicate — covers extracted from audio
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleFindDuplicates}
              disabled={isFindingDupes}
              className={`btn flex items-center gap-2 ${showDuplicates ? "btn-primary" : "btn-secondary"}`}
              title="Find exact duplicates by content hash"
            >
              <Copy size={16} className={isFindingDupes ? "animate-spin" : ""} />
              {showDuplicates ? "Hide Duplicates" : "Find Duplicates"}
            </button>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="btn btn-secondary flex items-center gap-2"
            >
              <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>
        {/* Bulk bar — shows when any selected */}
        {selectedPaths.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-violet-500/10 border border-violet-500/20">
            <span className="text-sm text-white font-medium flex items-center gap-2">
              <CheckSquare size={16} className="text-violet-400" /> {selectedPaths.size} selected
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setSelectedPaths(new Set())} className="btn btn-ghost btn-sm">Clear</button>
              <button onClick={handleBulkDelete} disabled={isDeleting} className="btn btn-danger btn-sm flex items-center gap-2">
                <Trash2 size={14} /> Delete Selected
              </button>
            </div>
          </div>
        )}
        {/* Duplicate groups panel */}
        {showDuplicates && duplicateGroups && (
          <div className="card p-4 border-amber-500/20 bg-amber-500/5">
            <div className="flex items-center gap-2 mb-3">
              <Users size={16} className="text-amber-400" />
              <h3 className="text-sm font-bold text-white">Duplicate groups — {duplicateGroups.length} found</h3>
              <span className="text-xs text-muted ml-2">Exact hash (size + 1MB) • keeps oldest, deletes rest</span>
              <button onClick={() => setShowDuplicates(false)} className="ml-auto btn btn-ghost btn-sm">Hide</button>
            </div>
            {duplicateGroups.length === 0 ? (
              <p className="text-sm text-muted">No duplicates found — your library is clean.</p>
            ) : (
              <div className="space-y-3 max-h-[40vh] overflow-auto pr-1">
                {duplicateGroups.map((g) => (
                  <div key={g.hash} className="rounded-xl border border-white/10 bg-surface p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs">
                        <span className="font-mono text-amber-300">#{g.hash}</span>
                        <span className="text-muted ml-2">{g.count} files • {(g.wasted_bytes / (1024 * 1024)).toFixed(1)} MB wasted</span>
                      </div>
                      <button onClick={() => handleDeleteGroupKeepOldest(g)} disabled={isDeleting} className="btn btn-danger btn-sm shrink-0">
                        Keep oldest, delete {g.count - 1}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                      {g.files.map((f, idx) => (
                        <div key={f.relative_path} className={`flex items-center gap-2 p-2 rounded-lg border text-xs ${idx === 0 ? "border-emerald-500/30 bg-emerald-500/10" : "border-white/5 bg-surface"}`}>
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${idx === 0 ? "bg-emerald-500 text-white" : "bg-white/10 text-muted"}`}>{idx === 0 ? "✓" : idx + 1}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-white font-medium" title={f.filename}>{f.filename}</p>
                            <p className="text-muted">{(f.size_bytes / (1024 * 1024)).toFixed(2)} MB • {new Date(f.created_at).toLocaleDateString()}</p>
                          </div>
                          <button
                            onClick={() => { setRenameTarget({ filename: f.filename, relative_path: f.relative_path, path: f.relative_path } as unknown as OutputFile); setRenameValue(f.filename); }}
                            className="p-1.5 rounded-lg hover:bg-white/10 text-muted hover:text-white"
                            title="Rename"
                          >
                            <Pencil size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={HardDrive} iconWrapperClass="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center" iconClass="w-5 h-5 text-primary" value={counts.total} label="Total Files" />

          <StatCard icon={Image} iconWrapperClass="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center" iconClass="w-5 h-5 text-purple-400" value={counts.images} label="Images" />

          <StatCard icon={Video} iconWrapperClass="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center" iconClass="w-5 h-5 text-blue-400" value={counts.videos} label="Videos" />

          <StatCard icon={Music} iconWrapperClass="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center" iconClass="w-5 h-5 text-green-400" value={counts.audio} label="Audio" />
        </div>

        {/* Search and Filters Row */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-none">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                <input
                  type="text"
                  placeholder="Search files, job IDs, metadata..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="input pl-10 w-full sm:w-72"
                />
              </div>

              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`btn flex items-center gap-2 ${
                  showFilters || hasActiveFilters
                    ? "btn-primary"
                    : "btn-secondary"
                }`}
              >
                <SlidersHorizontal size={16} />
                Filters
                {hasActiveFilters && (
                  <span className="w-2 h-2 rounded-full bg-white" />
                )}
              </button>

              <div className="flex items-center bg-surface rounded-lg p-1">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`p-2 rounded ${
                    viewMode === "grid"
                      ? "bg-primary text-white"
                      : "text-muted hover:text-white"
                  }`}
                >
                  <Grid size={18} />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`p-2 rounded ${
                    viewMode === "list"
                      ? "bg-primary text-white"
                      : "text-muted hover:text-white"
                  }`}
                >
                  <List size={18} />
                </button>
              </div>
              {/* Sorting — new: easier to differentiate videos vs audio */}
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    className="input pl-3 pr-8 py-2 text-sm appearance-none min-w-[130px]"
                    title="Sort"
                  >
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="name-asc">Name A→Z</option>
                    <option value="name-desc">Name Z→A</option>
                    <option value="size-desc">Largest</option>
                    <option value="size-asc">Smallest</option>
                    <option value="type">By Type</option>
                  </select>
                  <ArrowUpDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                </div>
                <button
                  onClick={() => setGroupByType(!groupByType)}
                  className={`btn btn-sm flex items-center gap-1.5 whitespace-nowrap ${groupByType ? "btn-primary" : "btn-secondary"}`}
                  title="Group videos and audio into separate sections"
                >
                  <Layers size={14} />
                  {groupByType ? "Grouped" : "Group"}
                </button>
              </div>
            </div>
          </div>

          {/* Advanced Filters Panel */}
          {showFilters && (
            <div className="card p-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted" />
                  <span className="text-sm text-muted">From:</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="input py-1.5 text-sm w-40"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted" />
                  <span className="text-sm text-muted">To:</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="input py-1.5 text-sm w-40"
                  />
                </div>

                <button onClick={handleSearch} className="btn btn-primary">
                  Apply
                </button>

                {hasActiveFilters && (
                  <button
                    onClick={handleClearFilters}
                    className="btn btn-secondary"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Type legend + count — immediate video vs audio scan */}
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-500/20 border border-blue-500/50" /> <Video size={12} className="text-blue-400" /> Video</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500/20 border border-emerald-500/50" /> <Music size={12} className="text-emerald-400" /> Audio</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-purple-500/20 border border-purple-500/50" /> <Image size={12} className="text-purple-400" /> Image</span>
          <span className="text-muted ml-auto">Sorted by <b className="text-white capitalize">{sortBy.replace("-", " ")}</b> • {filteredOutputs.length} files{groupByType ? " • grouped" : ""}</span>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-error/10 border border-error/30 rounded-lg p-4 flex items-center gap-3 text-error">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div className="flex-1">
              <span className="font-medium">Backend Unavailable</span>
              <p className="text-sm text-error/80 mt-1">
                {error.includes("fetch") || error.includes("refused")
                  ? "Cannot connect to backend at localhost:8000. Start the backend with: cd packages/backend && python -m uvicorn app.main:app --reload"
                  : error}
              </p>
            </div>
            <button onClick={handleRefresh} className="btn btn-sm btn-secondary">
              Retry
            </button>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {/* Grid View — grouped by type when enabled, otherwise sorted flat */}
        {!isLoading && viewMode === "grid" && !groupByType && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredOutputs.map((output) => (
              <div
                key={output.path}
                onClick={() => setSelectedOutput(output)}
                className={`card overflow-hidden cursor-pointer group hover:ring-2 hover:ring-primary/50 transition-all ${typeAccent[output.file_type] || ""}`}
              >
                {/* Preview — now shows embedded cover for audio */}
                <div className="aspect-square bg-surface flex items-center justify-center relative overflow-hidden">
                  {/* Selection — bulk delete */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleSelect(output.relative_path); }}
                    className={`absolute top-2 right-2 z-10 w-7 h-7 rounded-lg flex items-center justify-center border backdrop-blur transition-all ${selectedPaths.has(output.relative_path) ? "bg-violet-600 border-violet-500 text-white" : "bg-black/40 border-white/20 text-white/70 hover:bg-black/60"}`}
                    title={selectedPaths.has(output.relative_path) ? "Deselect" : "Select for bulk delete"}
                  >
                    {selectedPaths.has(output.relative_path) ? <CheckSquare size={14} /> : <Square size={14} />}
                  </button>
                  {duplicatePaths.has(output.relative_path) && (
                    <div className="absolute top-2 right-10 z-10 w-6 h-6 rounded-full bg-amber-500 border border-amber-600 flex items-center justify-center" title="Duplicate — Find Duplicates to clean">
                      <Copy size={10} className="text-white" />
                    </div>
                  )}
                  {output.file_type === "image" ? (
                    <img
                      src={getOutputUrl(output.relative_path)}
                      alt={output.filename}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : output.file_type === "video" && output.cover_image ? (
                    <img
                      src={getOutputUrl(output.cover_image)}
                      alt={output.filename}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : output.file_type === "video" && output.metadata?.corrupted ? (
                    <div className="flex flex-col items-center gap-2 text-red-400">
                      <AlertTriangle className="w-10 h-10" />
                      <span className="text-xs uppercase">Corrupted</span>
                    </div>
                  ) : output.file_type === "video" ? (
                    <div className="flex flex-col items-center gap-2 text-muted">
                      <Video className="w-12 h-12" />
                      <span className="text-xs uppercase">Video</span>
                    </div>
                  ) : output.file_type === "audio" && output.cover_image ? (
                    <img
                      src={getOutputUrl(output.cover_image)}
                      alt={output.filename}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : output.file_type === "audio" ? (
                    <div className="flex flex-col items-center gap-2 text-muted">
                      <Music className="w-12 h-12" />
                      <span className="text-xs uppercase">Audio</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted">
                      {renderFileIcon(output.file_type, "w-12 h-12")}
                      <span className="text-xs uppercase">{output.file_type}</span>
                    </div>
                  )}
                  {output.file_type === "audio" && output.cover_image && (
                    <div className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-black/60 backdrop-blur flex items-center justify-center border border-white/10">
                      <Music size={12} className="text-white" />
                    </div>
                  )}

                  {/* Hover Overlay — play/download/rename/delete */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                    <a
                      href={getOutputUrl(output.relative_path)}
                      download
                      onClick={(e) => e.stopPropagation()}
                      className="p-2 bg-white/10 rounded-lg hover:bg-white/20 text-white"
                      title="Download"
                    >
                      <Download size={16} />
                    </a>
                    <button
                      onClick={(e) => { e.stopPropagation(); setRenameTarget(output); setRenameValue(output.filename); }}
                      className="p-2 bg-white/10 rounded-lg hover:bg-white/20 text-white"
                      title="Rename"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOutputToDelete(output);
                      }}
                      className="p-2 bg-red-500/20 rounded-lg hover:bg-red-500/40 text-red-400 hover:text-red-300"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  {/* Type Badge */}
                  <div className="absolute top-2 left-2">
                    {renderTypeBadge(output.file_type)}
                  </div>
                </div>

                {/* Info */}
                <div className="p-3">
                  <p
                    className="text-sm text-white truncate"
                    title={output.filename}
                  >
                    {output.filename}
                  </p>
                  <div className="flex items-center justify-between mt-1 text-xs text-muted">
                    <span>{formatFileSize(output.size_bytes)}</span>
                    <span>{formatDate(output.created_at)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* Grid View — Grouped by type */}
        {!isLoading && viewMode === "grid" && groupByType && groupedOutputs && (
          <div className="space-y-6">
            {(["video", "audio", "image"] as const).map((type) => {
              const items = groupedOutputs[type];
              if (items.length === 0) return null;
              const label = type === "video" ? "Videos" : type === "audio" ? "Audio" : "Images";
              const Icon = type === "video" ? Video : type === "audio" ? Music : Image;
              const color = type === "video" ? "text-blue-400" : type === "audio" ? "text-emerald-400" : "text-purple-400";
              return (
                <div key={type}>
                  <h3 className="flex items-center gap-2 text-sm font-bold text-white mb-3">
                    <Icon size={16} className={color} /> {label} <span className="text-xs font-normal text-muted">({items.length})</span>
                    <span className="flex-1 h-px bg-white/5 ml-2" />
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {items.map((output) => (
                      <div
                        key={output.path}
                        onClick={() => setSelectedOutput(output)}
                        className={`card overflow-hidden cursor-pointer group hover:ring-2 hover:ring-primary/50 transition-all ${typeAccent[output.file_type] || ""}`}
                      >
                        <div className="aspect-square bg-surface flex items-center justify-center relative overflow-hidden">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleSelect(output.relative_path); }}
                            className={`absolute top-2 right-2 z-10 w-7 h-7 rounded-lg flex items-center justify-center border backdrop-blur transition-all ${selectedPaths.has(output.relative_path) ? "bg-violet-600 border-violet-500 text-white" : "bg-black/40 border-white/20 text-white/70 hover:bg-black/60"}`}
                          >
                            {selectedPaths.has(output.relative_path) ? <CheckSquare size={14} /> : <Square size={14} />}
                          </button>
                          {duplicatePaths.has(output.relative_path) && (
                            <div className="absolute top-2 right-10 z-10 w-6 h-6 rounded-full bg-amber-500 border border-amber-600 flex items-center justify-center">
                              <Copy size={10} className="text-white" />
                            </div>
                          )}
                          {output.file_type === "image" ? (
                            <img src={getOutputUrl(output.relative_path)} alt={output.filename} className="w-full h-full object-cover" loading="lazy" />
                          ) : output.cover_image ? (
                            <img src={getOutputUrl(output.cover_image)} alt={output.filename} className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <div className="flex flex-col items-center gap-2 text-muted">
                              {output.file_type === "video" ? <Video className="w-12 h-12" /> : output.file_type === "audio" ? <Music className="w-12 h-12" /> : renderFileIcon(output.file_type, "w-12 h-12")}
                              <span className="text-xs uppercase">{output.file_type}</span>
                            </div>
                          )}
                          {output.file_type === "audio" && output.cover_image && (
                            <div className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-black/60 backdrop-blur flex items-center justify-center border border-white/10">
                              <Music size={12} className="text-white" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                            <a href={getOutputUrl(output.relative_path)} download onClick={(e) => e.stopPropagation()} className="p-2 bg-white/10 rounded-lg hover:bg-white/20 text-white"><Download size={16} /></a>
                            <button onClick={(e) => { e.stopPropagation(); setRenameTarget(output); setRenameValue(output.filename); }} className="p-2 bg-white/10 rounded-lg hover:bg-white/20 text-white"><Pencil size={16} /></button>
                            <button onClick={(e) => { e.stopPropagation(); setOutputToDelete(output); }} className="p-2 bg-red-500/20 rounded-lg hover:bg-red-500/40 text-red-400"><Trash2 size={16} /></button>
                          </div>
                          {/* Type badge hidden when grouped — header already says Video/Audio */}
                        </div>
                        <div className="p-3">
                          <p className="text-sm text-white truncate" title={output.filename}>{output.filename}</p>
                          <div className="flex items-center justify-between mt-1 text-xs text-muted">
                            <span>{formatFileSize(output.size_bytes)}</span>
                            <span>{formatDate(output.created_at)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* List View */}
        {!isLoading && viewMode === "list" && (
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead className="bg-surface border-b border-border">
                <tr>
                  <th className="text-left text-xs font-medium text-muted uppercase tracking-wide px-4 py-3">
                    File
                  </th>
                  <th className="text-left text-xs font-medium text-muted uppercase tracking-wide px-4 py-3">
                    Type
                  </th>
                  <th className="text-left text-xs font-medium text-muted uppercase tracking-wide px-4 py-3">
                    Size
                  </th>
                  <th className="text-left text-xs font-medium text-muted uppercase tracking-wide px-4 py-3">
                    Created
                  </th>
                  <th className="text-left text-xs font-medium text-muted uppercase tracking-wide px-4 py-3">
                    Modified
                  </th>
                  <th className="text-left text-xs font-medium text-muted uppercase tracking-wide px-4 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredOutputs.map((output) => (
                  <tr
                    key={output.path}
                    onClick={() => setSelectedOutput(output)}
                    className="hover:bg-surface-hover cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleSelect(output.relative_path); }}
                          className={`w-7 h-7 rounded-lg flex items-center justify-center border shrink-0 ${selectedPaths.has(output.relative_path) ? "bg-violet-600 border-violet-500 text-white" : "border-white/10 bg-white/5 text-muted hover:bg-white/10"}`}
                          title={selectedPaths.has(output.relative_path) ? "Deselect" : "Select"}
                        >
                          {selectedPaths.has(output.relative_path) ? <CheckSquare size={13} /> : <Square size={13} />}
                        </button>
                        {duplicatePaths.has(output.relative_path) && <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title="Duplicate" />}
                        {output.file_type === "image" ? (
                          <div className="w-10 h-10 rounded overflow-hidden bg-surface">
                            <img
                              src={getOutputUrl(output.relative_path)}
                              alt={output.filename}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </div>
                        ) : output.cover_image ? (
                          <div className="w-10 h-10 rounded overflow-hidden bg-surface shrink-0">
                            <img
                              src={getOutputUrl(output.cover_image)}
                              alt={output.filename}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          renderFileIcon(output.file_type)
                        )}
                        <div>
                          <p className="text-sm text-white">{output.filename}</p>
                          {output.job_id && (
                            <p className="text-xs text-muted font-mono">
                              {output.job_id}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {renderTypeBadge(output.file_type)}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">
                      {formatFileSize(output.size_bytes)}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">
                      {formatDate(output.created_at)}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">
                      {output.modified_at ? formatDate(output.modified_at) : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setRenameTarget(output); setRenameValue(output.filename); }}
                          className="p-2 hover:bg-surface rounded-lg text-muted hover:text-white"
                          title="Rename"
                        >
                          <Pencil size={14} />
                        </button>
                        <a
                          href={getOutputUrl(output.relative_path)}
                          download
                          onClick={(e) => e.stopPropagation()}
                          className="p-2 hover:bg-surface rounded-lg text-muted hover:text-white"
                          title="Download"
                        >
                          <Download size={16} />
                        </a>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOutputToDelete(output);
                          }}
                          className="p-2 hover:bg-red-500/20 rounded-lg text-muted hover:text-red-400"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && filteredOutputs.length === 0 && (
          <div className="card p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-surface flex items-center justify-center mx-auto mb-4">
              {currentCategory.icon && (
                <currentCategory.icon className="w-8 h-8 text-muted" />
              )}
            </div>
            <h3 className="text-lg font-medium text-white mb-2">No files found</h3>
            <p className="text-muted">
              {hasActiveFilters
                ? "No files match your search or filter criteria"
                : "Generate some images, videos, or audio to see them here"}
            </p>
            {hasActiveFilters && (
              <button
                onClick={handleClearFilters}
                className="btn btn-secondary mt-4"
              >
                Clear Filters
              </button>
            )}
          </div>
        )}

        {/* Detail Modal */}
        {selectedOutput && (
          <div
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedOutput(null)}
          >
            <div
              className="card max-w-4xl w-full max-h-[90vh] overflow-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h3 className="text-lg font-semibold text-white truncate pr-4">
                  {selectedOutput.filename}
                </h3>
                <button
                  onClick={() => setSelectedOutput(null)}
                  className="p-2 hover:bg-surface rounded-lg text-muted hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-4">
                {/* Preview — audio with cover art */}
                <div className="rounded-lg overflow-hidden bg-surface mb-4">
                  {selectedOutput.file_type === "image" ? (
                    <img
                      src={getOutputUrl(selectedOutput.relative_path)}
                      alt={selectedOutput.filename}
                      className="w-full max-h-[60vh] object-contain"
                    />
                  ) : selectedOutput.file_type === "video" ? (
                    <video
                      src={getOutputUrl(selectedOutput.relative_path)}
                      controls
                      autoPlay
                      className="w-full max-h-[60vh] bg-black"
                    />
                  ) : selectedOutput.file_type === "audio" ? (
                    <div className="flex flex-col">
                      {selectedOutput.cover_image && (
                        <img
                          src={getOutputUrl(selectedOutput.cover_image)}
                          alt={selectedOutput.filename}
                          className="w-full max-h-[50vh] object-contain bg-black"
                        />
                      )}
                      <audio
                        src={getOutputUrl(selectedOutput.relative_path)}
                        controls
                        autoPlay
                        className="w-full"
                      />
                      {!selectedOutput.cover_image && (
                        <div className="py-3 flex items-center justify-center gap-2 text-muted text-sm">
                          <Music size={16} /> No embedded cover — add one with an ID3 editor
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="h-64 flex items-center justify-center text-muted">
                      <div className="text-center">
                        {renderFileIcon(selectedOutput.file_type, "w-16 h-16 mx-auto mb-2")}
                        <p>Preview not available</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Enhanced Metadata */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="bg-surface rounded-lg p-3">
                    <div className="flex items-center gap-2 text-xs text-muted mb-1">
                      <FileType size={12} />
                      Type
                    </div>
                    <p className="text-sm text-white capitalize">
                      {selectedOutput.file_type}
                    </p>
                  </div>
                  <div className="bg-surface rounded-lg p-3">
                    <div className="flex items-center gap-2 text-xs text-muted mb-1">
                      <HardDrive size={12} />
                      Size
                    </div>
                    <p className="text-sm text-white">
                      {formatFileSize(selectedOutput.size_bytes)}
                    </p>
                  </div>
                  <div className="bg-surface rounded-lg p-3">
                    <div className="flex items-center gap-2 text-xs text-muted mb-1">
                      <Clock size={12} />
                      Created
                    </div>
                    <p className="text-sm text-white">
                      {formatDateTime(selectedOutput.created_at)}
                    </p>
                  </div>
                  {selectedOutput.modified_at && (
                    <div className="bg-surface rounded-lg p-3">
                      <div className="flex items-center gap-2 text-xs text-muted mb-1">
                        <Clock size={12} />
                        Modified
                      </div>
                      <p className="text-sm text-white">
                        {formatDateTime(selectedOutput.modified_at)}
                      </p>
                    </div>
                  )}
                  {selectedOutput.job_id && (
                    <div className="bg-surface rounded-lg p-3">
                      <div className="flex items-center gap-2 text-xs text-muted mb-1">
                        <Tag size={12} />
                        Job ID
                      </div>
                      <p className="text-sm text-white font-mono truncate">
                        {selectedOutput.job_id}
                      </p>
                    </div>
                  )}
                </div>

                {/* Metadata JSON */}
                {selectedOutput.metadata && (
                  <div className="mt-4">
                    <p className="text-xs text-muted mb-2">Metadata</p>
                    <pre className="bg-surface rounded-lg p-3 text-xs text-white overflow-auto max-h-48">
                      {JSON.stringify(selectedOutput.metadata, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Actions — now with rename */}
                <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-border">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setRenameTarget(selectedOutput); setRenameValue(selectedOutput.filename); }}
                      className="btn btn-secondary flex items-center gap-2"
                    >
                      <Pencil size={16} /> Rename
                    </button>
                    <button
                      onClick={() => setOutputToDelete(selectedOutput)}
                      className="btn btn-danger flex items-center gap-2"
                    >
                      <Trash2 size={16} />
                      Delete
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedOutput.file_type === "image" && (
                      <button
                        onClick={() => setShowFullImage(true)}
                        className="btn btn-secondary flex items-center gap-2"
                      >
                        <Maximize2 size={16} />
                        Full Size
                      </button>
                    )}
                    <a
                      href={getOutputUrl(selectedOutput.relative_path)}
                      download
                      className="btn btn-primary flex items-center gap-2"
                    >
                      <Download size={16} />
                      Download
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Full Image Viewer */}
        {showFullImage && selectedOutput?.file_type === "image" && (
          <div
            className="fixed inset-0 bg-black/95 z-[60] flex items-center justify-center p-4"
            onClick={() => setShowFullImage(false)}
          >
            <div className="relative max-w-full max-h-full">
              <button
                onClick={() => setShowFullImage(false)}
                className="absolute top-4 right-4 p-2 bg-black/50 rounded-lg text-white hover:bg-black/70 z-10"
              >
                <X size={24} />
              </button>
              <img
                src={getOutputUrl(selectedOutput.relative_path)}
                alt={selectedOutput.filename}
                className="max-w-full max-h-[90vh] object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {outputToDelete && (
          <div
            className="fixed inset-0 bg-black/80 z-[70] flex items-center justify-center p-4"
            onClick={() => setOutputToDelete(null)}
          >
            <div
              className="card max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-center gap-3 text-red-400 mb-4">
                  <AlertTriangle size={32} />
                  <h3 className="text-lg font-semibold text-white">Delete File?</h3>
                </div>
                <p className="text-muted mb-2">
                  Are you sure you want to delete:
                </p>
                <p className="text-white font-medium mb-6">{outputToDelete.filename}</p>
                <p className="text-sm text-muted mb-6">
                  This also removes its cover jpg and JSON sidecar and cannot be undone.
                </p>
                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={() => setOutputToDelete(null)}
                    disabled={isDeleting}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleDelete(outputToDelete)}
                    disabled={isDeleting}
                    className="btn btn-danger flex items-center gap-2"
                  >
                    {isDeleting ? (
                      <RefreshCw size={16} className="animate-spin" />
                    ) : (
                      <Trash2 size={16} />
                    )}
                    {isDeleting ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Rename Modal */}
        {renameTarget && (
          <div className="fixed inset-0 bg-black/80 z-[70] flex items-center justify-center p-4" onClick={() => setRenameTarget(null)}>
            <div className="card max-w-md w-full" onClick={(e) => e.stopPropagation()}>
              <div className="p-6">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Pencil size={18} /> Rename</h3>
                <p className="text-sm text-muted mt-1 truncate" title={renameTarget.filename}>Current: {renameTarget.filename}</p>
                <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleRename()} placeholder="New filename" className="input mt-4 w-full" />
                <p className="text-xs text-muted mt-2">Keep extension (.{renameTarget.filename.split(".").pop()}) or type will change. No slashes.</p>
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setRenameTarget(null)} className="btn btn-secondary" disabled={isRenaming}>Cancel</button>
                  <button onClick={handleRename} disabled={isRenaming || !renameValue.trim() || renameValue === renameTarget.filename} className="btn btn-primary flex items-center gap-2">
                    {isRenaming ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />} Rename
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}