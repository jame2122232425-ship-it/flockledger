import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUBSCRIPTIONS_ENABLED } from "@/lib/subscriptions/config";

const subscriptionPlanCodeSchema = z.enum(["starter", "professional", "enterprise"]);
const subscriptionStatusSchema = z.enum([
  "pending",
  "trialing",
  "active",
  "past_due",
  "grace_period",
  "canceled",
  "expired",
]);
const billingIntervalSchema = z.enum(["monthly", "annual"]);

const subscriptionFeatureSchema = z.object({
  enabled: z.boolean(),
  configuration: z.record(z.string(), z.unknown()),
});

const professionalTrialHistorySchema = z.object({
  trialStartedAt: z.iso.datetime({ offset: true }).nullable(),
  trialEndsAt: z.iso.datetime({ offset: true }).nullable(),
});

export const farmEntitlementsSchema = z.object({
  farmId: z.string().uuid(),
  subscription: z.object({
    id: z.string().uuid(),
    planCode: subscriptionPlanCodeSchema,
    status: subscriptionStatusSchema,
    billingInterval: billingIntervalSchema.nullable(),
    startedAt: z.iso.datetime({ offset: true }),
    trialStartedAt: z.iso.datetime({ offset: true }).nullable(),
    trialEndsAt: z.iso.datetime({ offset: true }).nullable(),
    currentPeriodStart: z.iso.datetime({ offset: true }).nullable(),
    currentPeriodEnd: z.iso.datetime({ offset: true }).nullable(),
    cancelAtPeriodEnd: z.boolean(),
    canceledAt: z.iso.datetime({ offset: true }).nullable(),
    endedAt: z.iso.datetime({ offset: true }).nullable(),
  }),
  effectivePlan: z.object({
    code: subscriptionPlanCodeSchema,
    name: z.string(),
  }),
  features: z.record(z.string(), subscriptionFeatureSchema),
  limits: z.record(z.string(), z.number().int().nonnegative().nullable()),
  trialAvailable: z.boolean(),
  professionalTrialHistory: professionalTrialHistorySchema,
});

export type FarmEntitlements = z.infer<typeof farmEntitlementsSchema>;
export type SubscriptionPlanCode = z.infer<typeof subscriptionPlanCodeSchema>;
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;
export type BillingInterval = z.infer<typeof billingIntervalSchema>;

const subscriptionPlanRecordSchema = z.object({
  id: z.string().uuid(),
  code: subscriptionPlanCodeSchema,
  name: z.string(),
  description: z.string(),
  trial_days: z.number().int().nonnegative(),
  features: z.record(z.string(), z.object({
    enabled: z.boolean(),
    limitValue: z.number().int().nonnegative().nullable(),
    configuration: z.record(z.string(), z.unknown()),
  })),
  prices: z.array(z.object({
    billingInterval: billingIntervalSchema,
    currency: z.literal("KES"),
    amountMinor: z.number().int().nonnegative().nullable(),
  })),
});

const subscriptionPlanSchema = z.object({
  code: subscriptionPlanCodeSchema,
  name: z.string(),
  description: z.string(),
  trial_days: z.number().int().nonnegative(),
  features: z.record(z.string(), z.object({
    enabled: z.boolean(),
    limitValue: z.number().int().nonnegative().nullable(),
    configurable: z.boolean(),
  }).strict()),
  prices: z.array(z.object({
    billingInterval: billingIntervalSchema,
    currency: z.literal("KES"),
    amountMinor: z.number().int().nonnegative().nullable(),
  }).strict()),
}).strict();

export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;
type SubscriptionPlanRecord = z.infer<typeof subscriptionPlanRecordSchema>;

export function toPublicSubscriptionPlan(record: SubscriptionPlanRecord): SubscriptionPlan {
  return subscriptionPlanSchema.parse({
    code: record.code,
    name: record.name,
    description: record.description,
    trial_days: record.trial_days,
    features: Object.fromEntries(
      Object.entries(record.features).map(([key, feature]) => [
        key,
        {
          enabled: feature.enabled,
          limitValue: feature.limitValue,
          configurable: feature.configuration.configurable === true,
        },
      ]),
    ),
    prices: record.prices,
  });
}

const subscriptionUsageSchema = z.object({
  farmId: z.string().uuid(),
  subscriptionId: z.string().uuid(),
  activeBatches: z.number().int().nonnegative(),
  staffUsers: z.number().int().nonnegative(),
  storageMb: z.number().int().nonnegative(),
});

export type SubscriptionUsage = z.infer<typeof subscriptionUsageSchema>;
export type SubscriptionLimitKey = "max_active_batches" | "max_staff_users" | "max_storage_mb";

export class SubscriptionServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "SubscriptionServiceError";
  }
}

function throwOnSupabaseError(error: { message: string; code?: string } | null) {
  if (error) {
    throw new SubscriptionServiceError(error.message, error.code ?? "UNKNOWN");
  }
}

export async function getActiveSubscriptionPlans(
  supabase: SupabaseClient,
): Promise<SubscriptionPlan[]> {
  const { data: planData, error: planError } = await supabase
    .from("subscription_plans")
    .select("id, code, name, description, trial_days")
    .eq("is_active", true)
    .order("code", { ascending: true });
  throwOnSupabaseError(planError);
  if (!planData) {
    throw new SubscriptionServiceError("Subscription plan query returned no data.", "NO_DATA");
  }

  if (!planData.length) return [];
  const planIds = planData.map((plan) => plan.id);
  const [featureResult, priceResult] = await Promise.all([
    supabase.from("plan_features")
      .select("plan_id, feature_key, enabled, limit_value, configuration")
      .in("plan_id", planIds)
      .order("feature_key", { ascending: true }),
    supabase.from("subscription_plan_prices")
      .select("plan_id, billing_interval, currency, amount_minor")
      .in("plan_id", planIds)
      .order("billing_interval", { ascending: true }),
  ]);
  throwOnSupabaseError(featureResult.error);
  throwOnSupabaseError(priceResult.error);
  if (!featureResult.data || !priceResult.data) {
    throw new SubscriptionServiceError("Subscription configuration query returned no data.", "NO_DATA");
  }

  const records = planData.map((plan) => subscriptionPlanRecordSchema.parse({
    ...plan,
    features: Object.fromEntries(
      featureResult.data
        .filter((feature) => feature.plan_id === plan.id)
        .map((feature) => [
          feature.feature_key,
          {
            enabled: feature.enabled,
            limitValue: feature.limit_value,
            configuration: feature.configuration,
          },
        ]),
    ),
    prices: priceResult.data
      .filter((price) => price.plan_id === plan.id)
      .map((price) => ({
        billingInterval: price.billing_interval,
        currency: price.currency.trim(),
        amountMinor: price.amount_minor,
      })),
  }));
  return records.map(toPublicSubscriptionPlan);
}

export async function getFarmEntitlements(
  supabase: SupabaseClient,
  farmId: string,
): Promise<FarmEntitlements> {
  const validFarmId = z.string().uuid().parse(farmId);
  const [entitlementsResult, trialHistoryResult] = await Promise.all([
    supabase.rpc("get_farm_entitlements", { p_farm_id: validFarmId }),
    supabase.rpc("get_farm_professional_trial_history", { p_farm_id: validFarmId }),
  ]);
  throwOnSupabaseError(entitlementsResult.error);
  throwOnSupabaseError(trialHistoryResult.error);
  return farmEntitlementsSchema.parse({
    ...entitlementsResult.data,
    professionalTrialHistory: professionalTrialHistorySchema.parse(trialHistoryResult.data),
  });
}

export async function startProfessionalTrial(
  supabase: SupabaseClient,
  farmId: string,
) {
  const validFarmId = z.string().uuid().parse(farmId);
  const { data, error } = await supabase.rpc("start_professional_trial", {
    p_farm_id: validFarmId,
  });
  throwOnSupabaseError(error);
  return z.object({
    id: z.string().uuid(),
    farmId: z.string().uuid(),
    planCode: z.literal("professional"),
    status: z.literal("trialing"),
    trialStartedAt: z.iso.datetime({ offset: true }),
    trialEndsAt: z.iso.datetime({ offset: true }),
  }).parse(data);
}

export async function requestSubscriptionCancellation(
  supabase: SupabaseClient,
  farmId: string,
) {
  const validFarmId = z.string().uuid().parse(farmId);
  const { data, error } = await supabase.rpc("request_subscription_cancellation", {
    p_farm_id: validFarmId,
  });
  throwOnSupabaseError(error);
  return z.object({
    id: z.string().uuid(),
    farmId: z.string().uuid(),
    status: subscriptionStatusSchema,
    cancelAtPeriodEnd: z.literal(true),
    effectiveAt: z.iso.datetime({ offset: true }),
  }).parse(data);
}

export async function getFarmSubscriptionUsage(
  supabase: SupabaseClient,
  farmId: string,
): Promise<SubscriptionUsage> {
  const validFarmId = z.string().uuid().parse(farmId);
  const { data, error } = await supabase.rpc("get_farm_subscription_usage", {
    p_farm_id: validFarmId,
  });
  throwOnSupabaseError(error);
  return subscriptionUsageSchema.parse(data);
}

export function isFeatureEnabled(
  entitlements: FarmEntitlements,
  featureKey: string,
) {
  return !SUBSCRIPTIONS_ENABLED || entitlements.features[featureKey]?.enabled === true;
}

export function getFeatureLevel(
  entitlements: FarmEntitlements,
  featureKey: string,
) {
  if (!SUBSCRIPTIONS_ENABLED) return "unlimited";
  const level = entitlements.features[featureKey]?.configuration.level;
  return typeof level === "string" ? level : null;
}

export function evaluateSubscriptionLimit(
  entitlements: FarmEntitlements,
  limitKey: SubscriptionLimitKey,
  currentUsage: number,
  requestedIncrement = 1,
) {
  if (!Number.isSafeInteger(currentUsage) || currentUsage < 0) {
    throw new RangeError("Current usage must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(requestedIncrement) || requestedIncrement <= 0) {
    throw new RangeError("Requested increment must be a positive safe integer.");
  }

  const configured = Object.prototype.hasOwnProperty.call(entitlements.limits, limitKey);
  const limit = configured ? entitlements.limits[limitKey] : null;
  const requestedUsage = currentUsage + requestedIncrement;
  if (!Number.isSafeInteger(requestedUsage)) {
    throw new RangeError("Requested usage exceeds the safe integer range.");
  }
  if (!SUBSCRIPTIONS_ENABLED) {
    return {
      allowed: true,
      configured: true,
      limit: null,
      currentUsage,
      requestedIncrement,
      remaining: null,
    };
  }
  if (limit !== null && !Number.isSafeInteger(limit)) {
    throw new RangeError("Configured limit exceeds the safe integer range.");
  }
  const allowed = configured && (
    limit === null || requestedUsage <= limit
  );

  return {
    allowed,
    configured,
    limit,
    currentUsage,
    requestedIncrement,
    remaining: !configured || limit === null
      ? null
      : Math.max(0, limit - currentUsage),
  };
}
