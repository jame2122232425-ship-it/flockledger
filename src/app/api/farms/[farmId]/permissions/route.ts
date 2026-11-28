import { NextResponse } from "next/server";
import { apiError, isUuid } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ farmId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { farmId } = await context.params;
  if (!isUuid(farmId)) return apiError("Invalid farm ID.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data, error } = await supabase.rpc("get_my_farm_permissions", {
      p_farm_id: farmId,
    });
    if (error) {
      if (error.code === "42501") return apiError("Farm membership required.", 403);
      console.error("Failed to load farm permissions:", error.code);
      return apiError("Could not load farm permissions.", 500);
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected farm permission error:", error);
    return apiError("Could not load farm permissions.", 500);
  }
}
