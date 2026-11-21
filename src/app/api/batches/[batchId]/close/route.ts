import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const closeBatchSchema = z.object({
  farmId: z.string().uuid(),
  dateSoldOut: z.iso.date(),
});

type RouteContext = { params: Promise<{ batchId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { batchId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)) {
    return apiError("Invalid batch ID.", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }

  const parsedBody = closeBatchSchema.safeParse(body);
  if (!parsedBody.success) return apiError("Provide a valid farmId and closing date.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data, error } = await supabase
      .from("batches")
      .update({ date_sold_out: parsedBody.data.dateSoldOut, status: "closed" })
      .eq("id", batchId)
      .eq("farm_id", parsedBody.data.farmId)
      .eq("status", "running")
      .select("id, batch_code, date_sold_out, status")
      .maybeSingle();

    if (error) {
      if (error.code === "42501") return apiError("Only farm owners or managers can close batches.", 403);
      console.error("Failed to close batch:", error.code);
      return apiError("Could not close batch.", 500);
    }
    if (!data) return apiError("Running batch not found or you do not have permission to close it.", 404);
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected batch closure error:", error);
    return apiError("Could not close batch.", 500);
  }
}
