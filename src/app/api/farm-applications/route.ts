import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import {
  paginationMetadata,
  paginationRange,
  parsePagination,
} from "@/lib/api/pagination";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const fields =
  "id, farm_id, status, farm_name, decision_reason, created_at, submitted_at, decided_at";

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination) return apiError("Provide valid page and pageSize values (1-100).", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { from, to } = paginationRange(pagination);
    const { data, error, count } = await supabase.from("farm_onboarding_applications")
      .select(fields, { count: "exact" })
      .eq("owner_user_id", user.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (error) {
      console.error("Failed to load farm applications:", error.code);
      return apiError("Could not load farm applications.", 500);
    }
    return NextResponse.json({
      data,
      pagination: paginationMetadata(count ?? 0, pagination),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected farm application list error:", error);
    return apiError("Could not load farm applications.", 500);
  }
}
