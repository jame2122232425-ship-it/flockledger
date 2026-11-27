import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id");
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data, error } = await supabase.rpc("list_platform_farm_applications");
    if (error) {
      if (error.code === "42501") return apiError("Platform administrator permission required.", 403);
      console.error("Failed to load platform farm applications:", error.code);
      return apiError("Could not load farm applications.", 500);
    }
    return NextResponse.json({ data }, {
      headers: {
        "Cache-Control": "private, no-store",
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected platform application list error:", error);
    return apiError("Could not load farm applications.", 500);
  }
}
