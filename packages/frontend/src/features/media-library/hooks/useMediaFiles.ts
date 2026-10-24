import { useState, useEffect } from "react";
import { fetchWithTimeout } from "../../../services/fetchWithTimeout";

export interface MediaFile {
  filename: string;
  relative_path: string;
  file_type: string;
  size: number;
  modified_time: string;
  duration?: number;
  loudness?: number;
  waveform?: number[];
  analysis?: any;
  thumbnail?: string;
  recording?: boolean;
}

export interface FilterState {
  query: string;
  category: string | "all";
  fileType: string | "all";
  sortBy: "name" | "size" | "date";
  sortOrder: "asc" | "desc";
}

export function useMediaFiles() {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(50);

  const loadFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithTimeout(
        "/api/outputs",
        { timeout: 15000 }
      );
      if (!res.ok) throw new Error(`Failed to load files: ${res.status}`);
      const data = await res.json();
      const outputFiles = data.files || [];
      const mediaFiles: MediaFile[] = outputFiles.map((f: any) => ({
        filename: f.filename || f.relative_path || "unknown",
        relative_path: f.relative_path || "",
        file_type: f.file_type || "unknown",
        size: f.size || 0,
        modified_time: f.modified_time || f.modified_at || new Date().toISOString(),
        duration: f.duration,
        loudness: f.loudness,
        waveform: f.waveform,
        analysis: f.analysis,
        thumbnail: f.thumbnail,
        recording: f.recording || false,
      }));
      setFiles(mediaFiles);
      setTotalCount(mediaFiles.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load files");
      console.error("Error loading files:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles();
  }, []);


  return {
    files,
    loading,
    error,
    totalCount,
    currentPage,
    pageSizes: [50, 100, 200],
    pageSize,
    setCurrentPage,
    refetch: loadFiles,
  };
}
