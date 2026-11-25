"use client";

import { useEffect, useState } from "react";
import { RequestError, request } from "@/lib/client/request";
import type {
  BillingInterval,
  FarmEntitlements,
  SubscriptionPlan,
  SubscriptionUsage,
} from "@/lib/subscriptions/service";
import {
  formatSubscriptionDate,
  formatSubscriptionPlanPrice,
  subscriptionFeatureLabel,
  SubscriptionBillingIntervalSelector,
} from "@/components/subscription-ui";

type FarmSubscriptionPageProps = {
  farmId: string;
  farmName: string;
  farmRole: string;
};

type SubscriptionPageData = {
  entitlements: FarmEntitlements;
  usage: SubscriptionUsage;
  plans: SubscriptionPlan[];
  plansError: string;
};

type SubscriptionLoadResult = {
  key: string;
  data?: SubscriptionPageData;
  error?: string;
};

type SubscriptionResponse<T> = { data: T };

type CancellationResponse = {
  id: string;
  farmId: string;
  status: string;
  cancelAtPeriodEnd: true;
  effectiveAt: string;
};

const planOrder = ["starter", "professional", "enterprise"] as const;
const cancellableStatuses = ["trialing", "active", "past_due", "grace_period"];

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof RequestError || error instanceof Error) return error.message;
  return fallback;
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function limitText(
  entitlements: FarmEntitlements,
  key: "max_active_batches" | "max_staff_users" | "max_storage_mb",
  usage: number,
  unit: string,
) {
  if (!Object.prototype.hasOwnProperty.call(entitlements.limits, key)) {
    return `${usage} ${unit} · limit not configured`;
  }
  const limit = entitlements.limits[key];
  if (limit === null) return `${usage} ${unit} · no configured cap`;
  return `${usage} of ${new Intl.NumberFormat("en-KE").format(limit)} ${unit}`;
}

function trialProgress(entitlements: FarmEntitlements) {
  const { trialStartedAt, trialEndsAt } = entitlements.subscription;
  if (!trialStartedAt || !trialEndsAt) return 0;
  const start = new Date(trialStartedAt).getTime();
  const end = new Date(trialEndsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.min(100, Math.max(0, ((Date.now() - start) / (end - start)) * 100));
}

function hasTrialExpired(trialEnd: string | null) {
  return trialEnd !== null && Date.parse(trialEnd) <= Date.now();
}

export default function FarmSubscriptionPage({
  farmId,
  farmName,
  farmRole,
}: FarmSubscriptionPageProps) {
  const [loadResult, setLoadResult] = useState<SubscriptionLoadResult | null>(null);
  const [notice, setNotice] = useState<{ farmId: string; message: string } | null>(null);
  const [actionError, setActionError] = useState<{ farmId: string; message: string } | null>(null);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("monthly");
  const [actionBusy, setActionBusy] = useState<"trial" | "cancel" | null>(null);
  const [showCancellationConfirmation, setShowCancellationConfirmation] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const isOwner = farmRole === "owner";
  const loadKey = `${farmId}:${refreshVersion}`;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const farmPath = `/api/farms/${encodeURIComponent(farmId)}/subscription`;
    const load = Promise.allSettled([
      request<SubscriptionResponse<FarmEntitlements>>(farmPath, { signal: controller.signal }),
      request<SubscriptionResponse<SubscriptionUsage>>(`${farmPath}/usage`, { signal: controller.signal }),
      request<SubscriptionResponse<SubscriptionPlan[]>>("/api/subscription-plans", { signal: controller.signal }),
    ]);

    void load.then(([entitlementResult, usageResult, plansResult]) => {
      if (!active) return;
      if (entitlementResult.status === "rejected") throw entitlementResult.reason;
      if (usageResult.status === "rejected") throw usageResult.reason;

      const entitlements = entitlementResult.value.data;
      const usage = usageResult.value.data;
      if (entitlements.farmId !== farmId || usage.farmId !== farmId) {
        throw new Error("The subscription response did not match the selected farm.");
      }

      const plansError = plansResult.status === "rejected"
        ? getErrorMessage(plansResult.reason, "Could not load available plan options.")
        : "";
      setLoadResult({
        key: loadKey,
        data: {
          entitlements,
          usage,
          plans: plansResult.status === "fulfilled" ? plansResult.value.data : [],
          plansError,
        },
      });
      if (entitlements.subscription.billingInterval) {
        setBillingInterval(entitlements.subscription.billingInterval);
      }
    }).catch((loadError: unknown) => {
      if (active && !controller.signal.aborted) {
        setLoadResult({
          key: loadKey,
          error: getErrorMessage(loadError, "Could not load this farm's subscription."),
        });
      }
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [farmId, loadKey]);

  async function handleStartTrial() {
    setActionBusy("trial");
    setActionError(null);
    setNotice(null);
    try {
      await request<SubscriptionResponse<{
        id: string;
        farmId: string;
        planCode: "professional";
        status: "trialing";
        trialStartedAt: string;
        trialEndsAt: string;
      }>>(`/api/farms/${encodeURIComponent(farmId)}/subscription`, {
        method: "POST",
      });
      setNotice({ farmId, message: "The Professional trial has started." });
      setRefreshVersion((version) => version + 1);
    } catch (trialError) {
      setActionError({
        farmId,
        message: getErrorMessage(trialError, "Could not start the Professional trial."),
      });
    } finally {
      setActionBusy(null);
    }
  }

  async function handleCancellation() {
    setActionBusy("cancel");
    setActionError(null);
    setNotice(null);
    try {
      const result = await request<SubscriptionResponse<CancellationResponse>>(
        `/api/farms/${encodeURIComponent(farmId)}/subscription/cancel`,
        { method: "POST" },
      );
      setShowCancellationConfirmation(false);
      setNotice({
        farmId,
        message: `Cancellation is scheduled for ${formatSubscriptionDate(result.data.effectiveAt)}.`,
      });
      setRefreshVersion((version) => version + 1);
    } catch (cancellationError) {
      setActionError({
        farmId,
        message: getErrorMessage(cancellationError, "Could not schedule cancellation."),
      });
    } finally {
      setActionBusy(null);
    }
  }

  const currentLoad = loadResult?.key === loadKey ? loadResult : null;
  if (!currentLoad) {
    return <p className="subscription-loading" role="status">Loading billing for {farmName}…</p>;
  }
  if (currentLoad.error || !currentLoad.data) {
    return (
      <section className="subscription-page" aria-labelledby="subscription-page-title">
        <h1 id="subscription-page-title">Billing</h1>
        <p className="notice error-notice" role="alert">{currentLoad.error || "Could not load this farm's subscription."}</p>
        <button className="button button-secondary" type="button" onClick={() => setRefreshVersion((version) => version + 1)}>
          Try again
        </button>
      </section>
    );
  }

  const { entitlements, usage, plans, plansError } = currentLoad.data;
  const subscription = entitlements.subscription;
  const currentPlanName = entitlements.effectivePlan.name;
  const isTrialing = subscription.status === "trialing";
  const historicalTrialEnd = entitlements.professionalTrialHistory.trialEndsAt;
  const historicalTrialExpired = hasTrialExpired(historicalTrialEnd);
  const currentIsStarter = entitlements.effectivePlan.code === "starter"
    && subscription.planCode === "starter";
  const canCancel = isOwner
    && subscription.planCode !== "starter"
    && cancellableStatuses.includes(subscription.status)
    && !subscription.cancelAtPeriodEnd;
  const professionalPlan = plans.find((plan) => plan.code === "professional");
  const trialDays = professionalPlan?.trial_days ?? 0;
  const rank = planOrder.indexOf(entitlements.effectivePlan.code);
  const upgradePlans = plans
    .filter((plan) => planOrder.indexOf(plan.code) > rank)
    .sort((first, second) => planOrder.indexOf(first.code) - planOrder.indexOf(second.code));
  const effectiveEndDate = subscription.currentPeriodEnd ?? subscription.trialEndsAt;
  const features = Object.entries(entitlements.features)
    .filter(([key]) => !key.startsWith("max_"))
    .sort(([first], [second]) => first.localeCompare(second));

  return (
    <main className="subscription-page" aria-labelledby="subscription-page-title">
      <header className="subscription-page-heading">
        <div>
          <p className="eyebrow">FARM BILLING</p>
          <h1 id="subscription-page-title">{farmName} subscription</h1>
          <p>View this farm’s plan, entitlements, usage, and subscription dates.</p>
        </div>
        <span className="subscription-role-badge">{isOwner ? "Owner billing access" : "View only"}</span>
      </header>

      {notice?.farmId === farmId && <p className="notice success-notice" role="status">{notice.message}</p>}
      {actionError?.farmId === farmId && <p className="notice error-notice" role="alert">{actionError.message}</p>}

      <div className="subscription-summary-grid">
        <section className="subscription-card subscription-current-card">
          <div className="subscription-card-heading">
            <div>
              <p className="subscription-card-kicker">CURRENT EFFECTIVE PLAN</p>
              <h2>{currentPlanName}</h2>
            </div>
            <span className={`subscription-status subscription-status-${subscription.status}`}>
              {formatStatus(subscription.status)}
            </span>
          </div>
          {subscription.planCode !== entitlements.effectivePlan.code && (
            <p className="subscription-supporting-copy">
              Subscription record: {subscription.planCode}. Current entitlements use {currentPlanName}.
            </p>
          )}
          <dl className="subscription-details">
            <div><dt>Billing interval</dt><dd>{subscription.billingInterval ? formatStatus(subscription.billingInterval) : "Not set"}</dd></div>
            <div><dt>Subscription started</dt><dd>{formatSubscriptionDate(subscription.startedAt)}</dd></div>
            <div><dt>Current period starts</dt><dd>{formatSubscriptionDate(subscription.currentPeriodStart)}</dd></div>
            <div><dt>Current period ends</dt><dd>{formatSubscriptionDate(subscription.currentPeriodEnd)}</dd></div>
            <div><dt>Cancellation</dt><dd>{subscription.cancelAtPeriodEnd ? "Scheduled" : "Not scheduled"}</dd></div>
          </dl>
          {subscription.cancelAtPeriodEnd && effectiveEndDate && (
            <p className="subscription-effective-date">
              This subscription will end on {formatSubscriptionDate(effectiveEndDate)}. The farm then returns to Starter; farm data is retained.
            </p>
          )}
          {canCancel && (
            <button className="button button-secondary subscription-cancel-button" type="button" onClick={() => setShowCancellationConfirmation(true)}>
              Request cancellation
            </button>
          )}
          {!isOwner && (
            <p className="subscription-supporting-copy">Only the farm owner can manage trials or request cancellation.</p>
          )}
        </section>

        <section className="subscription-card subscription-trial-card" aria-labelledby="subscription-trial-title">
          <p className="subscription-card-kicker">PROFESSIONAL TRIAL</p>
          <h2 id="subscription-trial-title">{isTrialing ? "Your trial is active" : "Try Professional"}</h2>
          {isTrialing ? (
            <>
              <p>Started {formatSubscriptionDate(subscription.trialStartedAt)} · expires {formatSubscriptionDate(subscription.trialEndsAt)}.</p>
              <progress
                className="subscription-trial-progress"
                max={100}
                value={trialProgress(entitlements)}
                aria-label="Professional trial progress"
              />
              <p className="subscription-supporting-copy">
                Trial access ends {formatSubscriptionDate(subscription.trialEndsAt)}. Your farm data is retained if the plan expires.
              </p>
            </>
          ) : entitlements.trialAvailable ? (
            <>
              <p>{trialDays > 0 ? `${trialDays} days, with no payment required to start.` : "A trial is not configured for this plan."}</p>
              {isOwner && trialDays > 0 ? (
                <button className="button button-primary" type="button" onClick={() => void handleStartTrial()} disabled={actionBusy !== null}>
                  {actionBusy === "trial" ? "Starting trial…" : `Start ${trialDays}-day trial`}
                </button>
              ) : !isOwner ? (
                <p className="subscription-supporting-copy">Ask the farm owner to start this trial.</p>
              ) : (
                <p className="subscription-supporting-copy">The trial is not currently configured.</p>
              )}
            </>
          ) : currentIsStarter ? (
            <p role="status">
              {historicalTrialExpired
                ? `The farm's one-time Professional trial expired on ${formatSubscriptionDate(historicalTrialEnd)} and cannot be restarted.`
                : "This farm has already used its one-time Professional trial and is on Starter."}
            </p>
          ) : !entitlements.trialAvailable && historicalTrialEnd ? (
            <p role="status">
              {historicalTrialExpired
                ? `The Professional trial expired on ${formatSubscriptionDate(historicalTrialEnd)} and cannot be restarted.`
                : "The one-time Professional trial has been used and cannot be restarted."}
            </p>
          ) : (
            <p role="status">A trial is not available for the farm’s current subscription.</p>
          )}
        </section>
      </div>

      <section className="subscription-card" aria-labelledby="subscription-usage-title">
        <div className="subscription-section-heading">
          <div>
            <p className="subscription-card-kicker">CURRENT RESOURCE USE</p>
            <h2 id="subscription-usage-title">Usage and plan limits</h2>
          </div>
        </div>
        <dl className="subscription-usage-grid">
          <div><dt>Active batches</dt><dd>{limitText(entitlements, "max_active_batches", usage.activeBatches, "batches")}</dd></div>
          <div><dt>Additional staff</dt><dd>{limitText(entitlements, "max_staff_users", usage.staffUsers, "people")}</dd></div>
          <div><dt>Storage</dt><dd>{limitText(entitlements, "max_storage_mb", usage.storageMb, "MB")}</dd></div>
        </dl>
        <p className="subscription-supporting-copy">
          Usage is shown for information. Subscription limits are not yet enforced on every resource-creation operation.
        </p>
      </section>

      <section className="subscription-card" aria-labelledby="subscription-entitlements-title">
        <p className="subscription-card-kicker">CURRENT ENTITLEMENTS</p>
        <h2 id="subscription-entitlements-title">Features on {currentPlanName}</h2>
        {features.length === 0 ? (
          <p className="subscription-supporting-copy">No feature entitlements are configured.</p>
        ) : (
          <ul className="subscription-entitlement-list">
            {features.map(([key, feature]) => (
              <li className={feature.enabled ? "is-enabled" : "is-disabled"} key={key}>
                <span aria-hidden="true">{feature.enabled ? "✓" : "—"}</span>
                <span>{subscriptionFeatureLabel(key)}</span>
                <strong>{feature.enabled ? "Included" : "Not included"}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="subscription-card" aria-labelledby="subscription-upgrades-title">
        <div className="subscription-section-heading">
          <div>
            <p className="subscription-card-kicker">PLAN OPTIONS</p>
            <h2 id="subscription-upgrades-title">Available upgrades</h2>
          </div>
          <SubscriptionBillingIntervalSelector value={billingInterval} onChange={setBillingInterval} />
        </div>
        <p className="subscription-supporting-copy">
          Selecting an interval only changes the displayed price; it does not change the farm subscription. Online checkout is not available.
        </p>
        {plansError && <p className="inline-error" role="alert">{plansError}</p>}
        {!plansError && plans.length === 0 ? (
          <p className="subscription-empty">No subscription plan options are configured yet.</p>
        ) : !plansError && upgradePlans.length === 0 ? (
          <p className="subscription-empty">This farm is already on the highest listed plan.</p>
        ) : (
          <div className="subscription-upgrade-grid">
            {upgradePlans.map((plan) => {
              const price = formatSubscriptionPlanPrice(plan, billingInterval);
              const isProfessionalTrial = plan.code === "professional" && plan.trial_days > 0;
              return (
                <article className="subscription-upgrade-option" key={plan.code}>
                  <h3>{plan.name}</h3>
                  <p>{plan.description}</p>
                  <strong>{price ?? "Price unavailable"}</strong>
                  <p className="subscription-supporting-copy">
                    {isProfessionalTrial
                      ? `${plan.trial_days}-day no-payment trial may be available above.`
                      : "Paid plan changes are unavailable until pricing and checkout are configured."}
                  </p>
                  {plan.code === "enterprise" && (
                    <a className="subscription-contact-link" href="/contact">Contact us about Enterprise</a>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {showCancellationConfirmation && (
        <div
          className="subscription-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && actionBusy !== "cancel") {
              setShowCancellationConfirmation(false);
            }
          }}
        >
          <section
            className="subscription-confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="subscription-cancel-title"
          >
            <p className="subscription-card-kicker">CONFIRM CANCELLATION</p>
            <h2 id="subscription-cancel-title">Request cancellation for {farmName}?</h2>
            <p>
              The current plan remains in effect until {formatSubscriptionDate(effectiveEndDate)}. At that date, the farm returns to Starter and its records are retained.
            </p>
            <div className="subscription-dialog-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setShowCancellationConfirmation(false)}
                disabled={actionBusy === "cancel"}
              >
                Keep subscription
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={() => void handleCancellation()}
                disabled={actionBusy !== null}
              >
                {actionBusy === "cancel" ? "Scheduling…" : "Confirm cancellation"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
