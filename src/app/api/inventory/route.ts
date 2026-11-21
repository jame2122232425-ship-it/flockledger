import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createSchema = z.object({
  farmId: z.string().uuid(),
  name: z.string().trim().min(1).max(128),
  itemType: z.string().trim().min(1).max(64),
  unit: z.string().trim().min(1).max(32),
  reorderLevel: z.number().min(0).default(0),
  expiryDate: z.iso.date().nullable().optional(),
});

export async function GET(request: NextRequest) {
  const parsed = z.object({ farmId: z.string().uuid() }).safeParse({
    farmId: request.nextUrl.searchParams.get("farmId"),
  });
  if (!parsed.success) return apiError("Provide a valid farmId.", 400);
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const { data, error } = await supabase.from("inventory_balances")
      .select("item_id, name, item_type, unit, reorder_level, expiry_date, total_received, total_used, balance")
      .eq("farm_id", parsed.data.farmId).order("name", { ascending: true });
    if (error) {
      console.error("Failed to load inventory:", error.code);
      return apiError("Could not load inventory.", 500);
    }
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const expiryWarningDate = new Date(today);
    expiryWarningDate.setUTCDate(expiryWarningDate.getUTCDate() + 30);
    return NextResponse.json({
      data: data.map((item) => {
        const expiryDate = item.expiry_date ? new Date(`${item.expiry_date}T00:00:00Z`) : null;
        const status = Number(item.balance) <= Number(item.reorder_level)
          ? "REORDER"
          : expiryDate && expiryDate <= today
            ? "EXPIRED"
            : expiryDate && expiryDate <= expiryWarningDate
              ? "CHECK_EXPIRY"
              : "OK";
        return { ...item, status };
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected inventory list error:", error);
    return apiError("Could not load inventory.", 500);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Request body must be valid JSON.", 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid inventory item.", details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const item = parsed.data;
    const { data, error } = await supabase.from("inventory_items").insert({
      farm_id: item.farmId,
      name: item.name,
      item_type: item.itemType,
      unit: item.unit,
      reorder_level: item.reorderLevel,
      expiry_date: item.expiryDate ?? null,
    }).select("id, farm_id, name, item_type, unit, reorder_level, expiry_date, created_at").single();
    if (error) {
      if (error.code === "23505") return apiError("An inventory item with that name already exists.", 409);
      if (error.code === "42501") return apiError("You cannot manage inventory for this farm.", 403);
      console.error("Failed to create inventory item:", error.code);
      return apiError("Could not create inventory item.", 500);
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected inventory item creation error:", error);
    return apiError("Could not create inventory item.", 500);
  }
}
