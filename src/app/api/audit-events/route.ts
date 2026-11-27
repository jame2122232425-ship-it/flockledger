import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { paginationMetadata } from "@/lib/api/pagination";
import { auditCsv } from "@/lib/audit/csv";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const categorySchema = z.enum(["all", "operational", "financial", "inventory"]);
const auditEventSchema = z.object({
  id: z.number().int().nonnegative(),
  farm_id: z.string().uuid(),
  table_name: z.string(),
  record_id: z.string().uuid(),
  operation: z.enum(["INSERT", "UPDATE", "DELETE"]),
  actor_id: z.string().uuid().nullable(),
  old_data: z.unknown().nullable(),
  new_data: z.unknown().nullable(),
  occurred_at: z.iso.datetime({ offset: true }),
});
const auditPageSchema = z.object({
  data: z.array(auditEventSchema),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

function parseBound(value: string | null) {
  if (!value) return { success: true as const, data: null };
  const parsed = z.iso.datetime({ offset: true }).safeParse(value);
  return parsed.success
    ? { success: true as const, data: parsed.data }
    : { success: false as const };
}

function csvResponse(data: Array<Record<string, unknown>>) {
  return new NextResponse(auditCsv(data), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="flockledger-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const farmId = z.string().uuid().safeParse(params.get("farmId"));
  const category = categorySchema.safeParse(params.get("category") ?? "all");
  const from = parseBound(params.get("from"));
  const to = parseBound(params.get("to"));
  const isExport = params.get("export") === "csv";
  const page = Number(params.get("page") ?? "1");
  const pageSize = isExport ? 1000 : Number(params.get("pageSize") ?? "25");
  if (!farmId.success || !category.success || !from.success || !to.success
    || (from.data && to.data && new Date(from.data).getTime() > new Date(to.data).getTime())
    || !Number.isInteger(page) || page < 1
    || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > (isExport ? 1000 : 100)) {
    return apiError("Provide valid audit filters and pagination.", 400);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data, error } = await supabase.rpc("get_farm_audit_page", {
      p_farm_id: farmId.data,
      p_category: category.data,
      p_from: from.data,
      p_to: to.data,
      p_page_size: pageSize,
      p_page_offset: isExport ? 0 : (page - 1) * pageSize,
      p_is_export: isExport,
      p_request_id: request.headers.get("x-request-id")?.slice(0, 128) ?? null,
    });
    if (error) {
      if (error.code === "42501") return apiError("You cannot view this audit category.", 403);
      if (error.code === "22023") return apiError("The audit filters are invalid.", 400);
      console.error("Failed to load farm audit events:", error.code);
      return apiError("Could not load audit events.", 500);
    }
    const result = auditPageSchema.safeParse(data);
    if (!result.success) {
      console.error("Farm audit RPC returned an invalid shape.");
      return apiError("Could not load audit events.", 500);
    }
    if (isExport) {
      if (result.data.hasMore) {
        return NextResponse.json(
          { error: "This export exceeds 1,000 rows. Narrow the date range and try again." },
          { status: 413, headers: { "Cache-Control": "private, no-store" } },
        );
      }
      return csvResponse(result.data.data);
    }

    return NextResponse.json({
      data: result.data.data,
      pagination: paginationMetadata(result.data.total, { page, pageSize }),
      hasMore: result.data.hasMore,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected farm audit error:", error);
    return apiError("Could not load audit events.", 500);
  }
}
