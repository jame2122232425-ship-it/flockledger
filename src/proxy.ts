import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { getRequestId, isProtectedApiPath, validateSameOrigin } from "@/lib/proxy-security";

export async function proxy(request: NextRequest) {
  const requestId = getRequestId(request);
  if (!validateSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin request rejected." },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }

  if (!isProtectedApiPath(request.nextUrl.pathname)) {
    const response = NextResponse.next();
    response.headers.set("x-request-id", requestId);
    return response;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503, headers: { "x-request-id": requestId } },
    );
  }

  const response = NextResponse.next();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const cookie of cookiesToSet) {
          response.cookies.set(cookie.name, cookie.value, cookie.options);
        }
      },
    },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }

  if (user.app_metadata?.force_password_change === true) {
    return NextResponse.json(
      { error: "Password setup is required before using this account." },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }

  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
