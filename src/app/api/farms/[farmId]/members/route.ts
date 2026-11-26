import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, isUuid } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  paginationMetadata,
  paginationRange,
  parsePagination,
} from "@/lib/api/pagination";

const memberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["owner", "manager", "attendant", "accountant", "veterinarian", "inventory_officer"]),
});

type RouteContext = { params: Promise<{ farmId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination) return apiError("Provide valid page and pageSize values (1-100).", 400);
  const { farmId } = await context.params;
  if (!isUuid(farmId)) return apiError("Invalid farm ID.", 400);
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const { from, to } = paginationRange(pagination);
    const { data, error, count } = await supabase.from("farm_memberships")
      .select("farm_id, user_id, role, created_at", { count: "exact" })
      .eq("farm_id", farmId)
      .order("created_at", { ascending: true })
      .order("user_id", { ascending: true })
      .range(from, to);
    if (error) {
      console.error("Failed to load farm members:", error.code);
      return apiError("Could not load farm members.", 500);
    }
    return NextResponse.json({
      data,
      pagination: paginationMetadata(count ?? 0, pagination),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected farm member list error:", error);
    return apiError("Could not load farm members.", 500);
  }
}

export async function POST() {
  return apiError("Staff must complete an invitation setup before receiving farm access.", 409);
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
    const { data, error } = await supabase.rpc("update_farm_member_role", {
      p_farm_id: farmId,
      p_user_id: parsed.data.userId,
      p_role: parsed.data.role,
    });
    if (error) {
      if (error.code === "42501") return apiError("Only farm owners can change member roles.", 403);
      if (error.message === "STAFF_SEAT_QUOTA_EXCEEDED") {
        return apiError("The additional staff limit for this farm has been reached. Remove a staff member or change plans before assigning this role.", 409);
      }
      if (error.code === "55000") return apiError("The additional staff limit is unavailable. Contact support.", 503);
      if (error.code === "P0001") return apiError(error.message, 409);
      if (error.code === "P0002") return apiError("Farm member not found.", 404);
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
    const { data, error } = await supabase.rpc("remove_farm_member", {
      p_farm_id: farmId,
      p_user_id: userId,
    });
    if (error) {
      if (error.code === "42501") return apiError("Only farm owners can remove members.", 403);
      if (error.code === "P0001") return apiError(error.message, 409);
      if (error.code === "P0002") return apiError("Farm member not found.", 404);
      console.error("Failed to remove farm member:", error.code);
      return apiError("Could not remove farm member.", 500);
    }
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected farm member removal error:", error);
    return apiError("Could not remove farm member.", 500);
  }
}
