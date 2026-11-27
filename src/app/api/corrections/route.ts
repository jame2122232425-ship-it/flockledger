import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  paginationMetadata,
  paginationRange,
  parsePagination,
} from "@/lib/api/pagination";
import { correctionCreateSchema } from "@/lib/validation/corrections";
import { requireIdempotencyKey } from "@/lib/security";

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination) return apiError("Provide valid page and pageSize values (1-100).", 400);
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
      .select("id, farm_id, batch_id, source_table, source_record_id, reason, dead_delta, culled_delta, birds_sold_delta, live_weight_sold_kg_delta, feed_consumed_kg_delta, revenue_kes_delta, paid_kes_delta, money_in_kes_delta, money_out_kes_delta, created_by, created_at", { count: "exact" })
      .eq("farm_id", parsed.data.farmId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (parsed.data.batchId) query = query.eq("batch_id", parsed.data.batchId);
    const { from, to } = paginationRange(pagination);
    const { data, error, count } = await query.range(from, to);
    if (error) {
      console.error("Failed to load corrections:", error.code);
      return apiError("Could not load corrections.", 500);
    }
    return NextResponse.json({
      data,
      pagination: paginationMetadata(count ?? 0, pagination),
    });
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
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) return apiError("Provide an Idempotency-Key header.", 400);
  const correction = parsed.data;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const { data, error } = await supabase.rpc("create_operational_correction_idempotent", {
      p_farm_id: correction.farmId,
      p_batch_id: correction.batchId,
      p_source_record_id: correction.sourceRecordId,
      p_reason: correction.reason,
      p_dead_delta: correction.deadDelta,
      p_culled_delta: correction.culledDelta,
      p_feed_consumed_kg_delta: correction.feedConsumedKgDelta,
      p_idempotency_key: idempotencyKey,
    });
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
