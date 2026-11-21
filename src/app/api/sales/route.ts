import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createSchema = z.object({
  farmId: z.string().uuid(),
  batchId: z.string().uuid(),
  saleDate: z.iso.date(),
  customer: z.string().trim().min(1).max(128),
  birdsSold: z.number().int().positive(),
  totalWeightKg: z.number().min(0),
  priceBasis: z.enum(["Bird", "Kg"]),
  priceKes: z.number().min(0),
  paidKes: z.number().min(0).default(0),
  receiptNumber: z.string().trim().max(64).nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
}).refine((value) => {
  const amount = value.priceBasis === "Kg"
    ? value.totalWeightKg * value.priceKes
    : value.birdsSold * value.priceKes;
  return value.paidKes <= amount;
}, "Amount paid cannot exceed the sale amount.");

const fields =
  "id, farm_id, batch_id, sale_date, customer, birds_sold, total_weight_kg, price_basis, price_kes, amount_kes, paid_kes, receipt_number, remarks, created_at";

export async function GET(request: NextRequest) {
  const query = z.object({ farmId: z.string().uuid(), batchId: z.string().uuid().optional() })
    .safeParse({
      farmId: request.nextUrl.searchParams.get("farmId"),
      batchId: request.nextUrl.searchParams.get("batchId") ?? undefined,
    });
  if (!query.success) return apiError("Provide a valid farmId and optional batchId.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    let request = supabase.from("sales").select(fields).eq("farm_id", query.data.farmId)
      .order("sale_date", { ascending: false });
    if (query.data.batchId) request = request.eq("batch_id", query.data.batchId);
    const { data, error } = await request;
    if (error) {
      console.error("Failed to load sales:", error.code);
      return apiError("Could not load sales.", 500);
    }
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected sales list error:", error);
    return apiError("Could not load sales.", 500);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Request body must be valid JSON.", 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid sale.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const sale = parsed.data;
    const { data, error } = await supabase.from("sales").insert({
      farm_id: sale.farmId,
      batch_id: sale.batchId,
      sale_date: sale.saleDate,
      customer: sale.customer,
      birds_sold: sale.birdsSold,
      total_weight_kg: sale.totalWeightKg,
      price_basis: sale.priceBasis,
      price_kes: sale.priceKes,
      paid_kes: sale.paidKes,
      receipt_number: sale.receiptNumber ?? null,
      remarks: sale.remarks ?? null,
    }).select(fields).single();
    if (error) {
      if (error.code === "42501") return apiError("You cannot record sales for this farm.", 403);
      if (error.code === "P0001") return apiError(error.message, 409);
      console.error("Failed to create sale:", error.code);
      return apiError("Could not create sale.", 500);
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected sale creation error:", error);
    return apiError("Could not create sale.", 500);
  }
}
