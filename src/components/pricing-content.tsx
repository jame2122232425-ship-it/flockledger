"use client";

import { useState } from "react";
import Link from "next/link";

type BillingPeriod = "monthly" | "yearly";
type Currency = "KES" | "USD";

const USD_PER_KES = 0.007694;
const USD_RATE_AS_OF = "22 Nov 2026";

function formatUsd(kesAmount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(kesAmount * USD_PER_KES);
}

const plans = [
  {
    name: "Starter",
    target: "Hobby farmers and single-house operations.",
    features: [
      { label: "1 active batch at a time", included: true },
      { label: "1 user account (Owner only)", included: true },
      { label: "Daily mortality, feed, and water records", included: true },
      { label: "Basic dashboard (mortality %)", included: true },
      { label: "Health and withdrawal alerts", included: false },
      { label: "Financial tracking (cash book and sales)", included: false },
      { label: "Staff roles and permissions", included: false },
    ],
  },
  {
    name: "Professional",
    target: "Commercial broiler and kienyeji farms.",
    popular: true,
    features: [
      { label: "Unlimited active batches", included: true },
      { label: "Up to 5 users (Owner, Manager, Attendant, Vet)", included: true },
      { label: "Everything in Starter, plus:", included: true },
      { label: "Health and medication log with safe-sale dates", included: true },
      { label: "Batch financials: revenue, expenses, and profit per bird", included: true },
      { label: "Feed stock and inventory management", included: true },
      { label: "Automated FCR and EPEF calculations", included: true },
      { label: "Excel and PDF report exports", included: true },
    ],
  },
  {
    name: "Enterprise",
    target: "Multi-farm operations and large integrators.",
    features: [
      { label: "Unlimited batches and users", included: true },
      { label: "Multi-farm management across locations", included: true },
      { label: "Everything in Professional, plus:", included: true },
      { label: "Dedicated account manager", included: true },
      { label: "API access for accounting integrations", included: true },
      { label: "Custom reporting and data exports", included: true },
      { label: "Priority WhatsApp and phone support", included: true },
    ],
  },
];

const comparisonRows = [
  { feature: "Active batches", starter: "1 at a time", professional: "Unlimited", enterprise: "Unlimited" },
  { feature: "User accounts", starter: "1 (Owner)", professional: "Up to 5", enterprise: "Unlimited" },
  { feature: "Daily mortality, feed, and water records", starter: "Included", professional: "Included", enterprise: "Included" },
  { feature: "Dashboard", starter: "Mortality %", professional: "Full", enterprise: "Full" },
  { feature: "Health and withdrawal alerts", starter: "—", professional: "Included", enterprise: "Included" },
  { feature: "Financial tracking and cash book", starter: "—", professional: "Included", enterprise: "Included" },
  { feature: "Feed stock and inventory", starter: "—", professional: "Included", enterprise: "Included" },
  { feature: "FCR and EPEF calculations", starter: "—", professional: "Included", enterprise: "Included" },
  { feature: "Excel and PDF reports", starter: "—", professional: "Included", enterprise: "Custom exports" },
  { feature: "Offline entry and sync", starter: "—", professional: "Included", enterprise: "Included" },
  { feature: "SMS alerts", starter: "—", professional: "—", enterprise: "—" },
  { feature: "Multi-farm management", starter: "—", professional: "—", enterprise: "Included" },
  { feature: "API access", starter: "—", professional: "—", enterprise: "Included" },
  { feature: "Dedicated account manager", starter: "—", professional: "—", enterprise: "Included" },
  { feature: "Priority WhatsApp and phone support", starter: "—", professional: "—", enterprise: "Included" },
];

export default function PricingContent({
  eyebrow,
  title,
  summary,
}: {
  eyebrow: string;
  title: string;
  summary: string;
}) {
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");
  const [currency, setCurrency] = useState<Currency>("KES");
  const professionalPrice = currency === "KES"
    ? billingPeriod === "monthly" ? "KES 1,500" : "KES 14,400"
    : formatUsd(billingPeriod === "monthly" ? 1_500 : 14_400);
  const professionalPeriod = billingPeriod === "monthly" ? "/ month" : "/ year";

  return (
    <>
      <header className="marketing-page-hero pricing-hero">
        <div className="landing-container">
          <p className="landing-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{summary}</p>
          <div className="pricing-controls">
            <div className="pricing-control-group" role="group" aria-label="Billing period">
              <button
                type="button"
                className={billingPeriod === "monthly" ? "is-active" : ""}
                aria-pressed={billingPeriod === "monthly"}
                onClick={() => setBillingPeriod("monthly")}
              >
                Monthly
              </button>
              <button
                type="button"
                className={billingPeriod === "yearly" ? "is-active" : ""}
                aria-pressed={billingPeriod === "yearly"}
                onClick={() => setBillingPeriod("yearly")}
              >
                Yearly <span>Save 20%</span>
              </button>
            </div>
            <div className="pricing-control-group pricing-currency-control" role="group" aria-label="Pricing currency">
              <button
                type="button"
                className={currency === "KES" ? "is-active" : ""}
                aria-pressed={currency === "KES"}
                onClick={() => setCurrency("KES")}
              >
                KES
              </button>
              <button
                type="button"
                className={currency === "USD" ? "is-active" : ""}
                aria-pressed={currency === "USD"}
                onClick={() => setCurrency("USD")}
              >
                USD
              </button>
            </div>
          </div>
          {currency === "USD" && (
            <p className="pricing-currency-note">
              Approximate conversion at KES 129.97 = USD 1, updated {USD_RATE_AS_OF}. Billing remains in KES.
            </p>
          )}
        </div>
      </header>

      <div className="landing-container pricing-page-content">
        <section className="pricing-plan-grid" aria-label="FlockLedger plans">
          {plans.map((plan) => {
            const price = plan.name === "Starter"
              ? currency === "KES" ? "KES 0" : "Free"
              : plan.name === "Professional"
                ? professionalPrice
                : "Custom";
            const period = plan.name === "Starter"
              ? currency === "KES" ? "/ month" : ""
              : plan.name === "Professional" ? professionalPeriod : "";
            const priceNote = plan.name === "Professional"
              ? currency === "USD"
                ? billingPeriod === "yearly"
                  ? `${formatUsd(14_400 / 12)} per month, billed yearly.`
                  : "Approximate conversion; final billing remains in KES."
                : billingPeriod === "yearly"
                  ? "KES 1,200 per month, billed yearly."
                  : "Billed monthly. No hidden fees."
              : plan.name === "Enterprise"
                ? "Tailored to your operation."
                : "No credit card required.";
            const href = plan.name === "Enterprise"
              ? "mailto:support@flockledger.co.ke?subject=FlockLedger%20Enterprise"
              : "/signup";
            const actionLabel = plan.name === "Starter"
              ? "Start for Free"
              : plan.name === "Professional"
                ? "Start 14-Day Free Trial"
                : "Contact Sales";

            return (
              <article
                className={`pricing-plan-card${plan.popular ? " pricing-plan-popular" : ""}`}
                key={plan.name}
              >
                {plan.popular && <span className="pricing-recommended">Recommended · Most popular</span>}
                <h2>{plan.name}</h2>
                <p className="pricing-target">{plan.target}</p>
                <p className="pricing-price">
                  <strong>{price}</strong>
                  {period && <span>{period}</span>}
                </p>
                <p className="pricing-price-note">{priceNote}</p>
                <Link
                  className={`landing-button ${plan.name === "Starter" ? "pricing-outline-button" : "landing-button-amber"}`}
                  href={href}
                >
                  {actionLabel}
                </Link>
                <ul className="pricing-feature-list">
                  {plan.features.map((feature) => (
                    <li
                      className={feature.included ? "" : "pricing-feature-excluded"}
                      aria-label={`${feature.included ? "Included" : "Not included"}: ${feature.label}`}
                      key={feature.label}
                    >
                      <span aria-hidden="true">{feature.included ? "✓" : "×"}</span>
                      {feature.label}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </section>

        <details className="pricing-comparison">
          <summary>Compare all plan features</summary>
          <div className="pricing-table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  <th scope="col">Starter</th>
                  <th scope="col">Professional</th>
                  <th scope="col">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.feature}>
                    <th scope="row">{row.feature}</th>
                    <td>{row.starter}</td>
                    <td>{row.professional}</td>
                    <td>{row.enterprise}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        <section className="pricing-faq-section" aria-labelledby="pricing-faq-title">
          <h2 id="pricing-faq-title">Pricing questions, answered</h2>
          <div className="marketing-faq-list">
            <details>
              <summary>Can I change plans later?</summary>
              <p>Yes. You can upgrade or downgrade at any time, and changes are prorated.</p>
            </details>
            <details>
              <summary>What happens if my batch runs longer than a month?</summary>
              <p>You pay for each month of software access, not per batch. Your data stays intact while your subscription is active.</p>
            </details>
            <details>
              <summary>Do I need internet in the poultry house?</summary>
              <p>The app is designed for mobile data. Professional includes Progressive Web App caching so you can enter records offline and sync when you reconnect.</p>
            </details>
            <details>
              <summary>Is my financial data secure?</summary>
              <p>We use bank-level encryption. Financial data is visible only to the Owner and Accountant roles you assign.</p>
            </details>
          </div>
        </section>

        <section className="marketing-inline-cta pricing-final-cta">
          <div>
            <p>Ready to know your exact profit per bird?</p>
            <h2>Create your free farm account today.</h2>
          </div>
          <Link className="landing-button landing-button-amber landing-button-large" href="/signup">
            Create Your Free Account Today
          </Link>
        </section>
      </div>
    </>
  );
}
