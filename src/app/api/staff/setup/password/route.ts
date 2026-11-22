import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const passwordSchema = z.object({
  password: z.string().min(8).max(128),
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

    if (user.app_metadata?.force_password_change !== true) {
      return apiError("This account does not require a password setup.", 400);
    }

    const { error: passwordError } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });
    if (passwordError) return apiError("Could not change password.", 400);

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

    await admin
      .from("farm_invitations")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        setup_token_hash: null,
      })
      .eq("email", (user.email ?? "").toLowerCase());

    return NextResponse.json({ data: { passwordChanged: true } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected staff password setup error:", error);
    return apiError("Could not change password.", 500);
  }
}
