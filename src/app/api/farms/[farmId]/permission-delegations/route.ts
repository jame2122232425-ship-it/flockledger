import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, isUuid } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ farmId: string }> };

const updateSchema = z.object({
  managerUserId: z.string().uuid(),
  permissions: z.array(z.enum([
    "staff.invite",
    "staff.assign_roles",
    "inventory.adjust",
    "reports.export",
  ])).max(4),
});

export async function GET(_request: Request, context: RouteContext) {
  const { farmId } = await context.params;
  if (!isUuid(farmId)) return apiError("Invalid farm ID.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data, error } = await supabase.rpc("get_farm_permission_delegations", {
      p_farm_id: farmId,
    });
    if (error) {
      if (error.code === "42501") return apiError("Only farm owners can manage permission delegations.", 403);
      console.error("Failed to load permission delegations:", error.code);
      return apiError("Could not load permission delegations.", 500);
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected permission delegation error:", error);
    return apiError("Could not load permission delegations.", 500);
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { farmId } = await context.params;
  if (!isUuid(farmId)) return apiError("Invalid farm ID.", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return apiError("Provide a manager and valid delegable permissions.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data, error } = await supabase.rpc("replace_manager_permission_delegations", {
      p_farm_id: farmId,
      p_manager_user_id: parsed.data.managerUserId,
      p_permissions: parsed.data.permissions,
    });
    if (error) {
      if (error.code === "42501") return apiError("Only farm owners can manage permission delegations.", 403);
      if (error.code === "22023") return apiError(error.message, 400);
      console.error("Failed to update permission delegations:", error.code);
      return apiError("Could not update permission delegations.", 500);
    }

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected permission delegation update error:", error);
    return apiError("Could not update permission delegations.", 500);
  }
}
