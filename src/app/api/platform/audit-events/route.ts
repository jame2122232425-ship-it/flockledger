import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { paginationMetadata } from "@/lib/api/pagination";
import { auditCsv } from "@/lib/audit/csv";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const platformEventSchema = z.object({
  id: z.number().int().nonnegative(),
  actor_user_id: z.string().uuid().nullable(),
  event_type: z.string(),
  application_id: z.string().uuid().nullable(),
  farm_id: z.string().uuid().nullable(),
  reason: z.string().nullable(),
  details: z.unknown(),
  request_id: z.string().nullable(),
  occurred_at: z.iso.datetime({ offset: true }),
});
const platformPageSchema = z.object({
  data: z.array(platformEventSchema),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const isExport = params.get("export") === "csv";
  const page = Number(params.get("page") ?? "1");
  const pageSize = isExport ? 1000 : Number(params.get("pageSize") ?? "25");
  if (!Number.isInteger(page) || page < 1
    || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > (isExport ? 1000 : 100)) {
    return apiError("Provide valid pagination.", 400);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data, error } = await supabase.rpc("get_platform_audit_page", {
      p_page_size: pageSize,
      p_page_offset: isExport ? 0 : (page - 1) * pageSize,
      p_is_export: isExport,
      p_request_id: request.headers.get("x-request-id")?.slice(0, 128) ?? null,
    });
    if (error) {
      if (error.code === "42501") return apiError("Platform administrator permission required.", 403);
      if (error.code === "22023") return apiError("The audit filters are invalid.", 400);
      console.error("Failed to load platform audit events:", error.code);
      return apiError("Could not load platform audit events.", 500);
    }
    const result = platformPageSchema.safeParse(data);
    if (!result.success) {
      console.error("Platform audit RPC returned an invalid shape.");
      return apiError("Could not load platform audit events.", 500);
    }
    if (isExport) {
      if (result.data.hasMore) {
        return NextResponse.json(
          { error: "This export exceeds 1,000 rows. Narrow the date range and try again." },
          { status: 413, headers: { "Cache-Control": "private, no-store" } },
        );
      }
      return new NextResponse(auditCsv(result.data.data, "platform"), {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="flockledger-platform-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
          "Content-Type": "text/csv; charset=utf-8",
        },
      });
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
    console.error("Unexpected platform audit error:", error);
    return apiError("Could not load platform audit events.", 500);
  }
}
