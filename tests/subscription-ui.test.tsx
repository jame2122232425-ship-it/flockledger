/* @vitest-environment jsdom */

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FarmSubscriptionPage from "../src/components/farm-subscription-page";
import PricingContent from "../src/components/pricing-content";
import type {
  FarmEntitlements,
  SubscriptionPlan,
  SubscriptionUsage,
} from "../src/lib/subscriptions/service";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("@/lib/client/request", () => ({
  request: requestMock,
  RequestError: class RequestError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => <a href={href} {...props}>{children}</a>,
}));

const farmOneId = "10000000-0000-4000-8000-000000000001";
const farmTwoId = "10000000-0000-4000-8000-000000000002";
const subscriptionId = "20000000-0000-4000-8000-000000000001";
const now = "2026-11-24T09:00:00.000Z";
const later = "2026-12-08T09:00:00.000Z";

function createPlan(
  code: SubscriptionPlan["code"],
  name: string,
  amountMinor: number | null,
  trialDays = 0,
): SubscriptionPlan {
  const staffLimit = code === "starter" ? 2 : code === "professional" ? 10 : null;
  const batchLimit = code === "starter" ? 2 : code === "professional" ? 10 : null;
  return {
    code,
    name,
    description: `${name} plan from the catalog.`,
    trial_days: trialDays,
    features: {
      daily_records: { enabled: true, limitValue: null, configurable: false },
      advanced_analytics: { enabled: code !== "starter", limitValue: null, configurable: false },
      max_active_batches: { enabled: true, limitValue: batchLimit, configurable: false },
      max_staff_users: {
        enabled: true,
        limitValue: staffLimit,
        configurable: code === "enterprise",
      },
      max_storage_mb: {
        enabled: true,
        limitValue: null,
        configurable: code === "enterprise",
      },
    },
    prices: [
      { billingInterval: "monthly", currency: "KES", amountMinor },
      { billingInterval: "annual", currency: "KES", amountMinor },
    ],
  };
}

const plans = [
  createPlan("starter", "Starter", 0),
  createPlan("professional", "Professional", null, 14),
  createPlan("enterprise", "Enterprise", null),
];

function createEntitlements({
  farmId = farmOneId,
  planCode = "starter",
  status = "active",
  trialAvailable = true,
  cancelAtPeriodEnd = false,
  trialStartedAt = null,
  trialEndsAt = null,
  professionalTrialHistory = { trialStartedAt: null, trialEndsAt: null },
}: {
  farmId?: string;
  planCode?: FarmEntitlements["subscription"]["planCode"];
  status?: FarmEntitlements["subscription"]["status"];
  trialAvailable?: boolean;
  cancelAtPeriodEnd?: boolean;
  trialStartedAt?: string | null;
  trialEndsAt?: string | null;
  professionalTrialHistory?: FarmEntitlements["professionalTrialHistory"];
} = {}): FarmEntitlements {
  const plan = plans.find((candidate) => candidate.code === planCode) ?? plans[0];
  return {
    farmId,
    subscription: {
      id: subscriptionId,
      planCode,
      status,
      billingInterval: status === "active" && planCode !== "starter" ? "monthly" : null,
      startedAt: now,
      trialStartedAt,
      trialEndsAt,
      currentPeriodStart: planCode === "starter" ? null : now,
      currentPeriodEnd: planCode === "starter" ? null : later,
      cancelAtPeriodEnd,
      canceledAt: null,
      endedAt: null,
    },
    effectivePlan: { code: planCode, name: plan.name },
    features: {
      daily_records: { enabled: true, configuration: {} },
      advanced_analytics: { enabled: planCode !== "starter", configuration: {} },
    },
    limits: {
      max_active_batches: plan.features.max_active_batches.limitValue,
      max_staff_users: plan.features.max_staff_users.limitValue,
      max_storage_mb: null,
    },
    trialAvailable,
    professionalTrialHistory,
  };
}

function createUsage(farmId: string): SubscriptionUsage {
  return {
    farmId,
    subscriptionId,
    activeBatches: 1,
    staffUsers: 1,
    storageMb: 24,
  };
}

function setBillingResponses(
  entitlements: FarmEntitlements,
  usage = createUsage(entitlements.farmId),
  catalog: SubscriptionPlan[] = plans,
) {
  requestMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/subscription-plans") return { data: catalog };
    if (url.endsWith("/subscription/usage")) return { data: usage };
    if (url.endsWith("/subscription/cancel") && init?.method === "POST") {
      return { data: { id: subscriptionId, farmId: entitlements.farmId, status: "active", cancelAtPeriodEnd: true, effectiveAt: later } };
    }
    if (url.endsWith("/subscription") && init?.method === "POST") {
      return { data: { id: subscriptionId, farmId: entitlements.farmId, planCode: "professional", status: "trialing", trialStartedAt: now, trialEndsAt: later } };
    }
    if (url.endsWith("/subscription")) return { data: entitlements };
    throw new Error(`Unexpected API request: ${url}`);
  });
}

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("subscription pricing UI", () => {
  it("renders database plans, descriptions, feature and limit information", async () => {
    requestMock.mockResolvedValue({ data: plans });
    render(<PricingContent eyebrow="Plans" title="Subscription options" summary="Compare plans." />);

    expect(await screen.findByRole("heading", { name: "Starter" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Professional" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Enterprise" })).toBeTruthy();
    expect(screen.getByText("Starter plan from the catalog.")).toBeTruthy();
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/14-day trial for eligible Starter farms/)).toBeTruthy();
  });

  it("switches monthly and annual intervals and shows unavailable prices without checkout", async () => {
    const pricedPlans = plans.map((plan) => plan.code === "professional"
      ? {
          ...plan,
          prices: [
            { billingInterval: "monthly" as const, currency: "KES" as const, amountMinor: 1234 },
            { billingInterval: "annual" as const, currency: "KES" as const, amountMinor: 5678 },
          ],
        }
      : plan);
    requestMock.mockResolvedValue({ data: pricedPlans });
    render(<PricingContent eyebrow="Plans" title="Subscription options" summary="Compare plans." />);

    const monthly = await screen.findByRole("button", { name: "Monthly" });
    const annual = screen.getByRole("button", { name: "Annual" });
    expect(monthly.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("KES 12.34")).toBeTruthy();
    fireEvent.click(annual);
    expect(annual.getAttribute("aria-pressed")).toBe("true");
    expect(monthly.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("KES 56.78")).toBeTruthy();
    expect(screen.getAllByText("Price unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText(/online purchase is unavailable/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start 14-day free trial" })).toBeTruthy();
    expect(screen.getByText("All subscription billing is in KES.")).toBeTruthy();
  });

  it("shows loading and empty states for the public plan catalog", async () => {
    let resolveCatalog: ((value: { data: SubscriptionPlan[] }) => void) | undefined;
    requestMock.mockReturnValue(new Promise((resolve) => {
      resolveCatalog = resolve;
    }));
    const view = render(<PricingContent eyebrow="Plans" title="Subscription options" summary="Compare plans." />);
    expect(screen.getByRole("status").textContent).toContain("Loading current plans");
    resolveCatalog?.({ data: [] });
    expect(await screen.findByText("Subscription plans are temporarily unavailable.")).toBeTruthy();
    view.unmount();
  });

  it("surfaces plan-catalog API errors", async () => {
    requestMock.mockRejectedValue(new Error("Plan catalog is temporarily unavailable."));
    render(<PricingContent eyebrow="Plans" title="Subscription options" summary="Compare plans." />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("farm billing UI", () => {
  it("shows the selected farm's status, usage, and current entitlements", async () => {
    setBillingResponses(createEntitlements({
      planCode: "professional",
      status: "active",
      trialAvailable: false,
    }));
    render(<FarmSubscriptionPage farmId={farmOneId} farmName="North Farm" farmRole="owner" />);

    expect(await screen.findByRole("heading", { name: "North Farm subscription" })).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("1 of 10 batches · 9 remaining")).toBeTruthy();
    expect(screen.getByText("Advanced analytics")).toBeTruthy();
    expect(screen.getByText("Owner billing access")).toBeTruthy();
  });

  it("shows unlimited limits and clamps remaining capacity to zero when over quota", async () => {
    const entitlements = createEntitlements({
      farmId: farmOneId,
      planCode: "enterprise",
      trialAvailable: false,
    });
    entitlements.limits.max_active_batches = 0;
    entitlements.limits.max_staff_users = null;
    setBillingResponses(entitlements, {
      ...createUsage(farmOneId),
      activeBatches: 1,
      staffUsers: 3,
    });
    render(<FarmSubscriptionPage farmId={farmOneId} farmName="North Farm" farmRole="owner" />);

    expect(await screen.findByText("1 of 0 batches · 0 remaining")).toBeTruthy();
    expect(screen.getByText("3 people · unlimited")).toBeTruthy();
  });

  it("hides billing actions from staff and explains an already-used trial", async () => {
    setBillingResponses(createEntitlements({ trialAvailable: false }));
    render(<FarmSubscriptionPage farmId={farmOneId} farmName="North Farm" farmRole="attendant" />);

    expect(await screen.findByText(/already used its one-time Professional trial/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /start .* trial/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Request cancellation" })).toBeNull();
    expect(screen.getByText(/Only the farm owner can manage trials or request cancellation/)).toBeTruthy();
  });

  it("explains an expired trial cannot restart after the farm returns to Starter", async () => {
    setBillingResponses(createEntitlements({
      trialAvailable: false,
      professionalTrialHistory: {
        trialStartedAt: "2000-11-17T09:00:00.000Z",
        trialEndsAt: "2000-12-01T09:00:00.000Z",
      },
    }));
    render(<FarmSubscriptionPage farmId={farmOneId} farmName="North Farm" farmRole="owner" />);

    expect(await screen.findByText(/one-time Professional trial expired on .* and cannot be restarted/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start 14-day trial" })).toBeNull();
  });

  it("starts an eligible trial and refreshes the farm subscription", async () => {
    let subscriptionReads = 0;
    requestMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/subscription-plans") return { data: plans };
      if (url.endsWith("/subscription/usage")) return { data: createUsage(farmOneId) };
      if (url.endsWith("/subscription") && init?.method === "POST") {
        return { data: { id: subscriptionId, farmId: farmOneId, planCode: "professional", status: "trialing", trialStartedAt: now, trialEndsAt: later } };
      }
      if (url.endsWith("/subscription")) {
        subscriptionReads += 1;
        return {
          data: subscriptionReads === 1
            ? createEntitlements({ trialAvailable: true })
            : createEntitlements({
                planCode: "professional",
                status: "trialing",
                trialAvailable: false,
                trialStartedAt: now,
                trialEndsAt: later,
              }),
        };
      }
      throw new Error(`Unexpected API request: ${url}`);
    });
    render(<FarmSubscriptionPage farmId={farmOneId} farmName="North Farm" farmRole="owner" />);

    fireEvent.click(await screen.findByRole("button", { name: "Start 14-day trial" }));
    expect(screen.getByText("14 days, with no payment required to start.")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Your trial is active" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Professional trial progress" })).toBeTruthy();
    expect(screen.getByText("The Professional trial has started.")).toBeTruthy();
    expect(requestMock).toHaveBeenCalledWith(
      `/api/farms/${farmOneId}/subscription`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("confirms cancellation and refreshes the scheduled cancellation state", async () => {
    let subscriptionReads = 0;
    requestMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/subscription-plans") return { data: plans };
      if (url.endsWith("/subscription/usage")) return { data: createUsage(farmOneId) };
      if (url.endsWith("/subscription/cancel") && init?.method === "POST") {
        return { data: { id: subscriptionId, farmId: farmOneId, status: "active", cancelAtPeriodEnd: true, effectiveAt: later } };
      }
      if (url.endsWith("/subscription")) {
        subscriptionReads += 1;
        return {
          data: createEntitlements({
            planCode: "professional",
            status: "active",
            trialAvailable: false,
            cancelAtPeriodEnd: subscriptionReads > 1,
          }),
        };
      }
      throw new Error(`Unexpected API request: ${url}`);
    });
    render(<FarmSubscriptionPage farmId={farmOneId} farmName="North Farm" farmRole="owner" />);

    fireEvent.click(await screen.findByRole("button", { name: "Request cancellation" }));
    const dialog = await screen.findByRole("dialog", { name: "Request cancellation for North Farm?" });
    expect(within(dialog).getByText(new RegExp(
      `current plan remains in effect until ${new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeZone: "Africa/Nairobi" }).format(new Date(later))}`,
      "i",
    ))).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm cancellation" }));

    expect(await screen.findByText(/Cancellation is scheduled for/)).toBeTruthy();
    expect(await screen.findByText(/This subscription will end on/)).toBeTruthy();
    expect(requestMock).toHaveBeenCalledWith(
      `/api/farms/${farmOneId}/subscription/cancel`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reloads subscription data when the selected farm changes", async () => {
    requestMock.mockImplementation(async (url: string) => {
      if (url === "/api/subscription-plans") return { data: plans };
      if (url.endsWith("/subscription/usage")) {
        const farmId = url.includes(farmTwoId) ? farmTwoId : farmOneId;
        return { data: createUsage(farmId) };
      }
      if (url.endsWith("/subscription")) {
        const farmId = url.includes(farmTwoId) ? farmTwoId : farmOneId;
        return { data: createEntitlements({ farmId, planCode: farmId === farmOneId ? "starter" : "enterprise", trialAvailable: false }) };
      }
      throw new Error(`Unexpected API request: ${url}`);
    });
    const view = render(<FarmSubscriptionPage farmId={farmOneId} farmName="North Farm" farmRole="owner" />);
    expect(await screen.findByRole("heading", { name: "Starter" })).toBeTruthy();

    view.rerender(<FarmSubscriptionPage farmId={farmTwoId} farmName="South Farm" farmRole="owner" />);
    expect(await screen.findByRole("heading", { name: "South Farm subscription" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Enterprise" })).toBeTruthy();
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(`/api/farms/${farmTwoId}/subscription`, expect.anything());
    });
  });

  it("shows authorization and API errors", async () => {
    requestMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/subscription")) throw new Error("You cannot access subscriptions for this farm.");
      if (url.endsWith("/subscription/usage")) return { data: createUsage(farmOneId) };
      return { data: plans };
    });
    render(<FarmSubscriptionPage farmId={farmOneId} farmName="North Farm" farmRole="attendant" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("You cannot access subscriptions for this farm.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("shows loading and action failure states", async () => {
    requestMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/subscription-plans") return { data: plans };
      if (url.endsWith("/subscription/usage")) return { data: createUsage(farmOneId) };
      if (url.endsWith("/subscription") && init?.method === "POST") {
        throw new Error("Trial service is temporarily unavailable.");
      }
      if (url.endsWith("/subscription")) return { data: createEntitlements() };
      throw new Error(`Unexpected API request: ${url}`);
    });
    render(<FarmSubscriptionPage farmId={farmOneId} farmName="North Farm" farmRole="owner" />);

    expect(screen.getByRole("status").textContent).toContain("Loading billing for North Farm");
    fireEvent.click(await screen.findByRole("button", { name: "Start 14-day trial" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Trial service is temporarily unavailable.");
  });

  it("explains an empty plan catalog instead of implying there are no upgrades", async () => {
    setBillingResponses(createEntitlements(), createUsage(farmOneId), []);
    render(<FarmSubscriptionPage farmId={farmOneId} farmName="North Farm" farmRole="owner" />);

    expect(await screen.findByText("No subscription plan options are configured yet.")).toBeTruthy();
    expect(screen.queryByText("This farm is already on the highest listed plan.")).toBeNull();
  });
});
