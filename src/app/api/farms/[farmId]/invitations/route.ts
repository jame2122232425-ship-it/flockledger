import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, isUuid } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createHash, randomBytes } from "node:crypto";

const invitationSchema = z.object({
  email: z.email().transform((email) => email.trim().toLowerCase()),
  role: z.enum(["manager", "attendant", "accountant", "veterinarian"]),
  fullName: z.string().trim().min(1).max(128).optional(),
  password: z.string().min(8).max(128),
});

type RouteContext = { params: Promise<{ farmId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { farmId } = await context.params;
  if (!isUuid(farmId)) return apiError("Invalid farm ID.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const { data, error } = await supabase
      .from("farm_invitations")
      .select("id, email, role, status, created_at")
      .eq("farm_id", farmId)
      .order("created_at", { ascending: false });
    if (error) {
      if (error.code === "42501") return apiError("Only farm owners can view invitations.", 403);
      console.error("Failed to load invitations:", error.code);
      return apiError("Could not load invitations.", 500);
    }
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected invitation list error:", error);
    return apiError("Could not load invitations.", 500);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { farmId } = await context.params;
  if (!isUuid(farmId)) return apiError("Invalid farm ID.", 400);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }
  const parsed = invitationSchema.safeParse(body);
  if (!parsed.success) return apiError("Provide a valid email and staff role.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data: ownerMembership, error: ownerError } = await supabase
      .from("farm_memberships")
      .select("role")
      .eq("farm_id", farmId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (ownerError) return apiError("Could not verify farm ownership.", 500);
    if (ownerMembership?.role !== "owner") {
      return apiError("Only farm owners can create staff accounts.", 403);
    }

    const admin = createSupabaseAdminClient();
    const tempPassword = parsed.data.password;
    const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
      email: parsed.data.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: parsed.data.fullName ?? "",
        force_password_change: true,
      },
      app_metadata: {
        force_password_change: true,
      },
    });
    if (createError) {
      if (createError.status === 422) return apiError("A user with this email already exists.", 409);
      console.error("Failed to create staff auth account:", createError.status);
      return apiError("Could not create staff account.", 500);
    }
    if (!createdUser.user) return apiError("Could not create staff account.", 500);

    const setupToken = randomBytes(32).toString("base64url");
    const setupTokenHash = createHash("sha256").update(setupToken).digest("hex");

    const { error: membershipError } = await admin
      .from("farm_memberships")
      .insert({
        farm_id: farmId,
        user_id: createdUser.user.id,
        role: parsed.data.role,
      })
      .select("farm_id, user_id, role, created_at")
      .single();
    if (membershipError) {
      await admin.auth.admin.deleteUser(createdUser.user.id);
      console.error("Failed to assign staff role:", membershipError.code);
      return apiError("Could not assign the staff role.", 500);
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").trim().replace(/\/$/, "");
    const setupUrl = `${appUrl}/staff/setup?token_hash=${encodeURIComponent(setupToken)}&email=${encodeURIComponent(parsed.data.email)}`;
    const { data, error } = await admin
      .from("farm_invitations")
      .upsert(
        {
          farm_id: farmId,
          email: parsed.data.email,
          role: parsed.data.role,
          invited_by: user.id,
          full_name: parsed.data.fullName ?? null,
          setup_token_hash: setupTokenHash,
          setup_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          status: "pending",
          accepted_at: null,
        },
        { onConflict: "farm_id,email" },
      )
      .select("id, email, role, status, created_at")
      .single();
    if (error) {
      if (error.code === "42501") return apiError("Only farm owners can invite staff.", 403);
      console.error("Failed to create invitation:", error.code);
      return apiError("Could not create invitation.", 500);
    }
    return NextResponse.json({
      data: {
        ...data,
        setupUrl,
        temporaryPassword: tempPassword,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected invitation creation error:", error);
    return apiError("Could not create invitation.", 500);
  }
}
