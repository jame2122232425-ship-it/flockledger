import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Supabase sign-out failed:", error.status);
      return apiError("Could not sign out.", 500);
    }
    return NextResponse.json({ data: { signedOut: true } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected sign-out error:", error);
    return apiError("Could not sign out.", 500);
  }
}
