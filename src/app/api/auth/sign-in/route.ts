import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { attemptKey, getClientIp } from "@/lib/security";

const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }

  const parsed = signInSchema.safeParse(body);
  if (!parsed.success) return apiError("Provide a valid email and password.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const keyHash = attemptKey(getClientIp(request), parsed.data.email.toLowerCase());
    const { data: allowed, error: limitError } = await supabase.rpc(
      "check_auth_attempt",
      { p_scope: "sign-in", p_key_hash: keyHash, p_limit: 10, p_window_seconds: 900 },
    );
    if (limitError) return apiError("Authentication is temporarily unavailable.", 503);
    if (!allowed) return apiError("Too many sign-in attempts. Try again later.", 429);

    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error || !data.user) {
      await supabase.rpc("record_auth_attempt", {
        p_scope: "sign-in",
        p_key_hash: keyHash,
        p_window_seconds: 900,
      });
      return apiError("Invalid email or password.", 401);
    }

    return NextResponse.json({
      data: {
        userId: data.user.id,
        email: data.user.email,
        requiresPasswordChange: data.user.app_metadata?.force_password_change === true,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected sign-in error:", error);
    return apiError("Could not sign in.", 500);
  }
}
