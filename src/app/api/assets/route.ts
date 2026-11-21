import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createSchema = z.object({
  farmId: z.string().uuid(),
  name: z.string().trim().min(1).max(128),
  datePurchased: z.iso.date(),
  costKes: z.number().min(0),
  usefulLifeYears: z.number().positive(),
  salvageValueKes: z.number().min(0).default(0),
  remarks: z.string().trim().max(2000).nullable().optional(),
}).refine((value) => value.salvageValueKes <= value.costKes, "Salvage value cannot exceed asset cost.");

const fields =
  "id, farm_id, name, date_purchased, cost_kes, useful_life_years, salvage_value_kes, remarks, created_at";

function withDepreciation(asset: Record<string, unknown>) {
  const cost = Number(asset.cost_kes);
  const salvage = Number(asset.salvage_value_kes);
  const life = Number(asset.useful_life_years);
  const start = Date.parse(`${String(asset.date_purchased)}T00:00:00Z`);
  const yearsInUse = Math.max(0, (Date.now() - start) / (365.25 * 24 * 60 * 60 * 1000));
  const annualDepreciation = (cost - salvage) / life;
  return {
    ...asset,
    annual_depreciation_kes: annualDepreciation,
    years_in_use: yearsInUse,
    book_value_kes: Math.max(salvage, cost - annualDepreciation * yearsInUse),
  };
}

export async function GET(request: NextRequest) {
  const parsed = z.object({ farmId: z.string().uuid() }).safeParse({
    farmId: request.nextUrl.searchParams.get("farmId"),
  });
  if (!parsed.success) return apiError("Provide a valid farmId.", 400);
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const { data, error } = await supabase.from("assets").select(fields)
      .eq("farm_id", parsed.data.farmId).order("date_purchased", { ascending: false });
    if (error) {
      console.error("Failed to load assets:", error.code);
      return apiError("Could not load assets.", 500);
    }
    return NextResponse.json({ data: data.map((asset) => withDepreciation(asset)) });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected asset list error:", error);
    return apiError("Could not load assets.", 500);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Request body must be valid JSON.", 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid asset.", details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const asset = parsed.data;
    const { data, error } = await supabase.from("assets").insert({
      farm_id: asset.farmId,
      name: asset.name,
      date_purchased: asset.datePurchased,
      cost_kes: asset.costKes,
      useful_life_years: asset.usefulLifeYears,
      salvage_value_kes: asset.salvageValueKes,
      remarks: asset.remarks ?? null,
    }).select(fields).single();
    if (error) {
      if (error.code === "42501") return apiError("You cannot manage assets for this farm.", 403);
      console.error("Failed to create asset:", error.code);
      return apiError("Could not create asset.", 500);
    }
    return NextResponse.json({ data: withDepreciation(data) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected asset creation error:", error);
    return apiError("Could not create asset.", 500);
  }
}
