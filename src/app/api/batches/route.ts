import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  paginationMetadata,
  paginationRange,
  parsePagination,
} from "@/lib/api/pagination";
import {
  batchCreateSchema,
  batchListQuerySchema,
} from "@/lib/validation/batches";

const BATCH_FIELDS =
  "id, farm_id, batch_code, batch_type, rearing_system, house, date_placed, source, strain, chicks_ordered, chicks_received, date_sold_out, status, remarks, created_at";

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination) return apiError("Provide valid page and pageSize values (1-100).", 400);
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
      .select(BATCH_FIELDS, { count: "exact" })
      .eq("farm_id", parsedQuery.data.farmId)
      .order("date_placed", { ascending: false })
      .order("id", { ascending: false });

    if (parsedQuery.data.status) {
      query = query.eq("status", parsedQuery.data.status);
    }

    const { from, to } = paginationRange(pagination);
    const { data, error, count } = await query.range(from, to);
    if (error) {
      console.error("Failed to list batches:", error.code);
      return apiError("Could not load batches.", 500);
    }

    return NextResponse.json({
      data,
      pagination: paginationMetadata(count ?? 0, pagination),
    });
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
    const { data, error } = await supabase.rpc("create_batch_with_quota", {
      p_farm_id: batch.farmId,
      p_batch_code: batch.batchCode,
      p_batch_type: batch.batchType,
      p_rearing_system: batch.rearingSystem ?? null,
      p_house: batch.house ?? null,
      p_date_placed: batch.datePlaced,
      p_source: batch.source ?? null,
      p_strain: batch.strain ?? null,
      p_chicks_ordered: batch.chicksOrdered,
      p_chicks_received: batch.chicksReceived,
      p_remarks: batch.remarks ?? null,
    });

    if (error) {
      if (error.message === "ACTIVE_BATCH_QUOTA_EXCEEDED") {
        return NextResponse.json(
          {
            error: "The active batch limit for this farm has been reached. Close a running batch or change plans before adding another.",
            code: "QUOTA_EXCEEDED",
          },
          { status: 409 },
        );
      }
      if (error.code === "23505") {
        return apiError("That batch ID is already in use for this farm.", 409);
      }
      if (error.code === "42501") {
        console.error("Batch creation authorization denied:", error.message);
        if (error.message === "You cannot create batches for this farm.") {
          return apiError(
            "The selected farm does not recognize this account as an owner or manager. Ask a farm owner to verify your role, then sign out and back in.",
            403,
          );
        }
        return apiError(
          "The database could not verify access to this farm. Sign out and back in, then contact support if the problem continues.",
          403,
        );
      }
      if (error.code === "55000") return apiError("The active batch limit is unavailable. Contact support.", 503);
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
