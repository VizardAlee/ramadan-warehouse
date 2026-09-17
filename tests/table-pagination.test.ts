import { describe, expect, it } from "vitest";
import { paginateRows, tablePageSizes } from "@/components/ui/table-pagination";

describe("table pagination", () => {
  const rows = Array.from({ length: 63 }, (_, index) => index + 1);

  it("offers the approved page sizes", () => {
    expect(tablePageSizes).toEqual([25, 50, 100]);
  });

  it("returns the requested page and visible range", () => {
    expect(paginateRows(rows, 2, 25)).toEqual({
      page: 2,
      pageCount: 3,
      rows: rows.slice(25, 50),
      start: 26,
      end: 50,
    });
  });

  it("clamps a stale page after filters reduce the result", () => {
    expect(paginateRows(rows.slice(0, 12), 4, 25)).toEqual({
      page: 1,
      pageCount: 1,
      rows: rows.slice(0, 12),
      start: 1,
      end: 12,
    });
  });

  it("reports an empty result without inventing a row range", () => {
    expect(paginateRows([], 1, 25)).toMatchObject({
      page: 1,
      pageCount: 1,
      rows: [],
      start: 0,
      end: 0,
    });
  });
});
