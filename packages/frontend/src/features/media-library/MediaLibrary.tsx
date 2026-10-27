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
 * - Rename (POST /api/outputs/{path}/rename) and delete → trash
 * - Organization: favorites, collections, tags, soft-delete trash
 */
import { useCallback, useState, useEffect } from "react";
import { Square, Music, Video, RefreshCw, Heart, Trash2, Tag } from "lucide-react";
import { useFileOperations } from "./hooks/useFileOperations";
import { useMediaFiles, type MediaFile } from "./hooks/useMediaFiles";
import { useFileFilters } from "./hooks/useFileFilters";
import { useMediaLibrary } from "./hooks/useMediaLibrary";
import { FilterBar } from "./components/FilterBar";
import { FileGrid } from "./components/FileGrid";
import { Pagination } from "./components/Pagination";
import { BulkBar } from "./components/BulkBar";
import { PlaybackModal } from "./components/PlaybackModal";
import { DuplicatesPanel } from "./components/DuplicatesPanel";
import { TrashPanel } from "./components/TrashPanel";
import { fetchWithTimeout } from "../../services/fetchWithTimeout";
import { formatFileSize, formatDateTime } from "../../utils/format";
import { DS } from "../../styles/designSystem";

const PAGE_SIZE = 50;

type View = "library" | "favorites" | "collections" | "trash";

export function MediaLibrary() {
  const { files: allFiles, loading: filesLoading, error, refetch: refetchFiles } =
    useMediaFiles();
  const {
    handleDelete,
    handleBulkDelete,
    handleRename,
    handleProbe,
    isOperating,
  } = useFileOperations();
  const {
    favorites,
    collections,
    trash,
    itemCollections,
    itemTags,
    loading: orgLoading,
    error: orgError,
    refetch: refetchOrg,
    toggleFavorite,
    tags,
    deleteCollection,
    addItemToCollection,
    removeItemFromCollection,
    loadItemCollections,
    createTag,
    addTagToItem,
    removeTagFromItem,
    loadItemTags,
    moveToTrash,
    restoreTrashItem,
    purgeTrashItem,
    emptyTrash,
  } = useMediaLibrary();

  const [filter, setFilter] = useState<{
    query: string;
    fileType: string | "all";
    tagFilter: string | null;
    sortBy: "name" | "size" | "date";
    sortOrder: "asc" | "desc";
  }>({
    query: "",
    fileType: "all",
    tagFilter: null,
    sortBy: "name",
    sortOrder: "asc",
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [view, setView] = useState<View>("library");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // collectionId -> item count, derived from itemCollections membership
  const collectionItemCounts = new Map<string, number>();
  itemCollections.forEach((colls) => {
    colls.forEach((c) => {
      collectionItemCounts.set(c.id, (collectionItemCounts.get(c.id) || 0) + 1);
    });
  });
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
  const [trashOpen, setTrashOpen] = useState(false);

  const filteredFiles = useFileFilters(allFiles, filter, itemTags);

  // Apply favorites filter when in favorites view
  const filesForView =
    view === "favorites"
      ? filteredFiles.filter((f) => favorites.has(f.relative_path || f.filename))
      : filteredFiles;

  const pageSize = PAGE_SIZE;
  const totalPages = Math.ceil(filesForView.length / pageSize) || 1;
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedFiles = filesForView.slice(
    startIndex,
    startIndex + pageSize
  );

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
      void refetchFiles();
      setCurrentPage(1);
    }
  };

  const handleDeleteFile = async (file: MediaFile) => {
    const ok = await handleDelete(file.filename, file.relative_path);
    if (ok) {
      // Also move to trash in the org layer
      await moveToTrash(file.relative_path);
      clearSelection();
      void refetchFiles();
      void refetchOrg();
    }
  };

  const handleRenameFile = async (
    file: MediaFile,
    newName: string
  ) => {
    const ok = await handleRename(file.filename, file.relative_path, newName);
    if (ok) {
      clearSelection();
      void refetchFiles();
    }
  };

  const handleToggleFavorite = useCallback(
    async (file: MediaFile) => {
      await toggleFavorite(file.relative_path);
      void refetchOrg();
    },
    [toggleFavorite, refetchOrg]
  );

  const handleAddTagByName = useCallback(
    async (file: MediaFile, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      let tag = tags.find((t) => t.name === trimmed);
      if (!tag) {
        tag = await createTag(trimmed);
      }
      await addTagToItem(file.relative_path, tag.id);
      await loadItemTags(file.relative_path);
    },
    [tags, createTag, addTagToItem, loadItemTags]
  );

  const handleRemoveTag = useCallback(
    async (file: MediaFile, tagId: string) => {
      await removeTagFromItem(file.relative_path, tagId);
      await loadItemTags(file.relative_path);
    },
    [removeTagFromItem, loadItemTags]
  );

  const handleAddToCollection = useCallback(
    async (file: MediaFile, collectionId: string) => {
      await addItemToCollection(collectionId, file.relative_path);
      await loadItemCollections(file.relative_path);
    },
    [addItemToCollection, loadItemCollections]
  );

  const handleRemoveFromCollection = useCallback(
    async (file: MediaFile, collectionId: string) => {
      await removeItemFromCollection(collectionId, file.relative_path);
      await loadItemCollections(file.relative_path);
    },
    [removeItemFromCollection, loadItemCollections]
  );

  // Reset page when filters or view change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    filter.query,
    filter.fileType,
    filter.tagFilter,
    filter.sortBy,
    filter.sortOrder,
    view,
  ]);

  const loading = filesLoading || orgLoading;
  const combinedError = error || orgError;

  return (
    <main className={DS.page}>
      <h1 className={DS.pageTitle}>
        <Music size={22} className="text-accent" />
        Media Library
      </h1>
      <p className={DS.pageSubtitle}>
        Browse and manage files in `output/` — covers, thumbnails, rename,
        delete, duplicates, favorites, collections, tags, and trash.
      </p>      {combinedError && (
        <div className="mb-4 bg-red-900/30 border border-red-700 text-red-300 rounded p-4 flex items-center gap-3">
          <span>Error loading files</span>
          <button
            onClick={() => {
              void refetchFiles();
              void refetchOrg();
            }}
            className="text-xs underline text-red-200 hover:text-white ml-auto"
          >
            Refresh
          </button>
        </div>
      )}

      {/* View tabs: Library / Favorites / Collections / Trash */}
      <div className="mb-3 flex gap-1">
        <button
          onClick={() => setView("library")}
          className={`px-3 py-1 text-xs rounded-md transition-colors ${
            view === "library"
              ? "bg-primary/30 text-primary border border-primary/40 shadow-sm ring-1 ring-primary/20"
              : "bg-black/30 text-muted hover:bg-black/50 border border-transparent"
          }`}
        >
          Library
        </button>
        <button
          onClick={() => setView("favorites")}
          className={`px-3 py-1 text-xs rounded-md transition-colors ${
            view === "favorites"
              ? "bg-amber-500/25 text-amber-300 border border-amber-500/40 shadow-sm ring-1 ring-amber-500/20"
              : "bg-black/30 text-muted hover:bg-black/50 border border-transparent"
          }`}
        >
          <Heart size={14} className="mr-1" /> Favorites
          {favorites.size > 0 && (
            <span className="ml-1 text-[10px] bg-amber-500 text-black rounded-full px-1">
              {favorites.size}
            </span>
          )}
        </button>
        <button
          onClick={() => setView("collections")}
          className={`px-3 py-1 text-xs rounded-md transition-colors ${
            view === "collections"
              ? "bg-blue-500/25 text-blue-300 border border-blue-500/40 shadow-sm ring-1 ring-blue-500/20"
              : "bg-black/30 text-muted hover:bg-black/50 border border-transparent"
          }`}
        >
          <Tag size={14} className="mr-1" /> Collections
          {collections.length > 0 && (
            <span className="ml-1 text-[10px] bg-blue-500 text-black rounded-full px-1">
              {collections.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setView("trash")}
          className={`px-3 py-1 text-xs rounded-md transition-colors ${
            view === "trash"
              ? "bg-red-500/25 text-red-300 border border-red-500/40 shadow-sm ring-1 ring-red-500/20"
              : "bg-black/30 text-muted hover:bg-black/50 border border-transparent"
          }`}
        >
          <Trash2 size={14} className="mr-1" /> Trash
          {trash.length > 0 && (
            <span className="ml-1 text-[10px] bg-red-500 text-black rounded-full px-1">
              {trash.length}
            </span>
          )}
        </button>
      </div>

      {/* Header: view toggle + duplicates + refresh (library/favorites only) */}
      {view === "library" || view === "favorites" ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {/* Left: view toggles */}
          <div className="flex gap-1">
            <button
              onClick={() => setViewMode("grid")}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                viewMode === "grid"
                  ? "bg-primary/20 text-primary border border-primary/30 shadow-sm"
                  : "bg-black/30 text-muted hover:bg-black/50 border border-transparent"
              }`}
            >
              <Square size={14} /> Grid
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                viewMode === "list"
                  ? "bg-primary/20 text-primary border border-primary/30 shadow-sm"
                  : "bg-black/30 text-muted hover:bg-black/50 border border-transparent"
              }`}
            >
              <Video size={14} /> List
            </button>
          </div>

          {/* Center: bulk bar or actions */}
          {selectedPaths.size > 0 ? (
            <BulkBar
              selectedCount={selectedPaths.size}
              onClear={clearSelection}
              onDeleteSelected={handleBulkDeleteSelected}
              isDeleting={isOperating}
            />
          ) : (
            <>
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

              <button
                onClick={() => setTrashOpen(true)}
                className="px-3 py-1 text-xs text-muted hover:text-white border border-gray-600 rounded"
                title="Trash"
              >
                <Trash2 size={14} className="mr-1" /> Trash
              </button>
            </>
          )}

          {/* Right: refresh */}
          <button
            onClick={() => {
              void refetchFiles();
              void refetchOrg();
            }}
            className="px-3 py-1 text-sm text-muted hover:text-white border border-gray-600 rounded"
            title="Refresh file list"
          >
            <RefreshCw size={16} className="mr-1" /> Refresh
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="text-center py-12 text-muted">Loading…</div>
      ) : view === "library" || view === "favorites" ? (
        <>
          <FilterBar filter={filter} tags={tags} onChange={setFilter} />

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
              window.dispatchEvent(
                new CustomEvent("send-to-wizard", { detail: { file } })
              );
            }}
            selectedPaths={selectedPaths}
            favoritedPaths={favorites}
            itemCollections={itemCollections}
            itemTags={itemTags}
            onToggleFavorite={handleToggleFavorite}
          />

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            pageSize={pageSize}
            totalCount={filesForView.length}
          />
        </>
      ) : view === "collections" ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-white">Collections</h3>
          {collections.length === 0 ? (
            <div className="text-center py-12 text-muted">
              No collections yet. Create one to group media items.
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {collections.map((collection) => (
                <div
                  key={collection.id}
                  className="p-3 bg-black/40 border border-white/10 rounded-lg flex items-center justify-between group hover:bg-black/50 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.alert(
                      `Collection: ${collection.name} (${
                        collectionItemCounts.get(collection.id) || 0
                      } items)`
                    );
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-blue-600/20 flex items-center justify-center text-blue-300">
                      <Tag size={16} />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white truncate">
                        {collection.name}
                      </div>
                      <div className="text-xs text-muted">
                        {collectionItemCounts.get(collection.id) || 0} items
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteCollection(collection.id);
                      void refetchOrg();
                    }}
                    className="text-xs text-red-500 hover:text-red-300"
                    title="Delete collection"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* Trash panel */}
      {trashOpen && (
        <TrashPanel
          isOpen={trashOpen}
          onClose={() => setTrashOpen(false)}
          trash={trash}
          restoreTrashItem={restoreTrashItem}
          purgeTrashItem={purgeTrashItem}
          emptyTrash={emptyTrash}
          refetchOrg={refetchOrg}
        />
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
              <p>Favorited: {favorites.has(selectedFile.relative_path || selectedFile.filename) ? "Yes" : "No"}</p>

              {/* Tags management */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted uppercase tracking-wider">Tags</span>
                  {itemTags.get(selectedFile.relative_path || selectedFile.filename)?.length === 0 && (
                    <span className="text-xs text-gray-500">none</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {itemTags.get(selectedFile.relative_path || selectedFile.filename)?.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-gray-700 text-xs text-gray-200 border border-gray-600"
                    >
                      <span className="font-medium">{tag.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRemoveTag(selectedFile, tag.id);
                        }}
                        className="text-gray-400 hover:text-white ml-1"
                        title="Remove tag"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <div className="relative">
                    <input
                      id="new-tag-input"
                      type="text"
                      placeholder="Add tag…"
                      className="w-32 text-xs bg-black/40 border border-gray-600 rounded px-2 py-1 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const name = (e.target as HTMLInputElement).value.trim();
                          if (!name) return;
                          (e.target as HTMLInputElement).value = "";
                          void handleAddTagByName(selectedFile, name);
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        const input = document.getElementById(
                          "new-tag-input"
                        ) as HTMLInputElement | null;
                        const name = input?.value.trim();
                        if (!input || !name) return;
                        input.value = "";
                        void handleAddTagByName(selectedFile, name);
                      }}
                      className="text-xs text-violet-400 hover:text-violet-300"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Collections management */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted uppercase tracking-wider">Collections</span>
                  {itemCollections.get(selectedFile.relative_path || selectedFile.filename)?.length === 0 && (
                    <span className="text-xs text-gray-500">none</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {itemCollections.get(selectedFile.relative_path || selectedFile.filename)?.map((c) => (
                    <span
                      key={c.id}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-900/30 text-xs text-blue-300 border border-blue-700/50"
                    >
                      <span className="font-medium">{c.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRemoveFromCollection(selectedFile, c.id);
                        }}
                        className="text-blue-400 hover:text-blue-300 ml-1"
                        title="Remove from collection"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {collections.length > 0 && (
                    <select
                      id="add-to-collection"
                      className="w-32 text-xs bg-black/40 border border-gray-600 rounded px-2 py-1 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
                      onChange={(e) => {
                        const collectionId = (e.target as HTMLSelectElement).value;
                        if (!collectionId) return;
                        (e.target as HTMLSelectElement).value = "";
                        void handleAddToCollection(selectedFile, collectionId);
                      }}
                    >
                      <option value="">Add to collection</option>
                      {collections
                        .filter(
                          (c) =>
                            !itemCollections
                              .get(selectedFile.relative_path || selectedFile.filename)
                              ?.some((ic) => ic.id === c.id)
                        )
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              </div>
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
          onRefetch={refetchFiles}
        />
      )}

      {trashOpen && (
        <TrashPanel
          isOpen={trashOpen}
          onClose={() => setTrashOpen(false)}
          trash={trash}
          restoreTrashItem={restoreTrashItem}
          purgeTrashItem={purgeTrashItem}
          emptyTrash={emptyTrash}
          refetchOrg={refetchOrg}
        />
      )}
    </main>
  );
}
