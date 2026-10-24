import { useState } from "react";
import { useMediaFiles } from "./hooks/useMediaFiles";
import { useFileFilters } from "./hooks/useFileFilters";
import { useFileOperations } from "./hooks/useFileOperations";
import { FileCard } from "./components/FileCard";
import { FilterBar } from "./components/FilterBar";
import { Pagination } from "./components/Pagination";
import { FileGrid } from "./components/FileGrid";
import { getFileIcon } from "./utils/fileHelpers";
import { formatFileSize, formatDateTime } from "../../utils/format";

export function MediaLibrary() {
  const { files: allFiles, loading, error } = useMediaFiles();
  const [filter, setFilter] = useState<any>({
    query: "",
    category: "all",
    fileType: "all",
    sortBy: "name",
    sortOrder: "asc",
    currentPage: 1,
  });
  const filteredFiles = useFileFilters(allFiles, filter);
  const { handleDelete, handleRename, handleProbe } =
    useFileOperations();
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [detailOpen, setDetailOpen] = useState(false);

  const pageSize = 50;
  const totalPages = Math.ceil(filteredFiles.length / pageSize) || 1;
  const startIndex = ((filter.currentPage || 1) - 1) * pageSize;
  const paginatedFiles = filteredFiles.slice(startIndex, startIndex + pageSize);

  const handleFileClick = (file: any) => {
    setSelectedFile(file);
    setDetailOpen(true);
  };

  return (
    <div>
      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 rounded p-4 mb-4">
          {error}
        </div>
      )}
      <div className="space-y-3">
        <FilterBar filter={filter} onChange={setFilter} />
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode("grid")}
            className={`px-3 py-1 text-sm rounded ${
              viewMode === "grid" ? "bg-primary/20 text-primary" : "bg-black/30 text-muted"
            }`}
          >
            Grid
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`px-3 py-1 text-sm rounded ${
              viewMode === "list" ? "bg-primary/20 text-primary" : "bg-black/30 text-muted"
            }`}
          >
            List
          </button>
        </div>
        {loading ? (
          <div className="text-center py-8 text-muted">Loading files...</div>
        ) : viewMode === "grid" ? (
          <FileGrid
            files={paginatedFiles}
            onFileClick={handleFileClick}
            onDelete={(file) => handleDelete(file.filename, file.relative_path)}
            onRename={(file) => handleRename(file.filename, file.relative_path, file.filename)}
          />
        ) : (
          <div className="space-y-2">
            {paginatedFiles.map((file: any) => (
              <FileCard
                key={file.relative_path || file.filename}
                file={file}
                onClick={handleFileClick}
                onDelete={(file) => handleDelete(file.filename, file.relative_path)}
                onRename={(file) => handleRename(file.filename, file.relative_path, file.filename)}
              />
            ))}
          </div>
        )}
        <Pagination
          currentPage={filter.currentPage || 1}
          totalPages={totalPages}
          onPageChange={(page) => setFilter({ ...filter, currentPage: page })}
          pageSize={pageSize}
          totalCount={filteredFiles.length}
        />
      </div>
      {detailOpen && selectedFile && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-black/90 border border-white/10 rounded-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-3xl">{getFileIcon(selectedFile.file_type)}</span>
                <h3 className="text-lg font-semibold text-white">{selectedFile.filename}</h3>
              </div>
              <button
                onClick={() => {
                  setDetailOpen(false);
                  setSelectedFile(null);
                }}
                className="text-muted hover:text-white"
              >
                X
              </button>
            </div>
            <div className="space-y-2 text-sm text-muted">
              <p>File Type: {selectedFile.file_type}</p>
              <p>Size: {formatFileSize(selectedFile.size)}</p>
              <p>Modified: {formatDateTime(selectedFile.modified_time)}</p>
              <p>Duration: {selectedFile.duration ? selectedFile.duration + "s" : "N/A"}</p>
              {selectedFile.analysis && (
                <p className="text-green-400">Analysis: Available</p>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => {
                  handleProbe(selectedFile.filename);
                  setDetailOpen(false);
                  setSelectedFile(null);
                }}
                className="px-3 py-1 text-sm bg-primary/20 text-primary rounded"
              >
                Probe
              </button>
              <button
                onClick={() => {
                  setDetailOpen(false);
                  setSelectedFile(null);
                }}
                className="px-3 py-1 text-sm bg-black/30 text-muted rounded"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

