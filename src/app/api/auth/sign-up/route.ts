import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signUpSchema } from "@/lib/validation/auth";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }

  const parsed = signUpSchema.safeParse(body);
  if (!parsed.success) return apiError("Provide a valid email, name, and password (8+ characters).", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { data: { full_name: parsed.data.fullName } },
    });

    if (error) {
      if (error.status === 422) return apiError("Unable to create account with those details.", 400);
      console.error("Supabase sign-up failed:", error.status);
      return apiError("Could not create account.", 500);
    }

    return NextResponse.json(
      { data: { userId: data.user?.id, emailConfirmationRequired: !data.session } },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected sign-up error:", error);
    return apiError("Could not create account.", 500);
  }
}
