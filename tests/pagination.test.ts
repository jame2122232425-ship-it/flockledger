import { describe, expect, it } from "vitest";
import {
  paginationMetadata,
  paginationRange,
  parsePagination,
} from "../src/lib/api/pagination";

describe("API pagination", () => {
  it("uses a bounded default page and computes a zero-based range", () => {
    const pagination = parsePagination(new URLSearchParams());

    expect(pagination).toEqual({ page: 1, pageSize: 50 });
    expect(paginationRange(pagination!)).toEqual({ from: 0, to: 49 });
  });

  it("rejects out-of-range values and reports whether another page exists", () => {
    expect(parsePagination(new URLSearchParams("page=0"))).toBeNull();
    expect(parsePagination(new URLSearchParams("page=1000001"))).toBeNull();
    expect(parsePagination(new URLSearchParams("pageSize=101"))).toBeNull();

    const pagination = parsePagination(new URLSearchParams("page=2&pageSize=10"));
    expect(pagination).not.toBeNull();
    expect(paginationMetadata(21, pagination!)).toEqual({
      page: 2,
      pageSize: 10,
      total: 21,
      pageCount: 3,
      hasMore: true,
    });
  });
});
