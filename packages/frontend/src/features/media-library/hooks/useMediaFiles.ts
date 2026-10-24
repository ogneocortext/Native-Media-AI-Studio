import { useState, useEffect } from "react";
import { fetchWithTimeout } from "../../../services/fetchWithTimeout";

export interface MediaFile {
  filename: string;
  path: string;
  relative_path: string;
  file_type: string; // "audio" | "video" | "image" | "3d" | ...
  size_bytes: number;
  created_at: string;
  modified_at: string | null;
  cover_image: string | null;
  has_cover: boolean;
  metadata: any;
  job_id: string | null;
  size?: number; // backward-compat alias for size_bytes
  modified_time?: string; // backward-compat alias for modified_at
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
      const outputFiles: MediaFile[] = data.outputs || [];
      const mediaFiles: MediaFile[] = outputFiles.map((f) => ({
        filename: f.filename || f.relative_path || "unknown",
        path: f.path || "",
        relative_path: f.relative_path || "",
        file_type: f.file_type || "unknown",
        size_bytes: f.size_bytes ?? f.size ?? 0,
        created_at: f.created_at || new Date().toISOString(),
        modified_at: f.modified_at || f.modified_time || null,
        cover_image: f.cover_image ?? null,
        has_cover: f.has_cover ?? false,
        metadata: f.metadata ?? null,
        job_id: f.job_id ?? null,
        size: f.size_bytes ?? f.size ?? 0,
        modified_time: f.modified_at || f.modified_time || undefined,
        duration: f.duration,
        loudness: f.loudness,
        waveform: f.waveform,
        analysis: f.analysis,
        thumbnail: f.thumbnail,
        recording: f.recording || false,
      }));
      setFiles(mediaFiles);
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
    refetch: loadFiles,
  };
}
