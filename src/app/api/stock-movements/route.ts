import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createSchema = z.object({
  farmId: z.string().uuid(),
  itemId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  movementDate: z.iso.date(),
  received: z.number().min(0).default(0),
  used: z.number().min(0).default(0),
  supplier: z.string().trim().max(128).nullable().optional(),
  invoiceNumber: z.string().trim().max(64).nullable().optional(),
  expiryDate: z.iso.date().nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
}).refine(
  (value) => (value.received > 0) !== (value.used > 0),
  "Enter either a receipt or usage movement, but not both.",
);

const fields =
  "id, farm_id, item_id, batch_id, movement_date, received, used, supplier, invoice_number, expiry_date, remarks, created_at";

export async function GET(request: NextRequest) {
  const parsed = z.object({ farmId: z.string().uuid(), itemId: z.string().uuid().optional() })
    .safeParse({
      farmId: request.nextUrl.searchParams.get("farmId"),
      itemId: request.nextUrl.searchParams.get("itemId") ?? undefined,
    });
  if (!parsed.success) return apiError("Provide a valid farmId and optional itemId.", 400);
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    let query = supabase.from("stock_movements").select(fields)
      .eq("farm_id", parsed.data.farmId).order("movement_date", { ascending: false });
    if (parsed.data.itemId) query = query.eq("item_id", parsed.data.itemId);
    const { data, error } = await query;
    if (error) {
      console.error("Failed to load stock movements:", error.code);
      return apiError("Could not load stock movements.", 500);
    }
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected stock movement list error:", error);
    return apiError("Could not load stock movements.", 500);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Request body must be valid JSON.", 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid stock movement.", details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const movement = parsed.data;
    const { data, error } = await supabase.from("stock_movements").insert({
      farm_id: movement.farmId,
      item_id: movement.itemId,
      batch_id: movement.batchId ?? null,
      movement_date: movement.movementDate,
      received: movement.received,
      used: movement.used,
      supplier: movement.supplier ?? null,
      invoice_number: movement.invoiceNumber ?? null,
      expiry_date: movement.expiryDate ?? null,
      remarks: movement.remarks ?? null,
    }).select(fields).single();
    if (error) {
      if (error.code === "42501") return apiError("You cannot record stock movements for this farm.", 403);
      if (error.code === "P0001") return apiError(error.message, 409);
      console.error("Failed to create stock movement:", error.code);
      return apiError("Could not create stock movement.", 500);
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected stock movement creation error:", error);
    return apiError("Could not create stock movement.", 500);
  }
}
