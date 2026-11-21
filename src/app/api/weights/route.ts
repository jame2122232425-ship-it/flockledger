import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createSchema = z.object({
  farmId: z.string().uuid(),
  batchId: z.string().uuid(),
  recordDate: z.iso.date(),
  ageDays: z.number().int().min(0),
  birdsWeighed: z.number().int().positive(),
  totalWeightG: z.number().positive(),
  lightestG: z.number().positive().nullable().optional(),
  heaviestG: z.number().positive().nullable().optional(),
  targetG: z.number().positive().nullable().optional(),
  uniformCount: z.number().int().min(0).optional(),
  initials: z.string().trim().max(16).nullable().optional(),
}).refine(
  (value) => value.uniformCount === undefined || value.uniformCount <= value.birdsWeighed,
  "Uniform count cannot exceed birds weighed.",
);

const fields =
  "id, farm_id, batch_id, record_date, age_days, birds_weighed, total_weight_g, lightest_g, heaviest_g, target_g, uniform_count, initials, created_at";

export async function GET(request: NextRequest) {
  const farmId = request.nextUrl.searchParams.get("farmId");
  const batchId = request.nextUrl.searchParams.get("batchId");
  const querySchema = z.object({ farmId: z.string().uuid(), batchId: z.string().uuid().optional() });
  const query = querySchema.safeParse({ farmId, batchId: batchId ?? undefined });
  if (!query.success) return apiError("Provide a valid farmId and optional batchId.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    let request = supabase.from("weight_records").select(fields)
      .eq("farm_id", query.data.farmId).order("record_date", { ascending: false });
    if (query.data.batchId) request = request.eq("batch_id", query.data.batchId);
    const { data, error } = await request;
    if (error) {
      console.error("Failed to load weight records:", error.code);
      return apiError("Could not load weight records.", 500);
    }
    return NextResponse.json({
      data: data.map((record) => ({
        ...record,
        average_g: record.total_weight_g / record.birds_weighed,
        uniformity: record.uniform_count == null ? null : record.uniform_count / record.birds_weighed,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected weight list error:", error);
    return apiError("Could not load weight records.", 500);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid weight record.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const record = parsed.data;
    const { data: batch, error: batchError } = await supabase
      .from("batches").select("date_placed").eq("id", record.batchId)
      .eq("farm_id", record.farmId).maybeSingle();
    if (batchError) {
      console.error("Failed to check batch for weight record:", batchError.code);
      return apiError("Could not validate batch.", 500);
    }
    if (!batch) return apiError("Batch not found for this farm.", 404);
    const calculatedAge = Math.floor(
      (Date.parse(`${record.recordDate}T00:00:00Z`) - Date.parse(`${batch.date_placed}T00:00:00Z`)) / 86_400_000,
    ) + 1;
    if (calculatedAge < 1 || calculatedAge !== record.ageDays) {
      return apiError("Age in days must match the placement date and weighing date.", 400);
    }

    const { data, error } = await supabase.from("weight_records").insert({
      farm_id: record.farmId,
      batch_id: record.batchId,
      record_date: record.recordDate,
      age_days: record.ageDays,
      birds_weighed: record.birdsWeighed,
      total_weight_g: record.totalWeightG,
      lightest_g: record.lightestG ?? null,
      heaviest_g: record.heaviestG ?? null,
      target_g: record.targetG ?? null,
      uniform_count: record.uniformCount ?? null,
      initials: record.initials ?? null,
    }).select(fields).single();

    if (error) {
      if (error.code === "42501") return apiError("You cannot add weight records for this farm.", 403);
      if (error.code === "P0001") return apiError(error.message, 409);
      console.error("Failed to create weight record:", error.code);
      return apiError("Could not create weight record.", 500);
    }
    return NextResponse.json({
      data: {
        ...data,
        average_g: data.total_weight_g / data.birds_weighed,
        uniformity: data.uniform_count == null ? null : data.uniform_count / data.birds_weighed,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected weight creation error:", error);
    return apiError("Could not create weight record.", 500);
  }
}
