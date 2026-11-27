import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { requireIdempotencyKey } from "@/lib/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ requestId: string }> };

const bodySchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(1).max(2000),
});

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { requestId } = await context.params;
  const id = z.string().uuid().safeParse(requestId);
  if (!id.success) return apiError("Provide a valid correction request ID.", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid correction decision.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) return apiError("Provide an Idempotency-Key header.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data, error } = await supabase.rpc("decide_financial_correction", {
      p_request_id: id.data,
      p_decision: parsed.data.decision,
      p_reason: parsed.data.reason,
      p_idempotency_key: idempotencyKey,
    });
    if (error) {
      if (error.code === "42501") return apiError("You cannot decide this correction request.", 403);
      if (error.code === "P0002") return apiError("Correction request not found.", 404);
      if (error.code === "P0001") return apiError(error.message, 409);
      if (error.code === "23514" || error.code === "22023") {
        return apiError("The decision cannot be applied to the current financial state.", 409);
      }
      console.error("Failed to decide financial correction:", error.code);
      return apiError("Could not decide financial correction.", 500);
    }
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected financial correction decision error:", error);
    return apiError("Could not decide financial correction.", 500);
  }
}
