import { useMemo } from "react";
import type { MediaFile, FilterState } from "./useMediaFiles";
import type { Tag } from "../../../services/api";

export function useFileFilters(
  files: MediaFile[],
  filter: FilterState,
  itemTags: Map<string, Tag[]>
) {
  return useMemo(() => {
    let filtered = [...files];

    // Filter by query — matches filename, relative_path, OR any tag name
    if (filter.query) {
      const query = filter.query.toLowerCase();
      filtered = filtered.filter((f) => {
        const key = f.relative_path || f.filename;
        const nameMatch =
          f.filename.toLowerCase().includes(query) ||
          (f.relative_path && f.relative_path.toLowerCase().includes(query));
        const tags = itemTags.get(key) ?? [];
        const tagMatch = tags.some((t) => t.name.toLowerCase().includes(query));
        return nameMatch || tagMatch;
      });
    }

    // Filter by file type (single combined filter)
    if (filter.fileType !== "all") {
      filtered = filtered.filter((f) => f.file_type === filter.fileType);
    }

    // Filter by tag
    if (filter.tagFilter) {
      filtered = filtered.filter((f) => {
        const key = f.relative_path || f.filename;
        const tags = itemTags.get(key) ?? [];
        return tags.some((t) => t.id === filter.tagFilter);
      });
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
  }, [files, filter, itemTags]);
}
