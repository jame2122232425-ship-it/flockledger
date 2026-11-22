import { connection, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  await connection();
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({
        data: {
          authenticated: false,
          accountName: "",
        },
      });
    }

    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
      console.error("Failed to verify landing page session:", error.message);
      return apiError("Could not verify your session.", 401);
    }

    return NextResponse.json({
      data: {
        authenticated: Boolean(user),
        accountName: String(user?.user_metadata?.full_name ?? user?.email ?? "").trim(),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected landing page session error:", error);
    return apiError("Could not verify your session.", 500);
  }
}
