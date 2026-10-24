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

    // Filter by file type (single combined filter)
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
