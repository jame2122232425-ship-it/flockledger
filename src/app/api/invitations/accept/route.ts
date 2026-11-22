import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

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
