import { ChangeEvent } from "react";
import { Search, X } from "lucide-react";
import { DS } from "../../../styles/designSystem";

export interface FilterState {
  query: string;
  category: string | "all";
  fileType: string | "all";
  sortBy: "name" | "size" | "date";
  sortOrder: "asc" | "desc";
}

interface FilterBarProps {
  filter: FilterState;
  onChange: (filter: FilterState) => void;
}

export function FilterBar({ filter, onChange }: FilterBarProps) {
  const handleQueryChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...filter, query: e.target.value });
  };

  const handleCategoryChange = (category: string) => {
    onChange({ ...filter, category });
  };

  const handleFileTypeChange = (fileType: string) => {
    onChange({ ...filter, fileType });
  };

  return (
    <div className={`${DS.card} p-4 space-y-3`}>
      <div className="flex items-center gap-2">
        <Search size={16} className="text-muted" />
        <input
          type="text"
          placeholder="Search files..."
          value={filter.query}
          onChange={handleQueryChange}
          className={`${DS.input} flex-1`}
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

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-muted">Category:</span>
        {[
          { value: "all", label: "All Files" },
          { value: "image", label: "Images" },
          { value: "video", label: "Videos" },
          { value: "audio", label: "Audio" },
          { value: "model", label: "Models" },
          { value: "document", label: "Documents" },
          { value: "other", label: "Other" },
        ].map((cat) => (
          <button
            key={cat.value}
            onClick={() => handleCategoryChange(cat.value)}
            className={`px-2 py-1 rounded text-xs ${
              filter.category === cat.value
                ? "bg-primary/20 text-primary border border-primary/30"
                : "bg-black/30 text-muted hover:bg-black/50 border border-transparent"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-muted">Type:</span>
        {[
          { value: "all", label: "All" },
          { value: "audio", label: "Audio" },
          { value: "video", label: "Video" },
          { value: "image", label: "Image" },
        ].map((type) => (
          <button
            key={type.value}
            onClick={() => handleFileTypeChange(type.value)}
            className={`px-2 py-1 rounded text-xs ${
              filter.fileType === type.value
                ? "bg-primary/20 text-primary border border-primary/30"
                : "bg-black/30 text-muted hover:bg-black/50 border border-transparent"
            }`}
          >
            {type.label}
          </button>
        ))}
      </div>

      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Sort:</span>
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
            <option value="size">Size</option>
            <option value="date">Date</option>
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
        <span className="text-xs text-muted">
          {filter.query ? `Results for "${filter.query}"` : "Total files"}
        </span>
      </div>
    </div>
  );
}
