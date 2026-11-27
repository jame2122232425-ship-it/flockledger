import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ applicationId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { applicationId } = await context.params;
  const parsedId = z.string().uuid().safeParse(applicationId);
  if (!parsedId.success) return apiError("Provide a valid application ID.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data, error } = await supabase.rpc("submit_farm_application", {
      p_application_id: parsedId.data,
    });
    if (error) {
      if (error.code === "42501") return apiError(error.message, 403);
      if (error.code === "P0002") return apiError("Farm application not found.", 404);
      if (error.code === "P0001") return apiError(error.message, 409);
      console.error("Failed to submit farm application:", error.code);
      return apiError("Could not submit farm application.", 500);
    }
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected farm application submission error:", error);
    return apiError("Could not submit farm application.", 500);
  }
}
