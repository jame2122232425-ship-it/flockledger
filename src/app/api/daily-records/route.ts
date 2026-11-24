import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  paginationMetadata,
  paginationRange,
  parsePagination,
} from "@/lib/api/pagination";
import {
  dailyRecordCreateSchema,
  dailyRecordListQuerySchema,
} from "@/lib/validation/daily-records";

const DAILY_FIELDS =
  "id, farm_id, batch_id, record_date, dead, culled, feed_given_kg, feed_left_kg, water_liters, temp_min_c, temp_max_c, litter, remarks, initials, created_at";

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination) return apiError("Provide valid page and pageSize values (1-100).", 400);
  const parsedQuery = dailyRecordListQuerySchema.safeParse({
    farmId: request.nextUrl.searchParams.get("farmId"),
    batchId: request.nextUrl.searchParams.get("batchId") ?? undefined,
    from: request.nextUrl.searchParams.get("from") ?? undefined,
    to: request.nextUrl.searchParams.get("to") ?? undefined,
  });
  if (!parsedQuery.success) {
    return apiError("Provide a valid farmId, batchId, or date range.", 400);
  }
  if (
    parsedQuery.data.from &&
    parsedQuery.data.to &&
    parsedQuery.data.from > parsedQuery.data.to
  ) {
    return apiError("The from date must not be after the to date.", 400);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    let query = supabase
      .from("daily_records")
      .select(DAILY_FIELDS, { count: "exact" })
      .eq("farm_id", parsedQuery.data.farmId)
      .order("record_date", { ascending: false })
      .order("id", { ascending: false });

    if (parsedQuery.data.batchId) query = query.eq("batch_id", parsedQuery.data.batchId);
    if (parsedQuery.data.from) query = query.gte("record_date", parsedQuery.data.from);
    if (parsedQuery.data.to) query = query.lte("record_date", parsedQuery.data.to);

    const { from, to } = paginationRange(pagination);
    const { data, error, count } = await query.range(from, to);
    if (error) {
      console.error("Failed to list daily records:", error.code);
      return apiError("Could not load daily records.", 500);
    }
    return NextResponse.json({
      data,
      pagination: paginationMetadata(count ?? 0, pagination),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected daily record list error:", error);
    return apiError("Could not load daily records.", 500);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }

  const parsedBody = dailyRecordCreateSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid daily record.", details: parsedBody.error.flatten() },
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

    const record = parsedBody.data;
    const { data, error } = await supabase
      .from("daily_records")
      .insert({
        farm_id: record.farmId,
        batch_id: record.batchId,
        record_date: record.recordDate,
        dead: record.dead,
        culled: record.culled,
        feed_given_kg: record.feedGivenKg,
        feed_left_kg: record.feedLeftKg,
        water_liters: record.waterLiters,
        temp_min_c: record.tempMinC ?? null,
        temp_max_c: record.tempMaxC ?? null,
        litter: record.litter ?? null,
        remarks: record.remarks ?? null,
        initials: record.initials ?? null,
      })
      .select(DAILY_FIELDS)
      .single();

    if (error) {
      if (error.code === "23505") {
        return apiError("A daily record already exists for this batch and date.", 409);
      }
      if (error.code === "42501") return apiError("You cannot add records for this farm.", 403);
      if (error.code === "P0001") return apiError(error.message, 409);
      console.error("Failed to create daily record:", error.code);
      return apiError("Could not create daily record.", 500);
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected daily record creation error:", error);
    return apiError("Could not create daily record.", 500);
  }
}
