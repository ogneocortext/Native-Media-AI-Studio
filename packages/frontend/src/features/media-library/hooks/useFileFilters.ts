import { useMemo } from "react";
import type { MediaFile, FilterState } from "./useMediaFiles";

export function useFileFilters(files: MediaFile[], filter: FilterState) {
  return useMemo(() => {
    let filtered = [...files];

    // Filter by query
    if (filter.query) {
      const query = filter.query.toLowerCase();
      filtered = filtered.filter(
        (f) =>
          f.filename.toLowerCase().includes(query) ||
          (f.relative_path && f.relative_path.toLowerCase().includes(query))
      );
    }

    // Filter by category
    if (filter.category !== "all") {
      const categoryMap: Record<string, string> = {
        audio: "audio",
        video: "video",
        image: "image",
        model: "model",
        doc: "document",
        other: "other",
      };
      filtered = filtered.filter((f) => {
        const ext = f.file_type.split(".").pop()?.toLowerCase() || "";
        const cat = f.file_type.split("/").pop()?.toLowerCase() || "";
        const type = categoryMap[cat] || ext;
        return type === filter.category;
      });
    }

    // Filter by file type
    if (filter.fileType !== "all") {
      filtered = filtered.filter((f) => f.file_type === filter.fileType);
    }

    // Sort
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (filter.sortBy) {
        case "name":
          comparison = a.filename.localeCompare(b.filename);
          break;
        case "size":
          comparison = (a.size_bytes ?? a.size ?? 0) - (b.size_bytes ?? b.size ?? 0);
          break;
        case "date":
          comparison =
            new Date(a.modified_at ?? a.modified_time ?? "").getTime() -
            new Date(b.modified_at ?? b.modified_time ?? "").getTime();
          break;
      }
      return filter.sortOrder === "asc" ? comparison : -comparison;
    });

    return filtered;
  }, [files, filter]);
}
