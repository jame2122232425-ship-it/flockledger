import type { NextRequest } from "next/server";

export function getRequestId(request: NextRequest) {
  const provided = request.headers.get("x-request-id")?.trim();
  return provided && provided.length <= 128
    ? provided
    : globalThis.crypto.randomUUID();
}

export function validateSameOrigin(request: NextRequest) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return true;

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== request.nextUrl.origin) return false;
    } catch {
      return false;
    }
  }

  return request.headers.get("sec-fetch-site") !== "cross-site";
}

export function isProtectedApiPath(pathname: string) {
  return pathname.startsWith("/api/")
    && ![
      "/api/auth/sign-in",
      "/api/auth/sign-up",
      "/api/auth/sign-out",
      "/api/auth/session",
      "/api/staff/setup/verify",
      "/api/staff/setup/password",
    ].includes(pathname);
}
