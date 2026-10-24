import { FileCard } from "./FileCard";
import type { MediaFile } from "../hooks/useMediaFiles";

interface FileGridProps {
  files: MediaFile[];
  onFileClick: (file: MediaFile) => void;
  onDelete?: (file: MediaFile) => void;
  onRename?: (file: MediaFile) => void;
}

export function FileGrid({
  files,
  onFileClick,
  onDelete,
  onRename,
}: FileGridProps) {
  if (files.length === 0) {
    return (
      <div className="text-center py-8 text-muted">
        No files found matching your criteria
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {files.map((file) => (
        <FileCard
          key={file.relative_path || file.filename}
          file={file}
          onClick={onFileClick}
          onDelete={onDelete}
          onRename={onRename}
        />
      ))}
    </div>
  );
}
