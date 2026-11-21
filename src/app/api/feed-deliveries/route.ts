import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createSchema = z.object({
  farmId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  deliveryDate: z.iso.date(),
  feedType: z.string().trim().min(1).max(128),
  bags: z.number().int().positive(),
  kgPerBag: z.number().positive(),
  pricePerBagKes: z.number().min(0),
  invoiceNumber: z.string().trim().max(64).nullable().optional(),
  supplier: z.string().trim().max(128).nullable().optional(),
});

const fields =
  "id, farm_id, batch_id, delivery_date, feed_type, bags, kg_per_bag, price_per_bag, invoice_number, supplier, created_at";

export async function GET(request: NextRequest) {
  const parsed = z.object({ farmId: z.string().uuid() }).safeParse({
    farmId: request.nextUrl.searchParams.get("farmId"),
  });
  if (!parsed.success) return apiError("Provide a valid farmId.", 400);
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const { data, error } = await supabase.from("feed_deliveries").select(fields)
      .eq("farm_id", parsed.data.farmId).order("delivery_date", { ascending: false });
    if (error) {
      console.error("Failed to load feed deliveries:", error.code);
      return apiError("Could not load feed deliveries.", 500);
    }
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected feed delivery list error:", error);
    return apiError("Could not load feed deliveries.", 500);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Request body must be valid JSON.", 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid feed delivery.", details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const delivery = parsed.data;
    const { data, error } = await supabase.from("feed_deliveries").insert({
      farm_id: delivery.farmId,
      batch_id: delivery.batchId ?? null,
      delivery_date: delivery.deliveryDate,
      feed_type: delivery.feedType,
      bags: delivery.bags,
      kg_per_bag: delivery.kgPerBag,
      price_per_bag: delivery.pricePerBagKes,
      invoice_number: delivery.invoiceNumber ?? null,
      supplier: delivery.supplier ?? null,
    }).select(fields).single();
    if (error) {
      if (error.code === "42501") return apiError("You cannot add feed deliveries for this farm.", 403);
      if (error.code === "P0001") return apiError(error.message, 409);
      console.error("Failed to create feed delivery:", error.code);
      return apiError("Could not create feed delivery.", 500);
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected feed delivery creation error:", error);
    return apiError("Could not create feed delivery.", 500);
  }
}
