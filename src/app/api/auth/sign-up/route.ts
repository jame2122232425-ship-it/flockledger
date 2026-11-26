import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signUpSchema } from "@/lib/validation/auth";
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

  const parsed = signUpSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Provide a valid email, name, and password (8+ characters).", 400);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const keyHash = attemptKey(getClientIp(request), parsed.data.email.toLowerCase());
    const { data: allowed, error: limitError } = await supabase.rpc(
      "check_auth_attempt",
      { p_scope: "sign-up", p_key_hash: keyHash, p_limit: 5, p_window_seconds: 3600 },
    );
    if (limitError) return errorResponse("Account creation is temporarily unavailable.", 503);
    if (!allowed) return errorResponse("Too many account creation attempts. Try again later.", 429);

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
      const code = error.code ?? "";
      console.error("Supabase sign-up failed:", { status: error.status, code, requestId });

      if (code === "over_email_send_rate_limit" || error.status === 429) {
        return errorResponse("Email delivery is rate limited. Please try again later or contact support.", 429);
      }
      if (code === "email_address_not_authorized") {
        return errorResponse("We could not send your confirmation email. Please contact support.", 503);
      }
      if (
        error.status === 422 ||
        code === "validation_failed" ||
        code === "weak_password" ||
        code === "email_address_invalid"
      ) {
        return errorResponse("Unable to create account with those details.", 400);
      }
      return errorResponse("Could not create account.", 500);
    }

    return NextResponse.json(
      { data: { userId: data.user?.id, emailConfirmationRequired: !data.session } },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return errorResponse(error.message, 503);
    }
    console.error("Unexpected sign-up error:", { requestId, error });
    return errorResponse("Could not create account.", 500);
  }
}
