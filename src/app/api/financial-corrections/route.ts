import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { paginationMetadata, parsePagination } from "@/lib/api/pagination";
import { requireIdempotencyKey } from "@/lib/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const correctionKinds = [
  "sale_adjustment",
  "payment_refund",
  "cash_entry_reversal",
  "opening_cash_adjustment",
] as const;

const correctionRowSchema = z.object({
  id: z.string().uuid(),
  farm_id: z.string().uuid(),
  correction_kind: z.enum(correctionKinds),
  source_sale_id: z.string().uuid().nullable(),
  source_payment_id: z.string().uuid().nullable(),
  source_cash_entry_id: z.string().uuid().nullable(),
  source_opening_cash_id: z.string().uuid().nullable(),
  birds_sold_delta: z.number().or(z.string()),
  live_weight_sold_kg_delta: z.number().or(z.string()),
  revenue_kes_delta: z.number().or(z.string()),
  amount_kes: z.number().or(z.string()).nullable(),
  reason: z.string(),
  initiated_by: z.string().uuid(),
  created_at: z.iso.datetime({ offset: true }),
  status: z.string(),
  decided_by: z.string().uuid().nullable(),
  decision_reason: z.string().nullable(),
  decided_at: z.iso.datetime({ offset: true }).nullable(),
});

const requestPageSchema = z.object({
  data: z.array(correctionRowSchema),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

const requestSchema = z.object({
  farmId: z.string().uuid(),
  correctionKind: z.enum(correctionKinds),
  sourceSaleId: z.string().uuid().nullable().optional(),
  sourcePaymentId: z.string().uuid().nullable().optional(),
  sourceCashEntryId: z.string().uuid().nullable().optional(),
  sourceOpeningCashId: z.string().uuid().nullable().optional(),
  birdsSoldDelta: z.number().int().default(0),
  liveWeightSoldKgDelta: z.number().default(0),
  revenueKesDelta: z.number().default(0),
  amountKes: z.number().nullable().optional(),
  reason: z.string().trim().min(1).max(2000),
}).superRefine((value, context) => {
  const sources = [
    value.sourceSaleId,
    value.sourcePaymentId,
    value.sourceCashEntryId,
    value.sourceOpeningCashId,
  ];
  const quantityOrRevenueChanged =
    value.birdsSoldDelta !== 0
    || value.liveWeightSoldKgDelta !== 0
    || value.revenueKesDelta !== 0;
  const addIssue = (path: string, message: string) => {
    context.addIssue({ code: "custom", path: [path], message });
  };

  if (value.correctionKind === "sale_adjustment") {
    if (!value.sourceSaleId || sources.slice(1).some(Boolean) || value.amountKes != null || !quantityOrRevenueChanged) {
      addIssue("correctionKind", "Sale adjustments require a sale and at least one adjustment value.");
    }
    return;
  }
  if (value.correctionKind === "payment_refund") {
    if (!value.sourcePaymentId || sources.filter(Boolean).length !== 1
      || value.amountKes == null || value.amountKes <= 0 || quantityOrRevenueChanged) {
      addIssue("correctionKind", "Refunds require a payment, a positive amount, and no sale adjustment values.");
    }
    return;
  }
  if (value.correctionKind === "cash_entry_reversal") {
    if (!value.sourceCashEntryId || sources.filter(Boolean).length !== 1
      || value.amountKes == null || value.amountKes <= 0 || quantityOrRevenueChanged) {
      addIssue("correctionKind", "Cash reversals require a cash entry, a positive amount, and no sale adjustment values.");
    }
    return;
  }
  if (!value.sourceOpeningCashId || sources.filter(Boolean).length !== 1
    || value.amountKes == null || value.amountKes === 0 || quantityOrRevenueChanged) {
    addIssue("correctionKind", "Opening-cash adjustments require an opening-cash record and a nonzero amount.");
  }
});

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  const farmId = z.string().uuid().safeParse(request.nextUrl.searchParams.get("farmId"));
  if (!pagination || !farmId.success) {
    return apiError("Provide a valid farmId and pageSize (1-100).", 400);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data, error } = await supabase.rpc("get_financial_correction_requests", {
      p_farm_id: farmId.data,
      p_page_size: pagination.pageSize,
      p_page_offset: (pagination.page - 1) * pagination.pageSize,
    });
    if (error) {
      if (error.code === "42501") return apiError("You cannot view financial corrections for this farm.", 403);
      console.error("Failed to load financial correction requests:", error.code);
      return apiError("Could not load financial correction requests.", 500);
    }
    const result = requestPageSchema.safeParse(data);
    if (!result.success) {
      console.error("Financial correction page returned an invalid shape.");
      return apiError("Could not load financial correction requests.", 500);
    }
    return NextResponse.json({
      data: result.data.data,
      pagination: paginationMetadata(result.data.total, pagination),
      hasMore: result.data.hasMore,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected financial correction list error:", error);
    return apiError("Could not load financial correction requests.", 500);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid financial correction request.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) return apiError("Provide an Idempotency-Key header.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const correction = parsed.data;
    const { data, error } = await supabase.rpc("create_financial_correction_request", {
      p_farm_id: correction.farmId,
      p_correction_kind: correction.correctionKind,
      p_source_sale_id: correction.sourceSaleId ?? null,
      p_source_payment_id: correction.sourcePaymentId ?? null,
      p_source_cash_entry_id: correction.sourceCashEntryId ?? null,
      p_source_opening_cash_id: correction.sourceOpeningCashId ?? null,
      p_birds_sold_delta: correction.birdsSoldDelta,
      p_live_weight_sold_kg_delta: correction.liveWeightSoldKgDelta,
      p_revenue_kes_delta: correction.revenueKesDelta,
      p_amount_kes: correction.amountKes ?? null,
      p_reason: correction.reason,
      p_idempotency_key: idempotencyKey,
    });
    if (error) {
      if (error.code === "42501") return apiError("You cannot initiate financial corrections for this farm.", 403);
      if (error.code === "P0001") return apiError(error.message, 409);
      if (error.code === "23503" || error.code === "23514" || error.code === "22023") {
        return apiError("The correction does not match the selected farm record or amount.", 400);
      }
      console.error("Failed to create financial correction request:", error.code);
      return apiError("Could not create financial correction request.", 500);
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected financial correction creation error:", error);
    return apiError("Could not create financial correction request.", 500);
  }
}
