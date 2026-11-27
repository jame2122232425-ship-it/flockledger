import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireIdempotencyKey } from "@/lib/security";
import {
  paginationMetadata,
  paginationRange,
  parsePagination,
} from "@/lib/api/pagination";

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
  "id, farm_id, batch_id, sale_payment_id, entry_date, details, category, receipt_number, money_in_kes, money_out_kes, created_at";

const batchCashPageSchema = z.object({
  data: z.array(z.object({
    id: z.string().uuid(),
    farm_id: z.string().uuid(),
    batch_id: z.string().uuid().nullable(),
    sale_payment_id: z.string().uuid().nullable(),
    entry_date: z.iso.date(),
    details: z.string(),
    category: z.string(),
    receipt_number: z.string().nullable(),
    money_in_kes: z.union([z.number(), z.string()]),
    money_out_kes: z.union([z.number(), z.string()]),
    created_at: z.iso.datetime({ offset: true }),
  })),
  total: z.number().int().nonnegative(),
});

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
    if (parsed.data.batchId) {
      const { data: result, error } = await supabase.rpc("get_batch_cash_entries_page", {
        p_farm_id: parsed.data.farmId,
        p_batch_id: parsed.data.batchId,
        p_page: pagination.page,
        p_page_size: pagination.pageSize,
      });
      if (error) {
        console.error("Failed to load batch cash entries:", error.code);
        return apiError("Could not load cash entries.", 500);
      }
      const batchPage = batchCashPageSchema.safeParse(result);
      if (!batchPage.success) {
        console.error("Batch cash entry page returned an invalid shape.");
        return apiError("Could not load cash entries.", 500);
      }
      return NextResponse.json({
        data: batchPage.data.data,
        pagination: paginationMetadata(batchPage.data.total, pagination),
      });
    }

    const { from, to } = paginationRange(pagination);
    const { data, error, count } = await supabase.from("cash_entries").select(fields, { count: "exact" })
      .eq("farm_id", parsed.data.farmId)
      .order("entry_date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (error) {
      console.error("Failed to load cash entries:", error.code);
      return apiError("Could not load cash entries.", 500);
    }
    return NextResponse.json({
      data,
      pagination: paginationMetadata(count ?? 0, pagination),
    });
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
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) return apiError("Provide an Idempotency-Key header.", 400);
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const entry = parsed.data;
    const { data, error } = await supabase.rpc("create_cash_entry_idempotent", {
      p_farm_id: entry.farmId,
      p_batch_id: entry.batchId ?? null,
      p_entry_date: entry.entryDate,
      p_details: entry.details,
      p_category: entry.category,
      p_receipt_number: entry.receiptNumber ?? null,
      p_money_in_kes: entry.moneyInKes,
      p_money_out_kes: entry.moneyOutKes,
      p_idempotency_key: idempotencyKey,
    });
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
