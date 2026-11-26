import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ batchId: string }> };

const batchFields =
  "id, farm_id, batch_code, batch_type, rearing_system, house, date_placed, source, strain, chicks_ordered, chicks_received, date_sold_out, status, remarks, created_at, updated_at";

const performanceFields =
  "batch_id, live_weight_sold_kg, avg_live_weight_sold_kg, total_cost_kes, cost_per_bird_sold_kes, cost_per_kg_sold_kes, profit_kes, profit_per_bird_sold_kes, mortality_percent, livability_percent, age_days, epef, cash_in_kes, cash_out_kes, feed_consumed_kg, revenue_kes, paid_kes, outstanding_kes, birds_sold, dead, culled, fcr";

export async function GET(request: NextRequest, context: RouteContext) {
  const { batchId } = await context.params;
  const parsedBatchId = z.string().uuid().safeParse(batchId);
  const parsedFarmId = z.string().uuid().safeParse(request.nextUrl.searchParams.get("farmId"));
  if (!parsedBatchId.success || !parsedFarmId.success) {
    return apiError("Provide valid batch and farm IDs.", 400);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const [batchResult, performanceResult] = await Promise.all([
      supabase.from("batches")
        .select(batchFields)
        .eq("id", parsedBatchId.data)
        .eq("farm_id", parsedFarmId.data)
        .maybeSingle(),
      supabase.from("batch_performance")
        .select(performanceFields)
        .eq("batch_id", parsedBatchId.data)
        .eq("farm_id", parsedFarmId.data)
        .maybeSingle(),
    ]);

    if (batchResult.error || performanceResult.error) {
      console.error(
        "Failed to load batch details:",
        batchResult.error?.code ?? performanceResult.error?.code,
      );
      return apiError("Could not load batch details.", 500);
    }
    if (!batchResult.data) return apiError("Batch not found.", 404);
    if (!performanceResult.data) {
      console.error("Batch performance view returned no row for an existing batch.");
      return apiError("Could not load batch details.", 500);
    }

    return NextResponse.json({ data: { ...performanceResult.data, ...batchResult.data } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected batch detail error:", error);
    return apiError("Could not load batch details.", 500);
  }
}
