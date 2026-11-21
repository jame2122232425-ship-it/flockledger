import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createSchema = z.object({
  farmId: z.string().uuid(),
  batchId: z.string().uuid(),
  recordDate: z.iso.date(),
  recordType: z.enum(["Vaccination", "Treatment", "Post-mortem"]),
  diseaseReason: z.string().trim().max(128).nullable().optional(),
  productName: z.string().trim().max(128).nullable().optional(),
  productDetails: z.string().trim().max(128).nullable().optional(),
  vaccineBatchNumber: z.string().trim().max(128).nullable().optional(),
  productExpiryDate: z.iso.date().nullable().optional(),
  doseRoute: z.string().trim().max(128).nullable().optional(),
  birdsAffected: z.number().int().min(0).nullable().optional(),
  durationDays: z.number().int().min(0).nullable().optional(),
  withdrawalDays: z.number().int().min(0).nullable().optional(),
  costKes: z.number().min(0).default(0),
  givenBy: z.string().trim().max(128).nullable().optional(),
  reaction: z.string().trim().max(1000).nullable().optional(),
  postMortemFindings: z.string().trim().max(2000).nullable().optional(),
  suspectedCause: z.string().trim().max(1000).nullable().optional(),
  actionTaken: z.string().trim().max(2000).nullable().optional(),
  veterinarianConsulted: z.boolean().nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
}).refine((value) => value.productExpiryDate == null || value.productExpiryDate >= value.recordDate,
  "Product expiry date cannot be before the record date.");

const fields =
  "id, farm_id, batch_id, record_date, record_type, disease_reason, product_name, product_details, vaccine_batch_number, product_expiry_date, dose_route, birds_affected, duration_days, withdrawal_days, cost_kes, given_by, reaction, post_mortem_findings, suspected_cause, action_taken, veterinarian_consulted, remarks, created_at";

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
    let request = supabase.from("health_records").select(fields).eq("farm_id", query.data.farmId)
      .order("record_date", { ascending: false });
    if (query.data.batchId) request = request.eq("batch_id", query.data.batchId);
    const { data, error } = await request;
    if (error) {
      console.error("Failed to load health records:", error.code);
      return apiError("Could not load health records.", 500);
    }
    return NextResponse.json({
      data: data.map((record) => ({
        ...record,
        earliest_sale_date: (() => {
          if (record.record_type !== "Treatment" || record.withdrawal_days == null) return null;
          const date = new Date(`${record.record_date}T00:00:00Z`);
          date.setUTCDate(date.getUTCDate() + (record.duration_days ?? 0) + record.withdrawal_days);
          return date.toISOString().slice(0, 10);
        })(),
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected health record list error:", error);
    return apiError("Could not load health records.", 500);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Request body must be valid JSON.", 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid health record.", details: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.recordType === "Treatment" && parsed.data.withdrawalDays == null) {
    return apiError("Treatment records require the withdrawal period from the product label or veterinarian.", 400);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const record = parsed.data;
    const { data, error } = await supabase.from("health_records").insert({
      farm_id: record.farmId,
      batch_id: record.batchId,
      record_date: record.recordDate,
      record_type: record.recordType,
      disease_reason: record.diseaseReason ?? null,
      product_name: record.productName ?? null,
      product_details: record.productDetails ?? null,
      vaccine_batch_number: record.vaccineBatchNumber ?? null,
      product_expiry_date: record.productExpiryDate ?? null,
      dose_route: record.doseRoute ?? null,
      birds_affected: record.birdsAffected ?? null,
      duration_days: record.durationDays ?? null,
      withdrawal_days: record.withdrawalDays ?? null,
      cost_kes: record.costKes,
      given_by: record.givenBy ?? null,
      reaction: record.reaction ?? null,
      post_mortem_findings: record.postMortemFindings ?? null,
      suspected_cause: record.suspectedCause ?? null,
      action_taken: record.actionTaken ?? null,
      veterinarian_consulted: record.veterinarianConsulted ?? null,
      remarks: record.remarks ?? null,
    }).select(fields).single();
    if (error) {
      if (error.code === "42501") return apiError("You cannot add health records for this farm.", 403);
      if (error.code === "P0001") return apiError(error.message, 409);
      console.error("Failed to create health record:", error.code);
      return apiError("Could not create health record.", 500);
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected health record creation error:", error);
    return apiError("Could not create health record.", 500);
  }
}
