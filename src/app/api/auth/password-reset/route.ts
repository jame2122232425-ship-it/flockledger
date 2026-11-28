import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";
import { passwordResetRequestSchema } from "@/lib/validation/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { attemptKey, getClientIp, getRequestId } from "@/lib/security";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const errorResponse = (message: string, status: number) =>
    NextResponse.json({ error: message }, { status, headers: { "x-request-id": requestId } });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const parsed = passwordResetRequestSchema.safeParse(body);
  if (!parsed.success) return errorResponse("Provide a valid email address.", 400);

  const appUrl = getAppUrl();
  if (!appUrl) return errorResponse("Password recovery is not configured.", 503);

  const callbackUrl = new URL("/auth/callback", appUrl);
  callbackUrl.searchParams.set("flow", "recovery");
  const redirectTo = callbackUrl.toString();

  try {
    const supabase = await createSupabaseServerClient();
    const keyHash = attemptKey(getClientIp(request), parsed.data.email.toLowerCase());
    const { data: allowed, error: limitError } = await supabase.rpc(
      "check_auth_attempt",
      { p_scope: "password-reset", p_key_hash: keyHash, p_limit: 5, p_window_seconds: 900 },
    );
    if (limitError) {
      console.error("Password reset rate-limit check failed:", { code: limitError.code, requestId });
      return errorResponse("Password recovery is temporarily unavailable.", 503);
    }
    if (!allowed) return errorResponse("Too many password reset requests. Try again later.", 429);

    const { error: recordError } = await supabase.rpc("record_auth_attempt", {
      p_scope: "password-reset",
      p_key_hash: keyHash,
      p_window_seconds: 900,
    });
    if (recordError) {
      console.error("Password reset attempt recording failed:", { code: recordError.code, requestId });
      return errorResponse("Password recovery is temporarily unavailable.", 503);
    }

    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo });
    if (error) {
      console.error("Supabase password reset email failed:", { status: error.status, code: error.code, requestId });
      return errorResponse("Password reset is temporarily unavailable. Please try again later.", 503);
    }

    return NextResponse.json({
      data: { message: "If an account exists for that email, we'll send a password reset link." },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return errorResponse(error.message, 503);
    }
    console.error("Unexpected password reset request error:", { requestId, error });
    return errorResponse("Password reset is temporarily unavailable. Please try again later.", 500);
  }
}
