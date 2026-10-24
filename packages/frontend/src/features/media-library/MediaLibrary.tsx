/**
 * MediaLibrary — browser UI for all `output/` file operations.
 *
 * Docs: `docs/guides/FILE_MANAGEMENT.md` covers play, cover art, rename,
 * delete, duplicates, and the selection/bulk bar.
 *
 * Responsibilities:
 * - List outputs (audio covers, thumbnails, list/grid views)
 * - Select items → bulk bar (Clear / Delete Selected → POST /bulk-delete)
 * - Find exact duplicates (GET /api/outputs/duplicates/groups)
 * - Play audio/video (cover + `<audio controls autoplay>` / `<video>`)
 * - Rename (POST /api/outputs/{path}/rename) and delete (DELETE /api/outputs/{path})
 */
import { useCallback, useState, useEffect } from "react";
import { Square, Music, Video, RefreshCw } from "lucide-react";
import { useFileOperations } from "./hooks/useFileOperations";
import { useMediaFiles, type MediaFile } from "./hooks/useMediaFiles";
import { useFileFilters } from "./hooks/useFileFilters";
import { FilterBar } from "./components/FilterBar";
import { FileGrid } from "./components/FileGrid";
import { Pagination } from "./components/Pagination";
import { BulkBar } from "./components/BulkBar";
import { PlaybackModal } from "./components/PlaybackModal";
import { DuplicatesPanel } from "./components/DuplicatesPanel";
import { fetchWithTimeout } from "../../services/fetchWithTimeout";
import { formatFileSize, formatDateTime } from "../../utils/format";
import { DS } from "../../styles/designSystem";

const PAGE_SIZE = 50;

export function MediaLibrary() {
  const { files: allFiles, loading, error, refetch } = useMediaFiles();
  const {
    handleDelete,
    handleBulkDelete,
    handleRename,
    handleProbe,
    isOperating,
  } = useFileOperations();

  const [filter, setFilter] = useState<{
    query: string;
    category: string | "all";
    fileType: string | "all";
    sortBy: "name" | "size" | "date";
    sortOrder: "asc" | "desc";
  }>({
    query: "",
    category: "all",
    fileType: "all",
    sortBy: "name",
    sortOrder: "asc",
  });
  const [currentPage, setCurrentPage] = useState(1);

  const filteredFiles = useFileFilters(allFiles, filter);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [playingFile, setPlayingFile] = useState<{
    filename: string;
    file_type: string;
    cover_image: string | null;
    has_cover: boolean;
    relative_path: string;
  } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<MediaFile | null>(null);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);

  const pageSize = PAGE_SIZE;
  const totalPages = Math.ceil(filteredFiles.length / pageSize) || 1;
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedFiles = filteredFiles.slice(startIndex, startIndex + pageSize);

  const relativeKey = (f: MediaFile) => f.relative_path || f.filename;

  const toggleSelect = useCallback((file: MediaFile) => {
    const key = relativeKey(file);
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedPaths(new Set()), []);

  const handleFileClick = (file: MediaFile) => {
    setSelectedFile(file);
    setDetailOpen(true);
  };

  const handlePlay = (file: MediaFile) => {
    setPlayingFile({
      filename: file.filename,
      file_type: file.file_type,
      cover_image: file.cover_image,
      has_cover: file.has_cover,
      relative_path: file.relative_path,
    });
  };

  const handleFindDuplicates = async () => {
    setDuplicatesLoading(true);
    try {
      await fetchWithTimeout(
        "/api/outputs/duplicates/groups?quick=true",
        { timeout: 30000 }
      );
    } finally {
      setDuplicatesLoading(false);
    }
    setDuplicatesOpen(true);
  };

  const handleBulkDeleteSelected = async () => {
    const paths = Array.from(selectedPaths);
    const result = await handleBulkDelete(paths);
    if (result.deleted > 0) {
      clearSelection();
      void refetch();
      setCurrentPage(1);
    }
  };

  const handleDeleteFile = async (file: MediaFile) => {
    const ok = await handleDelete(file.filename, file.relative_path);
    if (ok) {
      clearSelection();
      void refetch();
    }
  };

  const handleRenameFile = async (
    file: MediaFile,
    newName: string
  ) => {
    const ok = await handleRename(file.filename, file.relative_path, newName);
    if (ok) {
      clearSelection();
      void refetch();
    }
  };

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filter.query, filter.category, filter.fileType, filter.sortBy, filter.sortOrder]);

  return (
    <main className={DS.page}>
      <h1 className={DS.pageTitle}>
        <Music size={22} className="text-accent" />
        Media Library
      </h1>
      <p className={DS.pageSubtitle}>
        Browse and manage files in `output/` — audio covers, video thumbnails,
        rename, delete, duplicates, and bulk actions.
      </p>

      {error && (
        <div className="mb-4 bg-red-900/30 border border-red-700 text-red-300 rounded p-4 flex items-center gap-3">
          <span>Error loading files</span>
          <button
            onClick={refetch}
            className="text-xs underline text-red-200 hover:text-white ml-auto"
          >
            Refresh
          </button>
        </div>
      )}

      {/* Header: view toggle + duplicates + refresh */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode("grid")}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              viewMode === "grid"
                ? "bg-primary/20 text-primary"
                : "bg-black/30 text-muted hover:bg-black/50"
            }`}
          >
            <Square size={14} /> Grid
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              viewMode === "list"
                ? "bg-primary/20 text-primary"
                : "bg-black/30 text-muted hover:bg-black/50"
            }`}
          >
            <Video size={14} /> List
          </button>
        </div>

        {selectedPaths.size > 0 ? (
          <BulkBar
            selectedCount={selectedPaths.size}
            onClear={clearSelection}
            onDeleteSelected={handleBulkDeleteSelected}
            isDeleting={isOperating}
          />
        ) : (
          <button
            onClick={handleFindDuplicates}
            disabled={duplicatesLoading}
            className="px-3 py-1 text-xs bg-violet-900/30 border border-violet-700 rounded text-violet-300 hover:bg-violet-800/50 disabled:opacity-50"
          >
            {duplicatesLoading ? (
              <span className="flex items-center gap-1">
                <RefreshCw size={12} className="animate-spin" />
                Scanning…
              </span>
            ) : (
              <>
                <RefreshCw size={14} /> Find Duplicates
              </>
            )}
          </button>
        )}

        <button
          onClick={refetch}
          className="px-3 py-1 text-xs text-muted hover:text-white border border-gray-600 rounded"
          title="Refresh file list"
        >
          <RefreshCw size={14} className="mr-1" /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted">Loading files…</div>
      ) : (
        <>
          <FilterBar filter={filter} onChange={setFilter} />

          <FileGrid
            files={paginatedFiles}
            viewMode={viewMode}
            onFileClick={handleFileClick}
            onSelect={toggleSelect}
            onDelete={handleDeleteFile}
            onRename={(file) => {
              const newName = window.prompt(
                `Rename "${file.filename}"`,
                file.filename
              );
              if (newName && newName !== file.filename) {
                void handleRenameFile(file, newName);
              }
            }}
            onSendToWizard={(file) => {
              // Handoff to music video wizard
              window.dispatchEvent(
                new CustomEvent("send-to-wizard", { detail: { file } })
              );
            }}
            selectedPaths={selectedPaths}
          />

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            pageSize={pageSize}
            totalCount={filteredFiles.length}
          />
        </>
      )}

      {/* Playback modal */}
      {playingFile && (
        <PlaybackModal
          isOpen={!!playingFile}
          onClose={() => setPlayingFile(null)}
          file={playingFile}
        />
      )}

      {/* Detail modal */}
      {detailOpen && selectedFile && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => {
            setDetailOpen(false);
            setSelectedFile(null);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-black/90 border border-white/10 rounded-xl max-w-lg w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-3xl">
                  {selectedFile.file_type === "audio" ? (
                    <Music size={36} />
                  ) : selectedFile.file_type === "video" ? (
                    <Video size={36} />
                  ) : (
                    "📄"
                  )}
                </span>
                <h3 className="text-lg font-semibold text-white truncate">
                  {selectedFile.filename}
                </h3>
              </div>
              <button
                onClick={() => {
                  setDetailOpen(false);
                  setSelectedFile(null);
                }}
                className="text-muted hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-sm text-muted">
              <p>File Type: {selectedFile.file_type}</p>
              <p>Size: {formatFileSize(selectedFile.size_bytes ?? selectedFile.size ?? 0)}</p>
              <p>Modified: {formatDateTime(selectedFile.modified_at || selectedFile.modified_time || "")}</p>
              {selectedFile.has_cover && selectedFile.cover_image && (
                <p className="text-green-400">Cover art extracted</p>
              )}
              {selectedFile.analysis && (
                <p className="text-green-400">Analysis: Available</p>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => {
                  handlePlay(selectedFile);
                  setDetailOpen(false);
                  setSelectedFile(null);
                }}
                className="px-3 py-1 text-sm bg-primary/20 text-primary rounded hover:bg-primary/30"
              >
                Play
              </button>
              <button
                onClick={() => {
                  handleProbe(selectedFile.filename);
                  setDetailOpen(false);
                  setSelectedFile(null);
                }}
                className="px-3 py-1 text-sm bg-violet-900/30 text-violet-300 rounded hover:bg-violet-800/50"
              >
                Probe Analysis
              </button>
              <button
                onClick={() => {
                  setDetailOpen(false);
                  setSelectedFile(null);
                }}
                className="px-3 py-1 text-sm bg-black/30 text-muted rounded hover:bg-black/50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {duplicatesOpen && (
        <DuplicatesPanel
          isOpen={duplicatesOpen}
          onClose={() => setDuplicatesOpen(false)}
          onRefetch={refetch}
        />
      )}
    </main>
  );
}
