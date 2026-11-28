import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function recoveryRedirect(appUrl: URL, error: "invalid-link" | "unavailable") {
  return NextResponse.redirect(new URL(`/forgot-password?error=${error}`, appUrl));
}

export async function GET(request: NextRequest) {
  const appUrl = getAppUrl();
  if (!appUrl) {
    return NextResponse.json({ error: "Password recovery is not configured." }, { status: 503 });
  }

  if (request.nextUrl.searchParams.get("flow") !== "recovery") {
    return recoveryRedirect(appUrl, "invalid-link");
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) return recoveryRedirect(appUrl, "invalid-link");

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("Supabase password recovery callback failed:", { status: error.status, code: error.code });
      return recoveryRedirect(appUrl, "invalid-link");
    }

    return NextResponse.redirect(new URL("/reset-password", appUrl));
  } catch (error) {
    console.error("Unexpected password recovery callback error:", error);
    return recoveryRedirect(appUrl, "unavailable");
  }
}
