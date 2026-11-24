import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createHash } from "node:crypto";
import { attemptKey, getClientIp } from "@/lib/security";

const passwordSchema = z.object({
  password: z.string().min(8).max(128),
  tokenHash: z.string().min(20).optional(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }
  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) return apiError("Use a new password with at least 8 characters.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const keyHash = attemptKey(getClientIp(request), user.id);
    const { data: allowed, error: limitError } = await supabase.rpc(
      "check_auth_attempt",
      { p_scope: "staff-password", p_key_hash: keyHash, p_limit: 10, p_window_seconds: 900 },
    );
    if (limitError) return apiError("Password setup is temporarily unavailable.", 503);
    if (!allowed) return apiError("Too many password setup attempts. Try again later.", 429);

    if (user.app_metadata?.force_password_change !== true) {
      return apiError("This account does not require a password setup.", 400);
    }

    const { error: passwordError } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });
    if (passwordError) {
      await supabase.rpc("record_auth_attempt", {
        p_scope: "staff-password",
        p_key_hash: keyHash,
        p_window_seconds: 900,
      });
      return apiError("Could not change password.", 400);
    }

    const admin = createSupabaseAdminClient();
    const { error: metadataError } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: {
        force_password_change: false,
      },
    });
    if (metadataError) {
      console.error("Failed to clear password setup flag:", metadataError.status);
      return apiError("Password changed, but account setup could not be finalized.", 500);
    }

    if (parsed.data.tokenHash) {
      const setupTokenHash = createHash("sha256").update(parsed.data.tokenHash).digest("hex");
      const { error: consumeError } = await supabase.rpc("consume_staff_setup_token", {
        p_setup_token_hash: setupTokenHash,
      });
      if (consumeError) {
        return apiError("The setup link is invalid or expired.", 400);
      }
    }

    const { error: acceptError } = await supabase.rpc("accept_farm_invitations");
    if (acceptError) {
      console.error("Failed to finalize staff invitation:", acceptError.code);
      return apiError("Password changed, but the staff invitation could not be finalized.", 500);
    }

    return NextResponse.json({ data: { passwordChanged: true } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected staff password setup error:", error);
    return apiError("Could not change password.", 500);
  }
}
