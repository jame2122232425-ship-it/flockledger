import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  paginationMetadata,
  paginationRange,
  parsePagination,
} from "@/lib/api/pagination";

const querySchema = z.object({
  farmId: z.string().uuid(),
  status: z.enum(["running", "closed"]).optional(),
});

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination) return apiError("Provide valid page and pageSize values (1-100).", 400);
  const parsed = querySchema.safeParse({
    farmId: request.nextUrl.searchParams.get("farmId"),
    status: request.nextUrl.searchParams.get("status") ?? undefined,
  });
  if (!parsed.success) return apiError("Provide a valid farmId.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data: permissions, error: permissionsError } = await supabase.rpc(
      "get_my_farm_permissions",
      { p_farm_id: parsed.data.farmId },
    );
    if (permissionsError) {
      if (permissionsError.code === "42501") return apiError("Farm membership required.", 403);
      console.error("Failed to load dashboard permissions:", permissionsError.code);
      return apiError("Could not load dashboard.", 500);
    }
    const canViewFinance = (permissions ?? []).includes("finance.view");
    const { from, to } = paginationRange(pagination);
    let batchQuery = supabase
      .from("batch_performance")
      .select("*", { count: "exact" })
      .eq("farm_id", parsed.data.farmId)
      .order("date_placed", { ascending: false })
      .order("batch_id", { ascending: false });
    if (parsed.data.status) batchQuery = batchQuery.eq("status", parsed.data.status);

    const activeQuery = supabase
      .from("batch_performance")
      .select("*", { count: "exact" })
      .eq("farm_id", parsed.data.farmId)
      .eq("status", "running")
      .order("date_placed", { ascending: false })
      .order("batch_id", { ascending: false })
      .limit(4);
    const [batches, summary, active] = await Promise.all([
      batchQuery.range(from, to),
      supabase
        .from("farm_dashboard")
        .select("*")
        .eq("farm_id", parsed.data.farmId)
        .maybeSingle(),
      activeQuery,
    ]);

    if (batches.error || summary.error || active.error) {
      console.error(
        "Failed to load dashboard:",
        batches.error?.code ?? summary.error?.code ?? active.error?.code,
      );
      return apiError("Could not load dashboard.", 500);
    }
    const sanitizeOperationalBatch = (batch: NonNullable<typeof batches.data>[number]) => ({
      batch_id: batch.batch_id,
      batch_code: batch.batch_code,
      batch_type: batch.batch_type,
      status: batch.status,
      date_placed: batch.date_placed,
      date_sold_out: batch.date_sold_out,
      chicks_received: batch.chicks_received,
      dead: batch.dead,
      culled: batch.culled,
      birds_sold: batch.birds_sold,
      live_weight_sold_kg: batch.live_weight_sold_kg,
      avg_live_weight_sold_kg: batch.avg_live_weight_sold_kg,
      feed_consumed_kg: batch.feed_consumed_kg,
      mortality_percent: batch.mortality_percent,
      livability_percent: batch.livability_percent,
      age_days: batch.age_days,
      epef: batch.epef,
      fcr: batch.fcr,
    });
    const allBatchCount = Number(summary.data?.batches_recorded ?? 0);
    const activeBatchCount = active.count ?? 0;
    const dashboardSummary = summary.data && !canViewFinance
      ? {
        ...summary.data,
        opening_cash_balance_kes: undefined,
        revenue_kes: undefined,
        total_expenses_kes: undefined,
        tagged_batch_profit_kes: undefined,
        untagged_expenses_kes: undefined,
        accounts_receivable_kes: undefined,
        cash_balance_kes: undefined,
      }
      : summary.data;
    return NextResponse.json({
      data: canViewFinance ? batches.data : (batches.data ?? []).map(sanitizeOperationalBatch),
      summary: dashboardSummary,
      activeBatches: canViewFinance ? active.data : (active.data ?? []).map(sanitizeOperationalBatch),
      activeBatchCount,
      batchCounts: {
        all: allBatchCount,
        running: activeBatchCount,
        closed: Math.max(allBatchCount - activeBatchCount, 0),
      },
      pagination: paginationMetadata(batches.count ?? 0, pagination),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected dashboard error:", error);
    return apiError("Could not load dashboard.", 500);
  }
}
