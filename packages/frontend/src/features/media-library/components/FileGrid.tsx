import { FileCard } from "./FileCard";
import type { MediaFile } from "../hooks/useMediaFiles";

interface FileGridProps {
  files: MediaFile[];
  viewMode: "grid" | "list";
  onFileClick: (file: MediaFile) => void;
  onSelect?: (file: MediaFile) => void;
  onDelete?: (file: MediaFile) => void;
  onRename?: (file: MediaFile) => void;
  onSendToWizard?: (file: MediaFile) => void;
  selectedPaths: Set<string>;
}

export function FileGrid({
  files,
  viewMode,
  onFileClick,
  onSelect,
  onDelete,
  onRename,
  onSendToWizard,
  selectedPaths,
}: FileGridProps) {
  if (files.length === 0) {
    return (
      <div className="text-center py-8 text-muted">
        No files found matching your criteria
      </div>
    );
  }

  if (viewMode === "list") {
    return (
      <div className="divide-y divide-white/5">
        {files.map((file) => (
          <FileCard
            key={file.relative_path || file.filename}
            file={file}
            viewMode="list"
            selected={selectedPaths.has(file.relative_path || file.filename)}
            onSelect={onSelect ? (f) => onSelect(f) : undefined}
            onClick={onFileClick}
            onDelete={onDelete}
            onRename={onRename}
            onSendToWizard={onSendToWizard}
            className="flex items-center gap-3 p-2 hover:bg-black/40 rounded"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {files.map((file) => (
        <FileCard
          key={file.relative_path || file.filename}
          file={file}
          viewMode="grid"
          selected={selectedPaths.has(file.relative_path || file.filename)}
          onSelect={onSelect ? (f) => onSelect(f) : undefined}
          onClick={onFileClick}
          onDelete={onDelete}
          onRename={onRename}
          onSendToWizard={onSendToWizard}
        />
      ))}
    </div>
  );
}
