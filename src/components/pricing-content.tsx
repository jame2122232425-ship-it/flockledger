"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { request } from "@/lib/client/request";
import type { BillingInterval, SubscriptionPlan } from "@/lib/subscriptions/service";
import {
  formatSubscriptionPlanPrice,
  subscriptionFeatureLabel,
  subscriptionLimitLabel,
  SubscriptionBillingIntervalSelector,
} from "@/components/subscription-ui";

const planOrder = ["starter", "professional", "enterprise"] as const;

export default function PricingContent({
  eyebrow,
  title,
  summary,
}: {
  eyebrow: string;
  title: string;
  summary: string;
}) {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("monthly");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    request<{ data: SubscriptionPlan[] }>("/api/subscription-plans", {
      signal: controller.signal,
    }).then(({ data }) => {
      if (active) setPlans(data);
    }).catch((loadError: unknown) => {
      if (active) {
        setError(loadError instanceof Error ? loadError.message : "Could not load subscription plans.");
      }
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const orderedPlans = [...plans].sort(
    (first, second) => planOrder.indexOf(first.code) - planOrder.indexOf(second.code),
  );
  const featureKeys = [...new Set(
    orderedPlans.flatMap((plan) => Object.keys(plan.features)),
  )].filter((key) => !key.startsWith("max_")).sort();

  return (
    <>
      <header className="marketing-page-hero pricing-hero">
        <div className="landing-container">
          <p className="landing-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{summary}</p>
          <div className="pricing-controls">
            <SubscriptionBillingIntervalSelector
              value={billingInterval}
              onChange={setBillingInterval}
            />
            <p className="subscription-currency-note">All subscription billing is in KES.</p>
          </div>
        </div>
      </header>

      <div className="landing-container pricing-page-content">
        {error && <p className="notice error-notice" role="alert">{error}</p>}
        {loading ? (
          <p className="subscription-loading" role="status">Loading current plans…</p>
        ) : orderedPlans.length === 0 ? (
          <p className="subscription-empty" role="status">Subscription plans are temporarily unavailable.</p>
        ) : (
          <>
            <section className="pricing-plan-grid" aria-label="FlockLedger subscription plans">
              {orderedPlans.map((plan) => {
                const price = formatSubscriptionPlanPrice(plan, billingInterval);
                const trialDays = plan.code === "professional" ? plan.trial_days : 0;
                const action = plan.code === "starter"
                  ? { href: "/signup", label: "Create a free account" }
                  : plan.code === "professional" && trialDays > 0
                    ? { href: "/app?tab=billing", label: `Start ${trialDays}-day free trial` }
                    : plan.code === "enterprise"
                      ? { href: "/contact", label: "Contact us about Enterprise" }
                      : null;

                return (
                  <article className={`pricing-plan-card pricing-plan-${plan.code}`} key={plan.code}>
                    <h2>{plan.name}</h2>
                    <p className="pricing-target">{plan.description}</p>
                    <p className="pricing-price">
                      <strong>{price ?? "Price unavailable"}</strong>
                      {price && price !== "Free" && (
                        <span>/ {billingInterval === "monthly" ? "month" : "year"}</span>
                      )}
                    </p>
                    <p className="pricing-price-note">
                      {trialDays > 0
                        ? `${trialDays}-day trial for eligible Starter farms. No payment is required to start.`
                        : price === null && plan.code !== "starter"
                          ? "Paid plan pricing is not configured. Online purchase is unavailable."
                          : plan.code === "starter"
                            ? "No payment required."
                            : "Billing changes are not available online."}
                    </p>
                    {action ? (
                      <Link
                        className={`landing-button ${plan.code === "starter" ? "pricing-outline-button" : "landing-button-amber"}`}
                        href={action.href}
                      >
                        {action.label}
                      </Link>
                    ) : (
                      <button className="landing-button pricing-unavailable-button" type="button" disabled>
                        Price unavailable
                      </button>
                    )}
                    <h3 className="pricing-list-heading">Plan features</h3>
                    <ul className="pricing-feature-list">
                      {Object.entries(plan.features)
                        .filter(([key, feature]) => !key.startsWith("max_") && feature.enabled)
                        .map(([key]) => (
                          <li key={key}>
                            <span aria-hidden="true">✓</span>
                            {subscriptionFeatureLabel(key)}
                          </li>
                        ))}
                    </ul>
                    <dl className="pricing-plan-limits">
                      <div>
                        <dt>Active batches</dt>
                        <dd>{subscriptionLimitLabel(plan, "max_active_batches")}</dd>
                      </div>
                      <div>
                        <dt>Additional staff</dt>
                        <dd>{subscriptionLimitLabel(plan, "max_staff_users")}</dd>
                      </div>
                      <div>
                        <dt>Storage</dt>
                        <dd>{subscriptionLimitLabel(plan, "max_storage_mb")}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </section>

            <details className="pricing-comparison">
              <summary>Compare plan features</summary>
              <div className="pricing-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Feature</th>
                      {orderedPlans.map((plan) => <th scope="col" key={plan.code}>{plan.name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {featureKeys.map((key) => (
                      <tr key={key}>
                        <th scope="row">{subscriptionFeatureLabel(key)}</th>
                        {orderedPlans.map((plan) => (
                          <td key={plan.code}>
                            {plan.features[key]?.enabled ? "Included" : "Not included"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}

        <section className="pricing-faq-section" aria-labelledby="pricing-faq-title">
          <h2 id="pricing-faq-title">Subscription questions</h2>
          <div className="marketing-faq-list">
            <details>
              <summary>Can I start a Professional trial?</summary>
              <p>Eligible Starter farms can request the trial from the farm billing dashboard. The server checks eligibility, and no payment is required to start.</p>
            </details>
            <details>
              <summary>Can I purchase a paid plan online?</summary>
              <p>Paid prices are not configured and checkout is not available. No payment will be collected from this page.</p>
            </details>
            <details>
              <summary>Who can manage billing?</summary>
              <p>Farm members can view their farm’s entitlements. Only the farm owner can start a trial or request cancellation.</p>
            </details>
            <details>
              <summary>What happens after cancellation?</summary>
              <p>Cancellation takes effect at the date shown in the billing dashboard. Farm records and membership are retained.</p>
            </details>
          </div>
        </section>

        <section className="marketing-inline-cta pricing-final-cta">
          <div>
            <p>Start with your farm’s current subscription options.</p>
            <h2>Manage plans and trials from your farm workspace.</h2>
          </div>
          <Link className="landing-button landing-button-amber landing-button-large" href="/app?tab=billing">
            Open farm billing
          </Link>
        </section>
      </div>
    </>
  );
}
