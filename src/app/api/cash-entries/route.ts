import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createSchema = z.object({
  farmId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  entryDate: z.iso.date(),
  details: z.string().trim().min(1).max(255),
  category: z.string().trim().min(1).max(64),
  receiptNumber: z.string().trim().max(64).nullable().optional(),
  moneyInKes: z.number().min(0).default(0),
  moneyOutKes: z.number().min(0).default(0),
}).refine(
  (value) => (value.moneyInKes > 0) !== (value.moneyOutKes > 0),
  "Enter either money in or money out, but not both.",
);

const fields =
  "id, farm_id, batch_id, entry_date, details, category, receipt_number, money_in_kes, money_out_kes, created_at";

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
    let query = supabase.from("cash_entries").select(fields)
      .eq("farm_id", parsed.data.farmId).order("entry_date", { ascending: false });
    if (parsed.data.batchId) query = query.eq("batch_id", parsed.data.batchId);
    const { data, error } = await query;
    if (error) {
      console.error("Failed to load cash entries:", error.code);
      return apiError("Could not load cash entries.", 500);
    }
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected cash entry list error:", error);
    return apiError("Could not load cash entries.", 500);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Request body must be valid JSON.", 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid cash entry.", details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const entry = parsed.data;
    const { data, error } = await supabase.from("cash_entries").insert({
      farm_id: entry.farmId,
      batch_id: entry.batchId ?? null,
      entry_date: entry.entryDate,
      details: entry.details,
      category: entry.category,
      receipt_number: entry.receiptNumber ?? null,
      money_in_kes: entry.moneyInKes,
      money_out_kes: entry.moneyOutKes,
    }).select(fields).single();
    if (error) {
      if (error.code === "42501") return apiError("You cannot add cash entries for this farm.", 403);
      if (error.code === "P0001") return apiError(error.message, 409);
      console.error("Failed to create cash entry:", error.code);
      return apiError("Could not create cash entry.", 500);
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected cash entry creation error:", error);
    return apiError("Could not create cash entry.", 500);
  }
}
