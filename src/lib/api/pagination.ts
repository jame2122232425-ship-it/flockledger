import { z } from "zod";

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type Pagination = z.infer<typeof paginationSchema>;

export type PageMetadata = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  hasMore: boolean;
  nextCursor?: {
    saleDate: string;
    createdAt: string;
    id: string;
  } | null;
};

export function parsePagination(searchParams: URLSearchParams) {
  const parsed = paginationSchema.safeParse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  });
  return parsed.success ? parsed.data : null;
}

export function paginationRange(pagination: Pagination) {
  const from = (pagination.page - 1) * pagination.pageSize;
  return { from, to: from + pagination.pageSize - 1 };
}

export function paginationMetadata(total: number, pagination: Pagination) {
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    pageCount: Math.ceil(total / pagination.pageSize),
    hasMore: pagination.page * pagination.pageSize < total,
  };
}
