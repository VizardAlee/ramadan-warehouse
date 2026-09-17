"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

export const tablePageSizes = [25, 50, 100] as const;

export function paginateRows<T>(rows: readonly T[], page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * pageSize;
  return {
    page: safePage,
    pageCount,
    rows: rows.slice(start, start + pageSize),
    start: rows.length === 0 ? 0 : start + 1,
    end: Math.min(start + pageSize, rows.length),
  };
}

export function useTablePagination<T>(rows: readonly T[], initialPageSize = 25) {
  const [requestedPage, setRequestedPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const result = useMemo(
    () => paginateRows(rows, requestedPage, pageSize),
    [pageSize, requestedPage, rows],
  );

  function setPageSize(value: number) {
    setPageSizeState(value);
    setRequestedPage(1);
  }

  return {
    ...result,
    pageSize,
    setPage: (value: number) => setRequestedPage(value),
    setPageSize,
  };
}

export function TablePagination({
  page,
  pageCount,
  pageSize,
  start,
  end,
  total,
  onPageChange,
  onPageSizeChange,
  itemLabel = "records",
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  start: number;
  end: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  itemLabel?: string;
}) {
  return (
    <nav
      aria-label={`Paginate ${itemLabel}`}
      className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white px-3 py-2.5 text-sm"
    >
      <div className="flex items-center gap-2">
        <label htmlFor={`page-size-${itemLabel.replaceAll(" ", "-")}`} className="text-[var(--muted)]">
          Rows per page
        </label>
        <select
          id={`page-size-${itemLabel.replaceAll(" ", "-")}`}
          className="min-h-9 rounded-lg border px-2 py-1"
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {tablePageSizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>
      <p aria-live="polite" className="text-[var(--muted)]">
        {total === 0 ? `0 ${itemLabel}` : `${start}–${end} of ${total} ${itemLabel}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
          <span className="hidden sm:inline">Previous</span>
        </Button>
        <span className="min-w-20 text-center">
          Page {page} of {pageCount}
        </span>
        <Button
          type="button"
          variant="secondary"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </nav>
  );
}

export function PaginatedTableControls<T>({
  pagination,
  total,
  itemLabel,
}: {
  pagination: ReturnType<typeof useTablePagination<T>>;
  total: number;
  itemLabel?: string;
}) {
  return (
    <TablePagination
      page={pagination.page}
      pageCount={pagination.pageCount}
      pageSize={pagination.pageSize}
      start={pagination.start}
      end={pagination.end}
      total={total}
      onPageChange={pagination.setPage}
      onPageSizeChange={pagination.setPageSize}
      itemLabel={itemLabel}
    />
  );
}

export function CursorTablePagination({
  page,
  pageSize,
  rowCount,
  hasNextPage,
  loading = false,
  onPrevious,
  onNext,
  onPageSizeChange,
  itemLabel = "records",
}: {
  page: number;
  pageSize: number;
  rowCount: number;
  hasNextPage: boolean;
  loading?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPageSizeChange: (pageSize: number) => void;
  itemLabel?: string;
}) {
  const start = rowCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = rowCount === 0 ? 0 : start + rowCount - 1;
  return (
    <nav
      aria-label={`Paginate ${itemLabel}`}
      className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white px-3 py-2.5 text-sm"
    >
      <div className="flex items-center gap-2">
        <label htmlFor={`cursor-page-size-${itemLabel.replaceAll(" ", "-")}`} className="text-[var(--muted)]">
          Rows per page
        </label>
        <select
          id={`cursor-page-size-${itemLabel.replaceAll(" ", "-")}`}
          className="min-h-9 rounded-lg border px-2 py-1"
          value={pageSize}
          disabled={loading}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {tablePageSizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>
      <p aria-live="polite" className="text-[var(--muted)]">
        {rowCount === 0 ? `0 ${itemLabel}` : `${start}–${end} ${itemLabel}`}
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" disabled={loading || page <= 1} onClick={onPrevious}>
          <ChevronLeft className="size-4" />
          <span className="hidden sm:inline">Previous</span>
        </Button>
        <span className="min-w-16 text-center">Page {page}</span>
        <Button type="button" variant="secondary" disabled={loading || !hasNextPage} onClick={onNext}>
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </nav>
  );
}
