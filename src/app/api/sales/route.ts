import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  buildRevenueSales,
  filterRevenueSales,
  summarizeRevenueSales,
} from "@/lib/revenue/sales";
import { saleCreateSchema, salesListQuerySchema } from "@/lib/validation/sales";

const saleFields =
  "id, farm_id, batch_id, sale_date, customer, birds_sold, total_weight_kg, price_basis, price_kes, amount_kes, receipt_number, remarks, created_at";
const correctionFields =
  "id, batch_id, source_record_id, reason, birds_sold_delta, live_weight_sold_kg_delta, revenue_kes_delta, paid_kes_delta, created_at";
const paymentFields = "sale_id, amount_kes";

function nextDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function dateTimeInNairobi(date: string) {
  return `${date}T00:00:00+03:00`;
}

export async function GET(request: NextRequest) {
  const query = salesListQuerySchema.safeParse({
    farmId: request.nextUrl.searchParams.get("farmId"),
    batchId: request.nextUrl.searchParams.get("batchId") ?? undefined,
    from: request.nextUrl.searchParams.get("from") ?? undefined,
    to: request.nextUrl.searchParams.get("to") ?? undefined,
    paymentStatus: request.nextUrl.searchParams.get("paymentStatus") ?? undefined,
    search: request.nextUrl.searchParams.get("search") ?? undefined,
  });
  if (!query.success) return apiError("Provide valid farm, date, and sales filters.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    let salesQuery = supabase.from("sales").select(saleFields)
      .eq("farm_id", query.data.farmId)
      .order("sale_date", { ascending: false });
    if (query.data.batchId) salesQuery = salesQuery.eq("batch_id", query.data.batchId);
    if (query.data.from) salesQuery = salesQuery.gte("sale_date", query.data.from);
    if (query.data.to) salesQuery = salesQuery.lte("sale_date", query.data.to);
    if (query.data.search) {
      const literalSearch = query.data.search.replace(/[\\%_]/g, "\\$&");
      salesQuery = salesQuery.ilike("customer", `%${literalSearch}%`);
    }

    const { data: sales, error: salesError } = await salesQuery;
    if (salesError) {
      console.error("Failed to load sales:", salesError.code);
      return apiError("Could not load sales.", 500);
    }

    const saleIds = sales.map((sale) => sale.id);
    const paymentQuery = saleIds.length
      ? supabase.from("sale_payments").select(paymentFields)
        .eq("farm_id", query.data.farmId).in("sale_id", saleIds)
      : null;
    const saleCorrectionQuery = saleIds.length
      ? supabase.from("corrections").select(correctionFields)
        .eq("farm_id", query.data.farmId).eq("source_table", "sales")
        .in("source_record_id", saleIds)
      : null;
    let adjustmentQuery = query.data.search
      ? null
      : supabase.from("corrections").select(correctionFields)
        .eq("farm_id", query.data.farmId).eq("source_table", "sales")
        .is("source_record_id", null);
    if (adjustmentQuery && query.data.batchId) {
      adjustmentQuery = adjustmentQuery.eq("batch_id", query.data.batchId);
    }
    if (adjustmentQuery && query.data.from) {
      adjustmentQuery = adjustmentQuery.gte("created_at", dateTimeInNairobi(query.data.from));
    }
    if (adjustmentQuery && query.data.to) {
      adjustmentQuery = adjustmentQuery.lt(
        "created_at",
        dateTimeInNairobi(nextDate(query.data.to)),
      );
    }

    const [paymentResult, saleCorrectionResult, adjustmentResult] = await Promise.all([
      paymentQuery,
      saleCorrectionQuery,
      adjustmentQuery,
    ]);
    const secondaryError =
      paymentResult?.error ?? saleCorrectionResult?.error ?? adjustmentResult?.error;
    if (secondaryError) {
      console.error("Failed to load sale payments or corrections:", secondaryError.code);
      return apiError("Could not load revenue details.", 500);
    }

    const records = buildRevenueSales(
      sales,
      paymentResult?.data ?? [],
      [...(saleCorrectionResult?.data ?? []), ...(adjustmentResult?.data ?? [])],
      query.data.farmId,
    );
    const filteredRecords = filterRevenueSales(records, query.data.paymentStatus);
    return NextResponse.json({
      data: filteredRecords,
      summary: summarizeRevenueSales(filteredRecords),
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

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const sale = parsed.data;
    const { data, error } = await supabase.rpc("create_sale", {
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
