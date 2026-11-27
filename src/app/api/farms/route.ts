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

const createFarmSchema = z.object({
  name: z.string().trim().min(1).max(128),
  openingCashBalanceKes: z.number().min(0).default(0),
});

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination) return apiError("Provide valid page and pageSize values (1-100).", 400);
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { from, to } = paginationRange(pagination);
    const { data, error, count } = await supabase
      .from("farm_memberships")
      .select("farm_id, role, farms(id, name, currency, timezone, lifecycle_status)", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .order("farm_id", { ascending: true })
      .range(from, to);

    if (error) {
      console.error("Failed to load farm memberships:", error.code);
      return apiError("Could not load farms.", 500);
    }
    return NextResponse.json({
      data,
      pagination: paginationMetadata(count ?? 0, pagination),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected farm list error:", error);
    return apiError("Could not load farms.", 500);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }

  const parsedBody = createFarmSchema.safeParse(body);
  if (!parsedBody.success) {
    return apiError("Provide a farm name between 1 and 128 characters.", 400);
  }
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) return apiError("Provide an Idempotency-Key header.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data: application, error } = await supabase.rpc("start_farm_application", {
      p_farm_name: parsedBody.data.name,
      p_opening_cash_balance_kes: parsedBody.data.openingCashBalanceKes,
      p_idempotency_key: idempotencyKey,
      p_invitation_id: null,
    });
    if (error) {
      if (error.code === "42501") return apiError(error.message, 403);
      if (error.code === "22023") return apiError(error.message, 400);
      if (error.code === "P0001") return apiError(error.message, 409);
      console.error("Failed to start farm application:", error.code);
      return apiError("Could not start farm application.", 500);
    }
    const applicationData = z.object({
      applicationId: z.string().uuid(),
      farmId: z.string().uuid(),
      status: z.string(),
    }).safeParse(application);
    if (!applicationData.success) {
      console.error("Farm application RPC returned an invalid shape.");
      return apiError("Could not start farm application.", 500);
    }

    const { data: submitted, error: submitError } = await supabase.rpc("submit_farm_application", {
      p_application_id: applicationData.data.applicationId,
    });
    if (submitError) {
      if (submitError.code === "42501") return apiError(submitError.message, 403);
      if (submitError.code === "P0001") return apiError(submitError.message, 409);
      console.error("Failed to submit farm application:", submitError.code);
      return apiError("Farm application was started but could not be submitted. Retry submission from your applications list.", 500);
    }
    return NextResponse.json({ data: submitted }, { status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected farm creation error:", error);
    return apiError("Could not create farm.", 500);
  }
}
