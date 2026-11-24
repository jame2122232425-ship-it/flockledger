import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { salePaymentCreateSchema } from "@/lib/validation/sales";
import { payloadHash, requireIdempotencyKey } from "@/lib/security";
import {
  paginationMetadata,
  paginationRange,
  parsePagination,
} from "@/lib/api/pagination";

type RouteContext = { params: Promise<{ saleId: string }> };

const paymentFields =
  "id, farm_id, sale_id, payment_date, amount_kes, reference, created_by, created_at";

async function getSaleId(context: RouteContext) {
  const params = await context.params;
  return z.string().uuid().safeParse(params.saleId);
}

export async function GET(request: NextRequest, context: RouteContext) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination) return apiError("Provide valid page and pageSize values (1-100).", 400);
  const saleId = await getSaleId(context);
  const farmId = z.string().uuid().safeParse(request.nextUrl.searchParams.get("farmId"));
  if (!saleId.success || !farmId.success) {
    return apiError("Provide valid sale and farm IDs.", 400);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data: sale, error: saleError } = await supabase.from("sales")
      .select("id")
      .eq("id", saleId.data)
      .eq("farm_id", farmId.data)
      .maybeSingle();
    if (saleError) {
      console.error("Failed to verify sale for payment history:", saleError.code);
      return apiError("Could not load payment history.", 500);
    }
    if (!sale) return apiError("Sale not found.", 404);

    const { from, to } = paginationRange(pagination);
    const { data, error, count } = await supabase.from("sale_payments")
      .select(paymentFields, { count: "exact" })
      .eq("farm_id", farmId.data)
      .eq("sale_id", saleId.data)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (error) {
      console.error("Failed to load sale payments:", error.code);
      return apiError("Could not load payment history.", 500);
    }
    return NextResponse.json({
      data,
      pagination: paginationMetadata(count ?? 0, pagination),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected sale payment list error:", error);
    return apiError("Could not load payment history.", 500);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const saleId = await getSaleId(context);
  if (!saleId.success) return apiError("Provide a valid sale ID.", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }
  const parsed = salePaymentCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid sale payment.", details: parsed.error.flatten() },
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

    const payment = parsed.data;
    const { data, error } = await supabase.rpc("create_sale_payment_idempotent", {
      p_farm_id: payment.farmId,
      p_sale_id: saleId.data,
      p_payment_date: payment.paymentDate,
      p_amount_kes: payment.amountKes,
      p_reference: payment.reference || null,
      p_idempotency_key: idempotencyKey,
      p_payload_hash: payloadHash({
        farmId: payment.farmId,
        saleId: saleId.data,
        paymentDate: payment.paymentDate,
        amountKes: payment.amountKes,
        reference: payment.reference || null,
      }),
    });
    if (error) {
      if (error.code === "42501") return apiError("You cannot record payments for this farm.", 403);
      if (error.code === "P0001") {
        return apiError(
          error.message === "Sale not found for farm."
            ? "Sale not found."
            : error.message,
          error.message === "Sale not found for farm." ? 404 : 409,
        );
      }
      if (error.code === "23503" || error.code === "23514" || error.code === "22P02") {
        return apiError("The payment violates a sale or farm constraint.", 400);
      }
      console.error("Failed to record sale payment:", error.code);
      return apiError("Could not record sale payment.", 500);
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected sale payment creation error:", error);
    return apiError("Could not record sale payment.", 500);
  }
}
