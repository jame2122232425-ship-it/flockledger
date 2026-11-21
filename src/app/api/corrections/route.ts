import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { correctionCreateSchema } from "@/lib/validation/corrections";

export async function GET(request: NextRequest) {
  const parsed = z.object({ farmId: z.string().uuid(), batchId: z.string().uuid().optional() })
    .safeParse({
      farmId: request.nextUrl.searchParams.get("farmId"),
      batchId: request.nextUrl.searchParams.get("batchId") ?? undefined,
    });
  if (!parsed.success) return apiError("Provide a valid farmId and optional batchId.", 400);
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    let query = supabase.from("corrections")
      .select("id, farm_id, batch_id, source_table, source_record_id, reason, dead_delta, culled_delta, birds_sold_delta, live_weight_sold_kg_delta, feed_consumed_kg_delta, revenue_kes_delta, paid_kes_delta, money_in_kes_delta, money_out_kes_delta, created_by, created_at")
      .eq("farm_id", parsed.data.farmId).order("created_at", { ascending: false });
    if (parsed.data.batchId) query = query.eq("batch_id", parsed.data.batchId);
    const { data, error } = await query;
    if (error) {
      console.error("Failed to load corrections:", error.code);
      return apiError("Could not load corrections.", 500);
    }
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected correction list error:", error);
    return apiError("Could not load corrections.", 500);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Request body must be valid JSON.", 400); }
  const parsed = correctionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid correction.", details: parsed.error.flatten() }, { status: 400 });
  }
  const correction = parsed.data;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const { data, error } = await supabase.from("corrections").insert({
      farm_id: correction.farmId,
      batch_id: correction.batchId,
      source_table: correction.sourceTable,
      source_record_id: correction.sourceRecordId ?? null,
      reason: correction.reason,
      dead_delta: correction.deadDelta,
      culled_delta: correction.culledDelta,
      birds_sold_delta: correction.birdsSoldDelta,
      live_weight_sold_kg_delta: correction.liveWeightSoldKgDelta,
      feed_consumed_kg_delta: correction.feedConsumedKgDelta,
      revenue_kes_delta: correction.revenueKesDelta,
      paid_kes_delta: correction.paidKesDelta,
      money_in_kes_delta: correction.moneyInKesDelta,
      money_out_kes_delta: correction.moneyOutKesDelta,
    }).select("id, farm_id, batch_id, source_table, source_record_id, reason, dead_delta, culled_delta, birds_sold_delta, live_weight_sold_kg_delta, feed_consumed_kg_delta, revenue_kes_delta, paid_kes_delta, money_in_kes_delta, money_out_kes_delta, created_by, created_at").single();
    if (error) {
      if (error.code === "42501") return apiError("Only farm owners or managers can add corrections.", 403);
      if (error.code === "P0001") return apiError(error.message, 409);
      console.error("Failed to create correction:", error.code);
      return apiError("Could not create correction.", 500);
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected correction creation error:", error);
    return apiError("Could not create correction.", 500);
  }
}
