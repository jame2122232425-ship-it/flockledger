import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id");
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data, error } = await supabase.rpc("is_platform_admin");
    if (error) {
      console.error("Failed to load platform administrator status:", error.code);
      return apiError("Could not load platform access.", 500);
    }
    return NextResponse.json({ isPlatformAdmin: data === true }, {
      headers: {
        "Cache-Control": "private, no-store",
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected platform access check error:", error);
    return apiError("Could not load platform access.", 500);
  }
}
