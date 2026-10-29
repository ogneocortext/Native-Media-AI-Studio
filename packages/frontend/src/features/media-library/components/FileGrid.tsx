import { FileCard } from "./FileCard";
import type { MediaFile } from "../hooks/useMediaFiles";
import type { Collection, Tag } from "../../../services/api";

interface FileGridProps {
  files: MediaFile[];
  viewMode: "grid" | "list";
  onFileClick: (file: MediaFile) => void;
  onSelect?: (file: MediaFile) => void;
  onDelete?: (file: MediaFile) => void | Promise<void>;
  onRename?: (file: MediaFile) => void | Promise<void>;
  onSendToWizard?: (file: MediaFile) => void;
  onGenerateThumbnail?: (file: MediaFile) => void;
  selectedPaths: Set<string>;
  favoritedPaths?: Set<string>;
  itemCollections?: Map<string, Collection[]>;
  itemTags?: Map<string, Tag[]>;
  onToggleFavorite?: (file: MediaFile) => void | Promise<void>;
}

export function FileGrid({
  files,
  viewMode,
  onFileClick,
  onSelect,
  onDelete,
  onRename,
  onSendToWizard,
  onGenerateThumbnail,
  selectedPaths,
  favoritedPaths = new Set(),
  itemCollections = new Map(),
  itemTags = new Map(),
  onToggleFavorite,
}: FileGridProps) {
  if (files.length === 0) {
    return (
      <div className="text-center py-8 text-muted">
        No files found matching your criteria
      </div>
    );
  }

  const renderCard = (file: MediaFile) => {
    const key = file.relative_path || file.filename;
    return (
      <FileCard
        key={key}
        file={file}
        viewMode={viewMode}
        selected={selectedPaths.has(key)}
        isFavorited={favoritedPaths.has(key)}
        tags={itemTags.get(key) ?? []}
        collections={itemCollections.get(key) ?? []}
        onSelect={onSelect ? (f) => onSelect(f) : undefined}
        onClick={onFileClick}
        onDelete={onDelete}
        onRename={onRename}
        onSendToWizard={onSendToWizard}
        onToggleFavorite={onToggleFavorite}
        onGenerateThumbnail={onGenerateThumbnail}
        className={
          viewMode === "list"
            ? "flex items-center gap-3 p-2 hover:bg-black/40 rounded"
            : undefined
        }
      />
    );
  };

  if (viewMode === "list") {
    return (
      <div className="divide-y divide-white/5">
        {files.map(renderCard)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {files.map(renderCard)}
    </div>
  );
}
