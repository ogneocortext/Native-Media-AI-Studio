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
    [totalPages, onPageChange]
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

  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-white/10">
      <div className="text-xs text-muted">
        {((currentPage - 1) * pageSize) + 1}-
        {Math.min(currentPage * pageSize, totalCount)} of {totalCount}
      </div>
      <div className="flex gap-2">
        <button
          onClick={goToPrev}
          disabled={currentPage <= 1}
          className="px-2 py-1 text-xs bg-black/30 hover:bg-black/50 rounded disabled:opacity-50"
        >
          Previous
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
          <button
            key={page}
            onClick={() => goToPage(page)}
            className={`px-2 py-1 text-xs rounded ${
              page === currentPage
                ? "bg-primary/20 text-primary"
                : "bg-black/30 hover:bg-black/50"
            }`}
          >
            {page}
          </button>
        ))}
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
