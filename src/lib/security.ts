import { createHash } from "node:crypto";
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

  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite !== "cross-site";
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

export function requireIdempotencyKey(request: NextRequest) {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 16 || key.length > 128) return null;
  return key;
}

export function payloadHash(payload: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

export function getClientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "unknown";
}

export function attemptKey(...parts: string[]) {
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}
