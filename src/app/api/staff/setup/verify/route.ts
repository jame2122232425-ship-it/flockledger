import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createHash } from "node:crypto";

const verifySchema = z.object({
  tokenHash: z.string().min(20),
  password: z.string().min(8).max(128),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) return apiError("Invalid or missing setup link.", 400);

  try {
    const admin = createSupabaseAdminClient();
    const setupTokenHash = createHash("sha256").update(parsed.data.tokenHash).digest("hex");
    const { data: invitation, error: invitationError } = await admin
      .from("farm_invitations")
      .select("id, email, status, setup_expires_at")
      .eq("setup_token_hash", setupTokenHash)
      .maybeSingle();
    if (invitationError || !invitation) return apiError("This setup link is invalid.", 400);
    if (invitation.status === "cancelled") return apiError("This setup invitation was cancelled.", 400);
    if (new Date(invitation.setup_expires_at).getTime() < Date.now()) {
      return apiError("This setup link has expired.", 400);
    }

    const supabase = await createSupabaseServerClient();
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: invitation.email,
      password: parsed.data.password,
    });
    if (signInError || signInData.user?.app_metadata?.force_password_change !== true) {
      return apiError("The temporary password is incorrect.", 401);
    }

    return NextResponse.json({
      data: {
        email: invitation.email,
        requiresPasswordChange: true,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected staff setup verification error:", error);
    return apiError("Could not verify setup link.", 500);
  }
}
