import { describe, expect, it } from "vitest";
import {
  farmEntitlementsSchema,
  evaluateSubscriptionLimit,
  getFeatureLevel,
  isFeatureEnabled,
  toPublicSubscriptionPlan,
} from "../src/lib/subscriptions/service";

const starterEntitlements = farmEntitlementsSchema.parse({
  farmId: "10000000-0000-4000-8000-000000000001",
  subscription: {
    id: "20000000-0000-4000-8000-000000000001",
    planCode: "starter",
    status: "active",
    billingInterval: null,
    startedAt: "2026-11-24T09:00:00.000Z",
    trialStartedAt: null,
    trialEndsAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    endedAt: null,
  },
  effectivePlan: { code: "starter", name: "Starter" },
  features: {
    daily_records: { enabled: true, configuration: {} },
    health_management: { enabled: true, configuration: { level: "basic" } },
    advanced_analytics: { enabled: false, configuration: {} },
  },
  limits: {
    max_active_batches: 2,
    max_staff_users: 2,
    max_storage_mb: null,
  },
  trialAvailable: true,
  professionalTrialHistory: {
    trialStartedAt: null,
    trialEndsAt: null,
  },
});

describe("subscription entitlements", () => {
  it("validates the database entitlement response shape", () => {
    expect(starterEntitlements.effectivePlan.code).toBe("starter");
    expect(() => farmEntitlementsSchema.parse({
      ...starterEntitlements,
      subscription: { ...starterEntitlements.subscription, status: "invalid" },
    })).toThrow();
  });

  it("exposes configured feature flags and levels", () => {
    expect(isFeatureEnabled(starterEntitlements, "daily_records")).toBe(true);
    expect(isFeatureEnabled(starterEntitlements, "advanced_analytics")).toBe(false);
    expect(isFeatureEnabled(starterEntitlements, "unknown_feature")).toBe(false);
    expect(getFeatureLevel(starterEntitlements, "health_management")).toBe("basic");
    expect(getFeatureLevel(starterEntitlements, "daily_records")).toBeNull();
  });

  it("allows usage up to a configured limit and rejects increments beyond it", () => {
    expect(evaluateSubscriptionLimit(
      starterEntitlements,
      "max_active_batches",
      1,
    )).toMatchObject({
      allowed: true,
      configured: true,
      limit: 2,
      remaining: 1,
    });
    expect(evaluateSubscriptionLimit(
      starterEntitlements,
      "max_active_batches",
      2,
    )).toMatchObject({
      allowed: false,
      configured: true,
      limit: 2,
      remaining: 0,
    });
    expect(evaluateSubscriptionLimit(
      starterEntitlements,
      "max_staff_users",
      1,
      2,
    ).allowed).toBe(false);
  });

  it("treats an explicit null enterprise limit as unbounded but missing configuration as unavailable", () => {
    expect(evaluateSubscriptionLimit(
      starterEntitlements,
      "max_storage_mb",
      100_000,
    )).toMatchObject({
      allowed: true,
      configured: true,
      limit: null,
      remaining: null,
    });

    const incomplete = farmEntitlementsSchema.parse({
      ...starterEntitlements,
      limits: {},
    });
    expect(evaluateSubscriptionLimit(
      incomplete,
      "max_active_batches",
      0,
    )).toMatchObject({
      allowed: false,
      configured: false,
    });
  });

  it("rejects invalid usage values instead of returning a success-shaped result", () => {
    expect(() => evaluateSubscriptionLimit(
      starterEntitlements,
      "max_active_batches",
      -1,
    )).toThrow(RangeError);
    expect(() => evaluateSubscriptionLimit(
      starterEntitlements,
      "max_active_batches",
      0,
      0,
    )).toThrow(RangeError);
    expect(() => evaluateSubscriptionLimit(
      starterEntitlements,
      "max_active_batches",
      Number.MAX_SAFE_INTEGER,
    )).toThrow(RangeError);
  });

  it("projects public plan fields without exposing database IDs or raw configuration", () => {
    const plan = toPublicSubscriptionPlan({
      id: "30000000-0000-4000-8000-000000000001",
      code: "enterprise",
      name: "Enterprise",
      description: "Configurable plan.",
      trial_days: 0,
      features: {
        max_staff_users: {
          enabled: true,
          limitValue: null,
          configuration: {
            configurable: true,
            excludesFarmOwner: true,
            internalNote: "private implementation detail",
          },
        },
      },
      prices: [
        { billingInterval: "monthly", currency: "KES", amountMinor: null },
        { billingInterval: "annual", currency: "KES", amountMinor: null },
      ],
    });

    expect(plan).toEqual({
      code: "enterprise",
      name: "Enterprise",
      description: "Configurable plan.",
      trial_days: 0,
      features: {
        max_staff_users: {
          enabled: true,
          limitValue: null,
          configurable: true,
        },
      },
      prices: [
        { billingInterval: "monthly", currency: "KES", amountMinor: null },
        { billingInterval: "annual", currency: "KES", amountMinor: null },
      ],
    });
    expect(JSON.stringify(plan)).not.toContain("private implementation detail");
  });
});
