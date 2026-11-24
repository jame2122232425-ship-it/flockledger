import type { PageMetadata } from "@/lib/api/pagination";

export function PaginationControls({
  pagination,
  onPageChange,
  onNextPage,
}: {
  pagination: PageMetadata;
  onPageChange: (page: number) => void;
  onNextPage?: () => void;
}) {
  if (pagination.pageCount <= 1) return null;
  return (
    <nav className="pagination-controls" aria-label="Pagination">
      <button
        type="button"
        className="button button-quiet"
        disabled={pagination.page <= 1}
        onClick={() => onPageChange(pagination.page - 1)}
      >
        Previous
      </button>
      <span>
        Page {pagination.page} of {pagination.pageCount} · {pagination.total} records
      </span>
      <button
        type="button"
        className="button button-quiet"
        disabled={!pagination.hasMore}
        onClick={onNextPage ?? (() => onPageChange(pagination.page + 1))}
      >
        Next
      </button>
    </nav>
  );
}
