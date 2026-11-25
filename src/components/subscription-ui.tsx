"use client";

import type { BillingInterval, SubscriptionPlan } from "@/lib/subscriptions/service";

const featureNames: Record<string, string> = {
  daily_records: "Daily records",
  feed_tracking: "Feed tracking",
  mortality_tracking: "Mortality tracking",
  weight_tracking: "Weight tracking",
  health_management: "Health management",
  sales_management: "Sales management",
  cashbook: "Cashbook",
  inventory_management: "Inventory management",
  staff_management: "Staff management",
  brooding_management: "Brooding management",
  biosecurity_management: "Biosecurity management",
  compliance_management: "Compliance management",
  labour_management: "Labour management",
  maintenance_management: "Maintenance management",
  advanced_analytics: "Advanced analytics",
  data_export: "Data export",
  multi_farm_reporting: "Multi-farm reporting",
  advanced_reporting: "Advanced reporting",
  priority_support: "Priority support",
};

export function SubscriptionBillingIntervalSelector({
  value,
  onChange,
}: {
  value: BillingInterval;
  onChange: (value: BillingInterval) => void;
}) {
  return (
    <fieldset className="subscription-interval-selector" aria-label="Billing interval">
      <legend>Billing interval</legend>
      {(["monthly", "annual"] as const).map((interval) => (
        <button
          type="button"
          key={interval}
          aria-pressed={value === interval}
          className={value === interval ? "is-active" : ""}
          onClick={() => onChange(interval)}
        >
          {interval === "monthly" ? "Monthly" : "Annual"}
        </button>
      ))}
    </fieldset>
  );
}

export function formatSubscriptionPlanPrice(
  plan: SubscriptionPlan,
  interval: BillingInterval,
) {
  const price = plan.prices.find((candidate) => candidate.billingInterval === interval);
  if (!price || price.amountMinor === null) return null;
  if (price.amountMinor === 0) return "Free";

  const amount = new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price.amountMinor / 100);
  return `${price.currency} ${amount}`;
}

export function subscriptionFeatureLabel(key: string) {
  return featureNames[key] ?? key.replaceAll("_", " ");
}

export function subscriptionLimitLabel(plan: SubscriptionPlan, key: string) {
  const limit = plan.features[key];
  if (!limit) return "Not configured";
  if (!limit.enabled) return "Not included";
  if (limit.limitValue === null) {
    return limit.configurable
      ? "Configured per agreement"
      : "No configured cap";
  }
  return new Intl.NumberFormat("en-KE").format(limit.limitValue);
}

export function formatSubscriptionDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeZone: "Africa/Nairobi",
  }).format(new Date(value));
}
