import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  batchCreateSchema,
  batchListQuerySchema,
} from "@/lib/validation/batches";

const BATCH_FIELDS =
  "id, farm_id, batch_code, batch_type, rearing_system, house, date_placed, source, strain, chicks_ordered, chicks_received, date_sold_out, status, remarks, created_at";

export async function GET(request: NextRequest) {
  const parsedQuery = batchListQuerySchema.safeParse({
    farmId: request.nextUrl.searchParams.get("farmId"),
    status: request.nextUrl.searchParams.get("status") ?? undefined,
  });
  if (!parsedQuery.success) {
    return apiError("Provide a valid farmId and optional batch status.", 400);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    let query = supabase
      .from("batches")
      .select(BATCH_FIELDS)
      .eq("farm_id", parsedQuery.data.farmId)
      .order("date_placed", { ascending: false });

    if (parsedQuery.data.status) {
      query = query.eq("status", parsedQuery.data.status);
    }

    const { data, error } = await query;
    if (error) {
      console.error("Failed to list batches:", error.code);
      return apiError("Could not load batches.", 500);
    }

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected batch list error:", error);
    return apiError("Could not load batches.", 500);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }

  const parsedBody = batchCreateSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid batch details.", details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const batch = parsedBody.data;
    const { data, error } = await supabase
      .from("batches")
      .insert({
        farm_id: batch.farmId,
        batch_code: batch.batchCode,
        batch_type: batch.batchType,
        rearing_system: batch.rearingSystem ?? null,
        house: batch.house ?? null,
        date_placed: batch.datePlaced,
        source: batch.source ?? null,
        strain: batch.strain ?? null,
        chicks_ordered: batch.chicksOrdered,
        chicks_received: batch.chicksReceived,
        remarks: batch.remarks ?? null,
      })
      .select(BATCH_FIELDS)
      .single();

    if (error) {
      if (error.code === "23505") {
        return apiError("That batch ID is already in use for this farm.", 409);
      }
      if (error.code === "42501") return apiError("You cannot create batches for this farm.", 403);
      console.error("Failed to create batch:", error.code);
      return apiError("Could not create batch.", 500);
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected batch creation error:", error);
    return apiError("Could not create batch.", 500);
  }
}
