import { NextRequest, NextResponse } from "next/server";
import { passwordUpdateSchema } from "@/lib/validation/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRequestId } from "@/lib/security";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const errorResponse = (message: string, status: number) =>
    NextResponse.json({ error: message }, { status, headers: { "x-request-id": requestId } });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const parsed = passwordUpdateSchema.safeParse(body);
  if (!parsed.success) return errorResponse("Choose a password with at least 8 characters.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError && userError.status && ![400, 401, 403].includes(userError.status)) {
      console.error("Could not verify password reset session:", { status: userError.status, code: userError.code, requestId });
      return errorResponse("Could not verify your password reset session.", 503);
    }
    if (userError || !user) return errorResponse("A valid password reset session is required.", 401);

    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) {
      console.error("Supabase password update failed:", { status: error.status, code: error.code, requestId });
      if (error.status === 422 || error.code === "weak_password") {
        return errorResponse("Choose a stronger password and try again.", 400);
      }
      if (error.status === 429) return errorResponse("Too many password updates. Try again later.", 429);
      return errorResponse("Could not update your password.", 500);
    }

    return NextResponse.json({ data: { userId: user.id } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return errorResponse(error.message, 503);
    }
    console.error("Unexpected password update error:", { requestId, error });
    return errorResponse("Could not update your password.", 500);
  }
}
