import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, isUuid } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const memberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["owner", "manager", "attendant", "accountant", "veterinarian"]),
});

type RouteContext = { params: Promise<{ farmId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { farmId } = await context.params;
  if (!isUuid(farmId)) return apiError("Invalid farm ID.", 400);
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const { data, error } = await supabase.from("farm_memberships")
      .select("farm_id, user_id, role, created_at")
      .eq("farm_id", farmId).order("created_at", { ascending: true });
    if (error) {
      console.error("Failed to load farm members:", error.code);
      return apiError("Could not load farm members.", 500);
    }
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected farm member list error:", error);
    return apiError("Could not load farm members.", 500);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { farmId } = await context.params;
  if (!isUuid(farmId)) return apiError("Invalid farm ID.", 400);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Request body must be valid JSON.", 400); }
  const parsed = memberSchema.safeParse(body);
  if (!parsed.success) return apiError("Provide a valid user ID and farm role.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const { data, error } = await supabase.from("farm_memberships")
      .insert({ farm_id: farmId, user_id: parsed.data.userId, role: parsed.data.role })
      .select("farm_id, user_id, role, created_at").single();
    if (error) {
      if (error.code === "23505") return apiError("User is already a member of this farm.", 409);
      if (error.code === "42501") return apiError("Only farm owners can add members.", 403);
      console.error("Failed to add farm member:", error.code);
      return apiError("Could not add farm member.", 500);
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected farm member creation error:", error);
    return apiError("Could not add farm member.", 500);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { farmId } = await context.params;
  if (!isUuid(farmId)) return apiError("Invalid farm ID.", 400);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Request body must be valid JSON.", 400); }
  const parsed = memberSchema.safeParse(body);
  if (!parsed.success) return apiError("Provide a valid user ID and farm role.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const { data, error } = await supabase.from("farm_memberships")
      .update({ role: parsed.data.role })
      .eq("farm_id", farmId).eq("user_id", parsed.data.userId)
      .select("farm_id, user_id, role, created_at").maybeSingle();
    if (error) {
      if (error.code === "42501") return apiError("Only farm owners can change member roles.", 403);
      if (error.code === "P0001") return apiError(error.message, 409);
      console.error("Failed to update farm member:", error.code);
      return apiError("Could not update farm member.", 500);
    }
    if (!data) return apiError("Farm member not found.", 404);
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected farm member update error:", error);
    return apiError("Could not update farm member.", 500);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { farmId } = await context.params;
  const userId = request.nextUrl.searchParams.get("userId");
  if (!isUuid(farmId) || !userId || !isUuid(userId)) return apiError("Provide a valid farm ID and userId.", 400);
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const { data, error } = await supabase.from("farm_memberships").delete()
      .eq("farm_id", farmId).eq("user_id", userId).select("user_id").maybeSingle();
    if (error) {
      if (error.code === "42501") return apiError("Only farm owners can remove members.", 403);
      if (error.code === "P0001") return apiError(error.message, 409);
      console.error("Failed to remove farm member:", error.code);
      return apiError("Could not remove farm member.", 500);
    }
    if (!data) return apiError("Farm member not found.", 404);
    return NextResponse.json({ data: { removed: true } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected farm member removal error:", error);
    return apiError("Could not remove farm member.", 500);
  }
}
