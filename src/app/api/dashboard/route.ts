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

const BATCH_FIELDS =
  "batch_id, batch_code, batch_type, status, date_placed, date_sold_out, chicks_received, dead, culled, birds_sold, live_weight_sold_kg, avg_live_weight_sold_kg, feed_consumed_kg, revenue_kes, paid_kes, outstanding_kes, total_cost_kes, cost_per_bird_sold_kes, cost_per_kg_sold_kes, profit_kes, profit_per_bird_sold_kes, mortality_percent, livability_percent, age_days, epef, cash_in_kes, cash_out_kes, fcr";

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

    const { from, to } = paginationRange(pagination);
    let batchQuery = supabase
      .from("batch_performance")
      .select(BATCH_FIELDS, { count: "exact" })
      .eq("farm_id", parsed.data.farmId)
      .order("date_placed", { ascending: false })
      .order("batch_id", { ascending: false });
    if (parsed.data.status) batchQuery = batchQuery.eq("status", parsed.data.status);

    const activeQuery = supabase
      .from("batch_performance")
      .select(BATCH_FIELDS, { count: "exact" })
      .eq("farm_id", parsed.data.farmId)
      .eq("status", "running")
      .order("date_placed", { ascending: false })
      .order("batch_id", { ascending: false })
      .limit(4);
    const [batches, summary, active] = await Promise.all([
      batchQuery.range(from, to),
      supabase
        .from("farm_dashboard")
        .select("farm_id, farm_name, currency, timezone, opening_cash_balance_kes, batches_recorded, birds_placed, revenue_kes, total_expenses_kes, tagged_batch_profit_kes, untagged_expenses_kes, feed_stock_on_hand_kg, accounts_receivable_kes, cash_balance_kes")
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
    const allBatchCount = Number(summary.data?.batches_recorded ?? 0);
    const activeBatchCount = active.count ?? 0;
    return NextResponse.json({
      data: batches.data,
      summary: summary.data,
      activeBatches: active.data,
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
