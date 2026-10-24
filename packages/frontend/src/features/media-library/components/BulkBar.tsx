/**
 * BulkBar — appears when one or more items are selected.
 * Shows "N selected — Clear / Delete Selected" → POST /api/outputs/bulk-delete.
 */
import { useCallback } from "react";
import { X, Trash2 } from "lucide-react";

interface BulkBarProps {
  selectedCount: number;
  onClear: () => void;
  onDeleteSelected: () => void;
  isDeleting: boolean;
}

export function BulkBar({
  selectedCount,
  onClear,
  onDeleteSelected,
  isDeleting,
}: BulkBarProps) {
  const handleDelete = useCallback(() => {
    onDeleteSelected();
  }, [onDeleteSelected]);

  return (
    <div
      className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 flex items-center gap-3 animate-in slide-in-from-bottom"
    >
      <Trash2 size={16} className="text-yellow-400 shrink-0" />
      <span className="text-sm font-medium text-yellow-200">
        {selectedCount} selected
      </span>
      <button
        onClick={onClear}
        className="text-xs text-yellow-300 underline underline-offset-4 hover:text-white ml-auto"
      >
        Clear
      </button>
      <button
        onClick={handleDelete}
        disabled={isDeleting}
        className="px-3 py-1 text-xs bg-yellow-600 hover:bg-yellow-500 rounded text-yellow-100 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isDeleting ? (
          <span className="flex items-center gap-1">
            <X size={12} className="animate-spin" />
            Deleting…
          </span>
        ) : (
          <>
            <Trash2 size={12} /> Delete Selected
          </>
        )}
      </button>
    </div>
  );
}
