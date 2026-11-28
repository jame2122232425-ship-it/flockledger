import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { payloadHash, requireIdempotencyKey, attemptKey } from "../src/lib/security";
import { isProtectedApiPath, validateSameOrigin } from "../src/lib/proxy-security";

describe("security helpers", () => {
  it("blocks cross-origin state-changing requests", () => {
    const request = new NextRequest("https://flockledger.example/api/sales", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    });
    expect(validateSameOrigin(request)).toBe(false);
  });

  it("allows same-origin state-changing requests", () => {
    const request = new NextRequest("https://flockledger.example/api/sales", {
      method: "POST",
      headers: { origin: "https://flockledger.example" },
    });
    expect(validateSameOrigin(request)).toBe(true);
  });

  it("only protects authenticated application API paths", () => {
    expect(isProtectedApiPath("/api/batches")).toBe(true);
    expect(isProtectedApiPath("/api/subscription-plans")).toBe(false);
    expect(isProtectedApiPath("/api/subscription-plans/unexpected")).toBe(true);
    expect(isProtectedApiPath("/api/farms/farm-id/subscription")).toBe(true);
    expect(isProtectedApiPath("/api/farms/farm-id/subscription/usage")).toBe(true);
    expect(isProtectedApiPath("/api/auth/sign-in")).toBe(false);
    expect(isProtectedApiPath("/api/auth/password-reset")).toBe(false);
    expect(isProtectedApiPath("/api/auth/password-update")).toBe(true);
    expect(isProtectedApiPath("/api/staff/setup/password")).toBe(false);
  });

  it("requires a bounded idempotency key", () => {
    const valid = new NextRequest("https://flockledger.example/api/sales", {
      method: "POST",
      headers: { "idempotency-key": "payment-111111111111" },
    });
    expect(requireIdempotencyKey(valid)).toBe("payment-111111111111");

    const invalid = new NextRequest("https://flockledger.example/api/sales", {
      method: "POST",
    });
    expect(requireIdempotencyKey(invalid)).toBeNull();
  });

  it("uses stable hashes for payload and auth-attempt keys", () => {
    expect(payloadHash({ amount: 100, farmId: "farm-a" }))
      .toBe(payloadHash({ amount: 100, farmId: "farm-a" }));
    expect(attemptKey("203.0.113.10", "farmer@example.com"))
      .not.toBe(attemptKey("203.0.113.11", "farmer@example.com"));
  });

  it("detects different payloads submitted under the same idempotency key", () => {
    const first = payloadHash({ amount: 100, farmId: "farm-a" });
    const second = payloadHash({ amount: 101, farmId: "farm-a" });
    expect(first).not.toBe(second);
  });
});
