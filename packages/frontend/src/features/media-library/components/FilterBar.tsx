import { ChangeEvent } from "react";
import { Search, X, Tag as TagIcon } from "lucide-react";
import { DS } from "../../../styles/designSystem";
import type { Tag } from "../../../services/api";

export interface FilterState {
  query: string;
  fileType: string | "all";
  tagFilter: string | null;
  sortBy: "name" | "size" | "date";
  sortOrder: "asc" | "desc";
}

const FILE_TYPE_OPTIONS: Array<{ value: string; label: string; icon?: string }> = [
  { value: "all", label: "All Files" },
  { value: "audio", label: "Audio", icon: "🎵" },
  { value: "video", label: "Video", icon: "🎬" },
  { value: "image", label: "Image", icon: "🖼️" },
  { value: "other", label: "Other", icon: "📁" },
];

interface FilterBarProps {
  filter: FilterState;
  tags: Tag[];
  onChange: (filter: FilterState) => void;
  /** Hide the file-type filter chips (used when the page is already scoped to one type). */
  hideFileTypeFilter?: boolean;
}

export function FilterBar({ filter, tags, onChange, hideFileTypeFilter = false }: FilterBarProps) {
  const handleQueryChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...filter, query: e.target.value });
  };

  const handleFileTypeChange = (fileType: string) => {
    onChange({ ...filter, fileType, tagFilter: null });
  };

  const handleTagChange = (tagId: string | null) => {
    onChange({ ...filter, tagFilter: tagId, fileType: "all" });
  };

  const selectedTag = tags.find((t) => t.id === filter.tagFilter);

  return (
    <div className={`${DS.card} p-4 space-y-3`}>
      {/* Search */}
      <div className="flex items-center gap-2">
        <Search size={16} className="text-muted" />
        <input
          type="text"
          placeholder="Search files…"
          value={filter.query}
          onChange={handleQueryChange}
          className={`${DS.input} max-w-xs sm:max-w-md flex-1`}
        />
        {filter.query && (
          <button
            onClick={() => onChange({ ...filter, query: "" })}
            className="text-muted hover:text-white"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Tag filter */}
      <div className="flex items-center gap-2">
        <TagIcon size={16} className="text-muted" />
        <span className="text-xs text-muted">Tag:</span>
        <button
          onClick={() => handleTagChange(null)}
          className={`px-2.5 py-1 rounded-md text-sm font-medium ${
            !filter.tagFilter
              ? "bg-primary text-white border border-primary/50 shadow-sm"
              : "bg-black/40 text-muted border border-transparent hover:bg-black/50 hover:text-white"
          }`}
        >
          All
        </button>
        {tags.map((tag) => (
          <button
            key={tag.id}
            onClick={() => handleTagChange(tag.id)}
            className={`px-2.5 py-1 rounded-md text-sm font-medium ${
              filter.tagFilter === tag.id
                ? `bg-primary text-white border border-primary/50 shadow-sm`
                : "bg-black/40 text-muted border border-transparent hover:bg-black/50 hover:text-white"
            }`}
            style={{ borderColor: tag.color }}
            title={tag.name}
          >
            <span
              className="inline-block w-3 h-3 rounded-full mr-1"
              style={{ backgroundColor: tag.color }}
            />
            {tag.name}
          </button>
        ))}
      </div>

      {!hideFileTypeFilter && (
        // File type filter — single combined filter (Category + Type merged)
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Type:</span>
          {FILE_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleFileTypeChange(opt.value)}
              className={`px-2.5 py-1 rounded-md text-sm font-medium ${
                filter.fileType === opt.value
                  ? "bg-primary text-white border border-primary/50 shadow-sm"
                  : "bg-black/40 text-muted border border-transparent hover:bg-black/50 hover:text-white"
              }`}
              title={opt.label}
            >
              {opt.icon} {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Sort */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted uppercase tracking-wider">Sort:</span>
          <select
            value={filter.sortBy}
            onChange={(e) =>
              onChange({
                ...filter,
                sortBy: e.target.value as FilterState["sortBy"],
              })
            }
            className={DS.selectSm}
          >
            <option value="name">Name</option>
            <option value="date">Date Added</option>
            <option value="size">File Size</option>
          </select>
          <button
            onClick={() =>
              onChange({
                ...filter,
                sortOrder: filter.sortOrder === "asc" ? "desc" : "asc",
              })
            }
            className="text-xs text-muted hover:text-white"
          >
            {filter.sortOrder === "asc" ? "↑" : "↓"}
          </button>
        </div>
        <span className="text-sm font-medium text-foreground">
          {filter.query
            ? `Results for "${filter.query}"`
            : selectedTag
              ? `Tag: "${selectedTag.name}"`
              : `Total files`}
        </span>
      </div>
    </div>
  );
}
