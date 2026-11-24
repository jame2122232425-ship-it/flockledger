import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { attemptKey, getClientIp } from "@/lib/security";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const keyHash = attemptKey(getClientIp(request), user.id);
    const { data: allowed, error: limitError } = await supabase.rpc(
      "check_auth_attempt",
      { p_scope: "invitation-accept", p_key_hash: keyHash, p_limit: 20, p_window_seconds: 900 },
    );
    if (limitError) return apiError("Invitation acceptance is temporarily unavailable.", 503);
    if (!allowed) return apiError("Too many invitation attempts. Try again later.", 429);

    const { data, error } = await supabase.rpc("accept_farm_invitations");
    if (error) {
      console.error("Failed to accept farm invitations:", error.code);
      return apiError("Could not accept farm invitations.", 500);
    }
    return NextResponse.json({ data: { accepted: data ?? 0 } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected invitation acceptance error:", error);
    return apiError("Could not accept farm invitations.", 500);
  }
}
