import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { revenueCursorSchema, revenueLedgerPageSchema } from "@/lib/revenue/sales";
import { saleCreateSchema, salesListQuerySchema } from "@/lib/validation/sales";
import { payloadHash, requireIdempotencyKey } from "@/lib/security";
import { parsePagination } from "@/lib/api/pagination";

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination) return apiError("Provide valid page and pageSize values (1-100).", 400);
  const query = salesListQuerySchema.safeParse({
    farmId: request.nextUrl.searchParams.get("farmId"),
    batchId: request.nextUrl.searchParams.get("batchId") ?? undefined,
    from: request.nextUrl.searchParams.get("from") ?? undefined,
    to: request.nextUrl.searchParams.get("to") ?? undefined,
    paymentStatus: request.nextUrl.searchParams.get("paymentStatus") ?? undefined,
    search: request.nextUrl.searchParams.get("search") ?? undefined,
  });
  if (!query.success) return apiError("Provide valid farm, date, and sales filters.", 400);
  const rawCursor = request.nextUrl.searchParams.get("cursor");
  let cursor: z.infer<typeof revenueCursorSchema> | null = null;
  if (rawCursor) {
    let cursorValue: unknown;
    try {
      cursorValue = JSON.parse(rawCursor);
    } catch {
      return apiError("Provide a valid sales cursor.", 400);
    }
    const parsedCursor = revenueCursorSchema.safeParse(cursorValue);
    if (!parsedCursor.success) return apiError("Provide a valid sales cursor.", 400);
    cursor = parsedCursor.data;
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data, error } = await supabase.rpc("get_revenue_ledger_page", {
      p_farm_id: query.data.farmId,
      p_batch_id: query.data.batchId ?? null,
      p_from: query.data.from ?? null,
      p_to: query.data.to ?? null,
      p_payment_status: query.data.paymentStatus ?? null,
      p_search: query.data.search?.trim() || null,
      p_cursor_date: cursor?.saleDate ?? null,
      p_cursor_created_at: cursor?.createdAt ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_page_size: pagination.pageSize,
    });
    if (error) {
      console.error("Failed to load paginated revenue:", error.code);
      return apiError("Could not load revenue details.", 500);
    }
    const result = revenueLedgerPageSchema.safeParse(data);
    if (!result.success) {
      console.error("Revenue page returned an invalid shape.");
      return apiError("Could not load revenue details.", 500);
    }
    const total = result.data.summary.sale_count;
    return NextResponse.json({
      data: result.data.data,
      summary: result.data.summary,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        pageCount: Math.ceil(total / pagination.pageSize),
        hasMore: result.data.hasMore,
        nextCursor: result.data.nextCursor,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected sales list error:", error);
    return apiError("Could not load sales.", 500);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }
  const parsed = saleCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid sale.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) {
    return apiError("Provide an Idempotency-Key header.", 400);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const sale = parsed.data;
    const { data, error } = await supabase.rpc("create_sale_idempotent", {
      p_farm_id: sale.farmId,
      p_batch_id: sale.batchId,
      p_sale_date: sale.saleDate,
      p_customer: sale.customer,
      p_birds_sold: sale.birdsSold,
      p_total_weight_kg: sale.totalWeightKg,
      p_price_basis: sale.priceBasis,
      p_price_kes: sale.priceKes,
      p_paid_kes: sale.paidKes,
      p_receipt_number: sale.receiptNumber ?? null,
      p_remarks: sale.remarks ?? null,
      p_idempotency_key: idempotencyKey,
      p_payload_hash: payloadHash({
        farmId: sale.farmId,
        batchId: sale.batchId,
        saleDate: sale.saleDate,
        customer: sale.customer,
        birdsSold: sale.birdsSold,
        totalWeightKg: sale.totalWeightKg,
        priceBasis: sale.priceBasis,
        priceKes: sale.priceKes,
        paidKes: sale.paidKes,
        receiptNumber: sale.receiptNumber ?? null,
        remarks: sale.remarks ?? null,
      }),
    });
    if (error) {
      if (error.code === "42501") return apiError("You cannot record sales for this farm.", 403);
      if (error.code === "P0001") return apiError(error.message, 409);
      if (error.code === "23503" || error.code === "23514" || error.code === "22P02" || error.code === "22003") {
        return apiError("The sale violates a farm or batch constraint.", 400);
      }
      console.error("Failed to create sale:", error.code);
      return apiError("Could not create sale.", 500);
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected sale creation error:", error);
    return apiError("Could not create sale.", 500);
  }
}
