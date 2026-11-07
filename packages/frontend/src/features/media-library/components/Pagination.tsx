import { useCallback } from "react";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  totalCount: number;
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  pageSize,
  totalCount,
}: PaginationProps) {
  const goToPage = useCallback(
    (page: number) => {
      if (page >= 1 && page <= totalPages) {
        onPageChange(page);
      }
    },
    [totalPages, onPageChange],
  );

  const goToNext = useCallback(() => {
    if (currentPage < totalPages) {
      goToPage(currentPage + 1);
    }
  }, [currentPage, totalPages, goToPage]);

  const goToPrev = useCallback(() => {
    if (currentPage > 1) {
      goToPage(currentPage - 1);
    }
  }, [currentPage, goToPage]);

  if (totalPages <= 1) return null;

  // Window the page list so large libraries don't render hundreds of buttons.
  const DELTA = 2;
  const pageItems: (number | "ellipsis")[] = [];
  if (totalPages <= 7) {
    for (let p = 1; p <= totalPages; p++) pageItems.push(p);
  } else {
    pageItems.push(1);
    const start = Math.max(2, currentPage - DELTA);
    const end = Math.min(totalPages - 1, currentPage + DELTA);
    if (start > 2) pageItems.push("ellipsis");
    for (let p = start; p <= end; p++) pageItems.push(p);
    if (end < totalPages - 1) pageItems.push("ellipsis");
    pageItems.push(totalPages);
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-2 border-t border-white/10">
      <div className="text-xs text-muted shrink-0">
        {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, totalCount)} of{" "}
        {totalCount}
      </div>
      <div className="flex flex-wrap gap-1 overflow-x-auto pb-2">
        <button
          onClick={goToPrev}
          disabled={currentPage <= 1}
          className="px-2 py-1 text-xs bg-black/30 hover:bg-black/50 rounded disabled:opacity-50"
        >
          Previous
        </button>
        {pageItems.map((page, i) =>
          page === "ellipsis" ? (
            <span key={`e${i}`} className="px-2 py-1 text-xs text-muted">
              …
            </span>
          ) : (
            <button
              key={page}
              onClick={() => goToPage(page)}
              className={`px-2 py-1 text-xs rounded ${
                page === currentPage ? "bg-primary/20 text-primary" : "bg-black/30 hover:bg-black/50"
              }`}
            >
              {page}
            </button>
          ),
        )}
        <button
          onClick={goToNext}
          disabled={currentPage >= totalPages}
          className="px-2 py-1 text-xs bg-black/30 hover:bg-black/50 rounded disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
