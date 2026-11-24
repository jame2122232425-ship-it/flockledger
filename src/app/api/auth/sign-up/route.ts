import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signUpSchema } from "@/lib/validation/auth";
import { attemptKey, getClientIp } from "@/lib/security";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }

  const parsed = signUpSchema.safeParse(body);
  if (!parsed.success) return apiError("Provide a valid email, name, and password (8+ characters).", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const keyHash = attemptKey(getClientIp(request), parsed.data.email.toLowerCase());
    const { data: allowed, error: limitError } = await supabase.rpc(
      "check_auth_attempt",
      { p_scope: "sign-up", p_key_hash: keyHash, p_limit: 5, p_window_seconds: 3600 },
    );
    if (limitError) return apiError("Account creation is temporarily unavailable.", 503);
    if (!allowed) return apiError("Too many account creation attempts. Try again later.", 429);

    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { data: { full_name: parsed.data.fullName } },
    });

    if (error) {
      await supabase.rpc("record_auth_attempt", {
        p_scope: "sign-up",
        p_key_hash: keyHash,
        p_window_seconds: 3600,
      });
      if (error.status === 422) return apiError("Unable to create account with those details.", 400);
      console.error("Supabase sign-up failed:", error.status);
      return apiError("Could not create account.", 500);
    }

    return NextResponse.json(
      { data: { userId: data.user?.id, emailConfirmationRequired: !data.session } },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected sign-up error:", error);
    return apiError("Could not create account.", 500);
  }
}
