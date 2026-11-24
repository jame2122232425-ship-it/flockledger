import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
      .select("farm_id, role, farms(id, name, currency, timezone, opening_cash_balance_kes)", { count: "exact" })
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

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data: farmId, error } = await supabase.rpc("create_farm", {
      farm_name: parsedBody.data.name,
      opening_balance_kes: parsedBody.data.openingCashBalanceKes,
    });
    if (error) {
      console.error("Failed to create farm:", error.code);
      return apiError("Could not create farm.", 500);
    }
    return NextResponse.json({
      data: {
        id: farmId,
        name: parsedBody.data.name,
        currency: "KES",
        opening_cash_balance_kes: parsedBody.data.openingCashBalanceKes,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected farm creation error:", error);
    return apiError("Could not create farm.", 500);
  }
}
