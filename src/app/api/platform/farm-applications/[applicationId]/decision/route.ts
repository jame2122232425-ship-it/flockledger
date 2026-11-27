import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ applicationId: string }> };

const decisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approved"),
    reason: z.string().trim().max(2000).optional(),
  }),
  z.object({
    decision: z.literal("rejected"),
    reason: z.string().trim().min(1).max(2000),
  }),
]);

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { applicationId } = await context.params;
  const parsedId = z.string().uuid().safeParse(applicationId);
  if (!parsedId.success) return apiError("Provide a valid application ID.", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid application decision.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const decision = parsed.data;
    const result = decision.decision === "approved"
      ? await supabase.rpc("approve_farm_application", {
        p_application_id: parsedId.data,
        p_decision_reason: decision.reason ?? null,
      })
      : await supabase.rpc("reject_farm_application", {
        p_application_id: parsedId.data,
        p_reason: decision.reason,
      });
    if (result.error) {
      if (result.error.code === "42501") return apiError("Platform administrator permission required.", 403);
      if (result.error.code === "P0002") return apiError("Farm application not found.", 404);
      if (result.error.code === "P0001") return apiError(result.error.message, 409);
      if (result.error.code === "22023") return apiError(result.error.message, 400);
      console.error("Failed to decide farm application:", result.error.code);
      return apiError("Could not decide farm application.", 500);
    }
    return NextResponse.json({ data: result.data });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected farm application decision error:", error);
    return apiError("Could not decide farm application.", 500);
  }
}
