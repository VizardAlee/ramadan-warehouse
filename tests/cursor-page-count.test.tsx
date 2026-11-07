// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CursorTablePagination } from "@/components/ui/table-pagination";

afterEach(cleanup);
const props = { page: 4, pageSize: 25, rowCount: 5, total: 80, hasNextPage: false, onPrevious: vi.fn(), onNext: vi.fn(), onPageSizeChange: vi.fn(), itemLabel: "inventory positions" };
describe("cursor pagination total pages", () => {
  it("shows the final page and total without changing cursor navigation", () => {
    render(<CursorTablePagination {...props} />);
    expect(screen.getByText("Page 4 of 4")).toBeTruthy();
    expect(screen.getByText("76–80 of 80 inventory positions")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Previous" })).toHaveProperty("disabled", false);
  });
  it("recalculates for page size and filtered totals, including empty results", () => {
    const view = render(<CursorTablePagination {...props} page={1} pageSize={50} rowCount={50} hasNextPage />);
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    view.rerender(<CursorTablePagination {...props} page={1} total={3} rowCount={3} />);
    expect(screen.getByText("Page 1 of 1")).toBeTruthy();
    view.rerender(<CursorTablePagination {...props} page={1} total={0} rowCount={0} />);
    expect(screen.getByText("Page 1 of 1")).toBeTruthy();
    expect(screen.getByText("0 inventory positions")).toBeTruthy();
  });
  it("does not invent unknown totals or show stale page counts while loading", () => {
    const view = render(<CursorTablePagination {...props} total={undefined} />);
    expect(screen.getByText("Page 4")).toBeTruthy();
    view.rerender(<CursorTablePagination {...props} loading />);
    expect(screen.getByText("Page 4")).toBeTruthy();
    expect(screen.queryByText("Page 4 of 4")).toBeNull();
  });
});
