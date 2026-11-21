"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { dailyRecordCreateSchema } from "@/lib/validation/daily-records";

type Farm = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  opening_cash_balance_kes: number;
  role: string;
};

type Batch = {
  batch_id: string;
  batch_code: string;
  batch_type: "Broiler" | "Kienyeji";
  house: string | null;
  date_placed: string;
  chicks_received: number;
  status: "running" | "closed";
  dead: number;
  culled: number;
  birds_sold: number;
  feed_consumed_kg: number;
  revenue_kes: number;
  outstanding_kes: number;
  fcr: number | null;
  mortality_percent: number;
  age_days: number;
};

type DailyRecord = {
  id: string;
  batch_id: string;
  record_date: string;
  dead: number;
  culled: number;
  feed_given_kg: number;
  feed_left_kg: number;
  water_liters: number;
  temp_min_c: number | null;
  temp_max_c: number | null;
  litter: string | null;
  remarks: string | null;
  initials: string | null;
};

type FarmBatch = {
  id: string;
  batch_code: string;
  batch_type: "Broiler" | "Kienyeji";
  house: string | null;
  status: "running" | "closed";
};

type FarmSummary = {
  batches_recorded: number;
  birds_placed: number;
  revenue_kes: number;
  total_expenses_kes: number;
  feed_stock_on_hand_kg: number;
  accounts_receivable_kes: number;
  cash_balance_kes: number;
};

type DashboardPayload = {
  data: Batch[];
  summary: FarmSummary | null;
};

type Tab = "overview" | "batches" | "daily";
const TAB_CHANGE_EVENT = "flockledger-tab-change";
const ACTIVE_FARM_STORAGE_KEY = "flockledger:active-farm-id";

function subscribeToTabChanges(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(TAB_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(TAB_CHANGE_EVENT, onChange);
  };
}

function getTabFromLocation(): Tab {
  const tab = new URLSearchParams(window.location.search).get("tab");
  return tab === "batches" || tab === "daily" ? tab : "overview";
}

function getServerTabSnapshot(): Tab {
  return "overview";
}

function navigateToTab(tab: Tab) {
  const url = new URL(window.location.href);
  if (tab === "overview") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(TAB_CHANGE_EVENT));
}

class RequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: "same-origin",
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new RequestError("Could not reach FlockLedger. Check your connection and try again.", 0);
  }

  let payload: { data?: T; summary?: FarmSummary | null; error?: string };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new RequestError("The server returned an unreadable response.", response.status);
  }
  if (!response.ok) {
    throw new RequestError(payload.error ?? "The request could not be completed.", response.status);
  }
  return payload as T;
}

function formatKes(value: number | null | undefined) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

function formatNumber(value: number | null | undefined, digits = 0) {
  return new Intl.NumberFormat("en-KE", { maximumFractionDigits: digits }).format(
    Number(value ?? 0),
  );
}

function todayInNairobi() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Nairobi",
  }).format(new Date(`${value}T12:00:00+03:00`));
}

function normalizeFarm(row: unknown): Farm | null {
  if (!row || typeof row !== "object") return null;
  const entry = row as {
    farm_id?: string;
    role?: string;
    farms?: Farm | Farm[] | null;
  };
  const farm = Array.isArray(entry.farms) ? entry.farms[0] : entry.farms;
  if (!farm?.id || !entry.role) return null;
  return { ...farm, role: entry.role };
}

function Icon({ name }: { name: "overview" | "batch" | "daily" | "bird" | "feed" | "cash" | "sales" }) {
  const paths: Record<typeof name, React.ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>,
    batch: <><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" /><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v8.5" /></>,
    daily: <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h6" /></>,
    bird: <><path d="M7 14c-2.2 0-4-1.6-4-3.5S4.8 7 7 7c1.7 0 3.2.9 3.8 2.2 2.1-.6 4.2-.2 5.7 1.2l3.5-.2-1.7 2.1c.1 3.3-2.7 5.7-6.2 5.7H9l-3 2v-3.2A5.2 5.2 0 0 1 4 14.5" /><circle cx="7" cy="10" r=".7" fill="currentColor" stroke="none" /></>,
    feed: <><path d="M4 7h16l-1.5 13h-13zM7 7l1-4h8l1 4M8 11h8" /></>,
    cash: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h.01M17 15h.01M12 9v6M10 11h3.5a1.5 1.5 0 0 1 0 3H10" /></>,
    sales: <><path d="M4 19V5M4 19h17M8 15l4-4 3 2 5-6" /><path d="M16 7h4v4" /></>,
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function FarmPicker({
  farms,
  selectedFarmId,
  compact = false,
  onSelect,
  onAddFarm,
}: {
  farms: Farm[];
  selectedFarmId: string;
  compact?: boolean;
  onSelect: (farmId: string) => void;
  onAddFarm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedFarm = farms.find((farm) => farm.id === selectedFarmId);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={`farm-picker-control ${compact ? "mobile-farm-picker" : ""}`} ref={pickerRef}>
      <button
        ref={triggerRef}
        className="farm-picker"
        type="button"
        aria-label={`Select farm. Current farm: ${selectedFarm?.name ?? "none"}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="farm-avatar">{selectedFarm?.name.slice(0, 1).toUpperCase() ?? "F"}</span>
        <span className="farm-picker-name">{selectedFarm?.name ?? "Select a farm"}</span>
        <span className={`select-chevron ${open ? "open" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="farm-dropdown" role="group" aria-label="Available farms">
          <span className="farm-dropdown-caption">YOUR FARMS</span>
          {farms.map((farm) => (
            <button
              className={`farm-dropdown-item ${farm.id === selectedFarmId ? "selected" : ""}`}
              type="button"
              key={farm.id}
              aria-pressed={farm.id === selectedFarmId}
              onClick={() => {
                onSelect(farm.id);
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <span className="farm-dropdown-avatar">{farm.name.slice(0, 1).toUpperCase()}</span>
              <span className="farm-dropdown-copy">
                <strong>{farm.name}</strong>
                <small>{farm.role} account</small>
              </span>
              {farm.id === selectedFarmId && <span className="farm-dropdown-check" aria-hidden="true">✓</span>}
            </button>
          ))}
          <div className="farm-dropdown-divider" />
          <button
            className="farm-dropdown-add"
            type="button"
            onClick={() => {
              setOpen(false);
              onAddFarm();
            }}
          >
            <span className="farm-dropdown-add-icon" aria-hidden="true">+</span>
            <span>Add new farm</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function FlockLedgerApp() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [farms, setFarms] = useState<Farm[]>([]);
  const [farmBatches, setFarmBatches] = useState<FarmBatch[]>([]);
  const [farmId, setFarmId] = useState("");
  const [farmError, setFarmError] = useState("");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [dailyRecords, setDailyRecords] = useState<DailyRecord[]>([]);
  const tab = useSyncExternalStore(
    subscribeToTabChanges,
    getTabFromLocation,
    getServerTabSnapshot,
  );
  const [dialog, setDialog] = useState<"batch" | "daily" | "farm" | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [dailyBatchId, setDailyBatchId] = useState("");
  const [dailyRecordDate, setDailyRecordDate] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pageError, setPageError] = useState("");
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const dashboardRequestId = useRef(0);

  const activeFarm = farms.find((farm) => farm.id === farmId) ?? null;
  const batches = useMemo(() => dashboard?.data ?? [], [dashboard]);
  const runningBatches = farmBatches.filter((batch) => batch.status === "running");
  const existingDailyRecord = dailyRecords.find(
    (record) => record.batch_id === dailyBatchId && record.record_date === dailyRecordDate,
  );
  const canEditRecords = activeFarm?.role === "owner" || activeFarm?.role === "manager";
  const batchNames = useMemo(
    () => new Map(batches.map((batch) => [batch.batch_id, batch.batch_code])),
    [batches],
  );

  function openDialog(nextDialog: "batch" | "daily" | "farm") {
    setDialogError("");
    setFarmError("");
    if (nextDialog === "daily") {
      setDailyBatchId("");
      setDailyRecordDate(todayInNairobi());
    }
    setDialog(nextDialog);
  }

  function handleFarmSelection(nextFarmId: string) {
    if (nextFarmId === farmId) return;
    dashboardRequestId.current += 1;
    setLoadingDashboard(true);
    setDashboard(null);
    setFarmBatches([]);
    setDailyRecords([]);
    setPageError("");
    setFeedback("");
    setFarmId(nextFarmId);
  }

  const loadFarms = useCallback(async (preferredFarmId?: string) => {
    setLoadingDashboard(true);
    const payload = await request<{ data: unknown[] }>("/api/farms");
    const loadedFarms = payload.data.map(normalizeFarm).filter((farm): farm is Farm => farm !== null);
    const savedFarmId = preferredFarmId ?? window.localStorage.getItem(ACTIVE_FARM_STORAGE_KEY);
    setFarms(loadedFarms);
    setFarmBatches([]);
    setDailyRecords([]);
    setDashboard(null);
    setFarmId((current) =>
      loadedFarms.find((farm) => farm.id === savedFarmId)?.id
      ?? loadedFarms.find((farm) => farm.id === current)?.id
      ?? loadedFarms[0]?.id
      ?? "",
    );
    setAuthenticated(true);
    return loadedFarms;
  }, []);

  useEffect(() => {
    let active = true;
    request<{ data: unknown[] }>("/api/farms")
      .then((payload) => {
        if (!active) return;
        const loadedFarms = payload.data.map(normalizeFarm).filter((farm): farm is Farm => farm !== null);
        const savedFarmId = window.localStorage.getItem(ACTIVE_FARM_STORAGE_KEY);
        setFarms(loadedFarms);
        setFarmId(
          loadedFarms.find((farm) => farm.id === savedFarmId)?.id
          ?? loadedFarms[0]?.id
          ?? "",
        );
        setAuthenticated(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof RequestError && error.status === 401) {
          setAuthenticated(false);
          return;
        }
        setPageError(error instanceof Error ? error.message : "Could not load your farms.");
        setAuthenticated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (farmId) window.localStorage.setItem(ACTIVE_FARM_STORAGE_KEY, farmId);
  }, [farmId]);

  const refreshDashboard = useCallback(async (selectedFarmId: string) => {
    const requestId = ++dashboardRequestId.current;
    const [dashboardResult, batchesResult, dailyResult] = await Promise.allSettled([
      request<DashboardPayload>(
        `/api/dashboard?farmId=${encodeURIComponent(selectedFarmId)}`,
      ),
      request<{ data: FarmBatch[] }>(
        `/api/batches?farmId=${encodeURIComponent(selectedFarmId)}`,
      ),
      request<{ data: DailyRecord[] }>(
        `/api/daily-records?farmId=${encodeURIComponent(selectedFarmId)}`,
      ),
    ]);
    if (requestId !== dashboardRequestId.current) return;

    const errors: string[] = [];
    if (dashboardResult.status === "fulfilled") {
      setDashboard(dashboardResult.value);
    } else {
      setDashboard(null);
      errors.push(dashboardResult.reason instanceof Error
        ? dashboardResult.reason.message
        : "Could not load farm performance.");
    }
    if (batchesResult.status === "fulfilled") {
      setFarmBatches(batchesResult.value.data);
    } else {
      setFarmBatches([]);
      errors.push(batchesResult.reason instanceof Error
        ? batchesResult.reason.message
        : "Could not load farm batches.");
    }
    if (dailyResult.status === "fulfilled") {
      setDailyRecords(dailyResult.value.data);
    } else {
      setDailyRecords([]);
      errors.push(dailyResult.reason instanceof Error
        ? dailyResult.reason.message
        : "Could not load daily records.");
    }
    setPageError(errors[0] ?? "");
    setLoadingDashboard(false);
  }, []);

  useEffect(() => {
    let active = true;
    if (authenticated && farmId) {
      void Promise.resolve().then(() => {
        if (active) void refreshDashboard(farmId);
      });
    }
    return () => {
      active = false;
    };
  }, [authenticated, farmId, refreshDashboard]);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setAuthError("");
    setAuthNotice("");
    const formData = new FormData(event.currentTarget);
    const body: Record<string, string> = {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    };
    if (authMode === "sign-up") body.fullName = String(formData.get("fullName") ?? "");

    try {
      const result = await request<{ data: { emailConfirmationRequired?: boolean } }>(
        `/api/auth/${authMode}`,
        { method: "POST", body: JSON.stringify(body) },
      );
      if (authMode === "sign-up" && result.data.emailConfirmationRequired) {
        setAuthNotice("Account created. Confirm your email, then sign in to continue.");
        setAuthMode("sign-in");
        return;
      }
      await loadFarms();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not complete authentication.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    try {
      await request("/api/auth/sign-out", { method: "POST" });
      setAuthenticated(false);
      setFarms([]);
      setFarmBatches([]);
      setFarmId("");
      setDashboard(null);
      setDailyRecords([]);
      setAuthNotice("You have been signed out.");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not sign out.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFarmCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFarmError("");
    const form = new FormData(event.currentTarget);
    const name = String(form.get("farmName") ?? "").trim();
    const openingCashBalanceKes = Number(form.get("openingBalance") || 0);
    try {
      const created = await request<{ data: { id: string } }>("/api/farms", {
        method: "POST",
        body: JSON.stringify({ name, openingCashBalanceKes }),
      });
      setDialog(null);
      try {
        await loadFarms(created.data.id);
      } catch (error) {
        setLoadingDashboard(false);
        setPageError(
          error instanceof Error
            ? `Farm was created, but the farm list could not be refreshed. ${error.message}`
            : "Farm was created, but the farm list could not be refreshed. Reload the page.",
        );
        return;
      }
      setFeedback("Farm created and selected. You are its owner.");
    } catch (error) {
      setFarmError(error instanceof Error ? error.message : "Could not create farm.");
    } finally {
      setBusy(false);
    }
  }

  async function handleBatchCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeFarm) return;
    setBusy(true);
    setFeedback("");
    setPageError("");
    const form = new FormData(event.currentTarget);
    const body = {
      farmId: activeFarm.id,
      batchCode: String(form.get("batchCode") ?? "").trim().toUpperCase(),
      batchType: String(form.get("batchType") ?? "Broiler"),
      house: String(form.get("house") ?? "").trim() || null,
      rearingSystem: String(form.get("rearingSystem") ?? "").trim() || null,
      datePlaced: String(form.get("datePlaced") ?? ""),
      source: String(form.get("source") ?? "").trim() || null,
      chicksOrdered: Number(form.get("chicksOrdered") || 0),
      chicksReceived: Number(form.get("chicksReceived") || 0),
    };
    try {
      await request("/api/batches", { method: "POST", body: JSON.stringify(body) });
      setDialog(null);
      setFeedback("Batch created successfully.");
      await refreshDashboard(activeFarm.id);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "Could not create batch.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDailyCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeFarm) return;
    setFeedback("");
    setPageError("");
    const form = new FormData(event.currentTarget);
    const nullableNumber = (key: string) => {
      const value = String(form.get(key) ?? "").trim();
      return value ? Number(value) : null;
    };
    const changes = {
      recordDate: String(form.get("recordDate") ?? ""),
      dead: Number(form.get("dead") || 0),
      culled: Number(form.get("culled") || 0),
      feedGivenKg: Number(form.get("feedGivenKg") || 0),
      feedLeftKg: Number(form.get("feedLeftKg") || 0),
      waterLiters: Number(form.get("waterLiters") || 0),
      tempMinC: nullableNumber("tempMinC"),
      tempMaxC: nullableNumber("tempMaxC"),
      litter: String(form.get("litter") ?? "").trim() || null,
      initials: String(form.get("initials") ?? "").trim() || null,
      remarks: String(form.get("remarks") ?? "").trim() || null,
    };
    const body = {
      farmId: activeFarm.id,
      batchId: String(form.get("batchId") ?? ""),
      ...changes,
    };
    const parsedBody = dailyRecordCreateSchema.safeParse(body);
    if (!parsedBody.success) {
      setDialogError(parsedBody.error.issues.map((issue) => issue.message).join(" "));
      return;
    }
    const existing = dailyRecords.find(
      (record) => record.batch_id === body.batchId && record.record_date === body.recordDate,
    );
    setBusy(true);
    try {
      if (existing) {
        if (!canEditRecords) {
          setDialogError("A daily record already exists for this batch and date. Ask a farm manager to update it.");
          return;
        }
        await request(`/api/records/daily-records/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ farmId: activeFarm.id, changes }),
        });
      } else {
        await request("/api/daily-records", { method: "POST", body: JSON.stringify(body) });
      }
      setDialog(null);
      setFeedback(existing ? "Daily record updated and audit logged." : "Daily record saved.");
      await refreshDashboard(activeFarm.id);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "Could not save daily record.");
    } finally {
      setBusy(false);
    }
  }

  if (authenticated === null) {
    return (
      <main className="loading-screen" aria-live="polite">
        <div className="loading-mark"><Icon name="bird" /></div>
        <p>Opening your farm workspace…</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="auth-page">
        <section className="auth-story">
          <Link className="brand-lockup" href="/" aria-label="FlockLedger home">
            <span className="brand-mark"><Icon name="bird" /></span>
            <span>FlockLedger</span>
          </Link>
          <div className="auth-story-copy">
            <p className="eyebrow">Good records grow good farms</p>
            <h1>Your whole flock,<br />in good hands.</h1>
            <p className="story-description">
              One calm workspace for your poultry batches, daily records, flock health, and farm finances.
            </p>
            <div className="story-note">
              <span className="story-note-icon"><Icon name="sales" /></span>
              <span><strong>Made for the work on your farm</strong><small>Clear records. Better decisions. One day at a time.</small></span>
            </div>
          </div>
          <p className="auth-footer">Private farm records · KES · Africa/Nairobi</p>
        </section>
        <section className="auth-panel">
          <div className="auth-form-wrap">
            <p className="eyebrow">{authMode === "sign-in" ? "Welcome back" : "Get started"}</p>
            <h2>{authMode === "sign-in" ? "Sign in to your farm" : "Create your account"}</h2>
            <p className="muted-copy">
              {authMode === "sign-in"
                ? "Your records are right where you left them."
                : "Set up your account to start managing your poultry records."}
            </p>
            {authNotice && <div className="notice success-notice" role="status">{authNotice}</div>}
            {authError && <div className="notice error-notice" role="alert">{authError}</div>}
            <form className="form-stack auth-form" onSubmit={handleAuth}>
              {authMode === "sign-up" && (
                <label>
                  Full name
                  <input name="fullName" autoComplete="name" required maxLength={128} placeholder="Your name" />
                </label>
              )}
              <label>
                Email address
                <input name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
              </label>
              <label>
                Password
                <input name="password" type="password" autoComplete={authMode === "sign-in" ? "current-password" : "new-password"} required minLength={authMode === "sign-up" ? 8 : 1} maxLength={128} placeholder={authMode === "sign-up" ? "At least 8 characters" : "Enter your password"} />
              </label>
              <button className="button button-primary button-wide" type="submit" disabled={busy}>
                {busy ? "Please wait…" : authMode === "sign-in" ? "Sign in" : "Create account"}
              </button>
            </form>
            <p className="auth-switch">
              {authMode === "sign-in" ? "New to FlockLedger?" : "Already have an account?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in");
                  setAuthError("");
                  setAuthNotice("");
                }}
              >
                {authMode === "sign-in" ? "Create an account" : "Sign in"}
              </button>
            </p>
          </div>
          <p className="auth-legal">Your farm data is private and protected by role-based access.</p>
        </section>
      </main>
    );
  }

  const selectedTabTitle = tab === "overview" ? "Overview" : tab === "batches" ? "Flock batches" : "Daily records";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link className="brand-lockup sidebar-brand" href="/" aria-label="FlockLedger home">
          <span className="brand-mark"><Icon name="bird" /></span>
          <span>FlockLedger</span>
        </Link>
        <div className="farm-picker-wrap">
          <span className="nav-caption">YOUR FARM</span>
          {farms.length > 0 ? (
            <FarmPicker farms={farms} selectedFarmId={farmId} onSelect={handleFarmSelection} onAddFarm={() => openDialog("farm")} />
          ) : (
            <button className="farm-picker add-farm-picker" type="button" onClick={() => openDialog("farm")}>
              <span className="farm-avatar">+</span><span>Create your farm</span>
            </button>
          )}
          {farms.length > 0 && <span className="farm-role">{activeFarm?.role} account</span>}
        </div>
        <nav className="side-nav" aria-label="Main navigation">
          <span className="nav-caption">WORKSPACE</span>
          {([
            ["overview", "Overview", "overview"],
            ["batches", "Flock batches", "batch"],
            ["daily", "Daily records", "daily"],
          ] as const).map(([id, label, icon]) => (
            <button className={`nav-link ${tab === id ? "active" : ""}`} type="button" key={id} onClick={() => navigateToTab(id)}>
              <span className="nav-icon"><Icon name={icon} /></span>{label}
              {id === "batches" && runningBatches.length > 0 && <span className="nav-count">{runningBatches.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <span className="help-icon">i</span>
            <div><strong>Keep it up to date</strong><p>A few minutes of daily records make your reports more useful.</p></div>
          </div>
          <button className="profile-button" type="button" onClick={handleSignOut} disabled={busy}>
            <span className="profile-avatar">{activeFarm?.role?.slice(0, 1).toUpperCase() ?? "F"}</span>
            <span className="profile-text"><strong>{activeFarm?.role ?? "Farm member"}</strong><small>Sign out</small></span>
            <span className="profile-arrow" aria-hidden="true">↗</span>
          </button>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-separator">/</span><strong>{selectedTabTitle}</strong></div>
          <div className="topbar-actions">
            <span className="date-chip"><span className="status-dot" />{shortDate(todayInNairobi())}</span>
            <button className="button button-primary topbar-add" type="button" disabled={!activeFarm} onClick={() => openDialog(tab === "daily" ? "daily" : "batch")}>
              <span aria-hidden="true">+</span> {tab === "daily" ? "Add daily record" : "New batch"}
            </button>
          </div>
        </header>

        <div className="page-content">
          {farms.length > 0 && (
            <div className="mobile-farm-tools">
              <FarmPicker farms={farms} selectedFarmId={farmId} compact onSelect={handleFarmSelection} onAddFarm={() => openDialog("farm")} />
            </div>
          )}
          {pageError && <div className="notice error-notice page-notice" role="alert">{pageError}<button type="button" aria-label="Dismiss error" onClick={() => setPageError("")}>×</button></div>}
          {feedback && <div className="notice success-notice page-notice" role="status">{feedback}<button type="button" aria-label="Dismiss message" onClick={() => setFeedback("")}>×</button></div>}
          {!farms.length ? (
            <section className="welcome-card">
              <span className="welcome-icon"><Icon name="bird" /></span>
              <p className="eyebrow">A good place to begin</p>
              <h1>Set up your farm workspace</h1>
              <p>Add your farm details to start recording batches, daily activity, and performance.</p>
              <button className="button button-primary" type="button" onClick={() => openDialog("farm")}>Create your farm</button>
              {farmError && <p className="inline-error" role="alert">{farmError}</p>}
            </section>
          ) : !activeFarm ? (
            <div className="loading-card">Loading selected farm…</div>
          ) : tab === "overview" ? (
            <Overview
              farm={activeFarm}
              batches={batches}
              summary={dashboard?.summary ?? null}
              dailyRecords={dailyRecords}
              batchNames={batchNames}
              loading={loadingDashboard}
              onTabChange={navigateToTab}
              onAddDaily={() => openDialog("daily")}
            />
          ) : tab === "batches" ? (
            <BatchesPage batches={batches} loading={loadingDashboard} onAdd={() => openDialog("batch")} />
          ) : (
            <DailyPage records={dailyRecords} batchNames={batchNames} loading={loadingDashboard} onAdd={() => openDialog("daily")} />
          )}
        </div>
      </section>

      {dialog && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <section className={`dialog-card ${dialog === "daily" ? "daily-dialog-card" : ""}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
            <div className="dialog-heading">
              <div>
                <p className="eyebrow">{dialog === "farm" ? farms.length ? "ADD TO YOUR WORKSPACE" : "FARM SETUP" : dialog === "batch" ? "FLOCK MANAGEMENT" : "DAILY HOUSE LOG"}</p>
                <h2 id="dialog-title">{dialog === "farm" ? farms.length ? "Add another farm" : "Create a farm" : dialog === "batch" ? "Start a new batch" : "Record today’s activity"}</h2>
                {dialog === "daily" && <p className="dialog-description">Choose a flock and date, then record what happened in the house.</p>}
              </div>
              <button className="dialog-close" type="button" aria-label="Close dialog" onClick={() => setDialog(null)}>×</button>
            </div>
            {dialog === "farm" ? (
              <form className="form-stack dialog-form" onSubmit={handleFarmCreate}>
                <label>Farm name<input name="farmName" required autoFocus maxLength={128} placeholder="e.g. Green Valley Poultry" /></label>
                <label>Opening cash balance <span className="field-note">KES</span><input name="openingBalance" type="number" min="0" step="0.01" defaultValue="0" /></label>
                {farmError && <p className="inline-error" role="alert">{farmError}</p>}
                <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? "Creating…" : farms.length ? "Add farm" : "Create farm"}</button></div>
              </form>
            ) : dialog === "batch" ? (
              <form className="form-stack dialog-form" onSubmit={handleBatchCreate}>
                <div className="form-grid">
                  <label>Batch type<select name="batchType" defaultValue="Broiler"><option value="Broiler">Broiler</option><option value="Kienyeji">Kienyeji</option></select></label>
                  <label>Batch ID<input name="batchCode" required maxLength={64} placeholder="e.g. RPF-BR-2611-01" pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*" title="Use capital letters, numbers, and hyphens; include BR or KJ." /></label>
                  <label>Date placed<input name="datePlaced" type="date" required defaultValue={todayInNairobi()} /></label>
                  <label>Birds received<input name="chicksReceived" type="number" min="1" step="1" required /></label>
                  <label>Birds ordered<input name="chicksOrdered" type="number" min="0" step="1" defaultValue="0" /></label>
                  <label>House<input name="house" maxLength={64} placeholder="e.g. House 1" /></label>
                  <label>Rearing system<input name="rearingSystem" maxLength={64} placeholder="e.g. Deep litter" /></label>
                  <label>Source / supplier<input name="source" maxLength={128} placeholder="Optional" /></label>
                </div>
                {dialogError && <p className="inline-error" role="alert">{dialogError}</p>}
                <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Create batch"}</button></div>
              </form>
            ) : (
              <form
                key={existingDailyRecord?.id ?? "new-daily-record"}
                className="form-stack dialog-form daily-record-form"
                onSubmit={handleDailyCreate}
              >
                <div className="daily-form-scroll">
                  <div className="daily-form-layout">
                  <section className="daily-form-section flock-section">
                    <div className="form-section-heading"><span>01</span><div><h3>Flock and date</h3><p>One daily log per batch, per date.</p></div></div>
                    <div className="form-grid">
                      <label>Active batch<select name="batchId" required value={dailyBatchId} onChange={(event) => setDailyBatchId(event.target.value)}><option value="" disabled>Select a running batch</option>{runningBatches.map((batch) => <option key={batch.id} value={batch.id}>{batch.batch_code} · {batch.batch_type}{batch.house ? ` · ${batch.house}` : ""}</option>)}</select></label>
                      <label>Date<input name="recordDate" type="date" required value={dailyRecordDate} onChange={(event) => setDailyRecordDate(event.target.value)} /></label>
                    </div>
                  </section>
                  <section className="daily-form-section">
                    <div className="form-section-heading"><span>02</span><div><h3>Flock count</h3><p>Losses recorded for this day.</p></div></div>
                    <div className="form-grid">
                      <label>Deaths<input name="dead" type="number" min="0" step="1" defaultValue={existingDailyRecord?.dead ?? 0} /></label>
                      <label>Culled<input name="culled" type="number" min="0" step="1" defaultValue={existingDailyRecord?.culled ?? 0} /></label>
                    </div>
                  </section>
                  <section className="daily-form-section">
                    <div className="form-section-heading"><span>03</span><div><h3>Feed and water</h3><p>Feed consumed = given − left over.</p></div></div>
                    <div className="form-grid form-grid-three">
                      <label>Feed given <span className="field-note">kg</span><input name="feedGivenKg" type="number" min="0" step="0.001" defaultValue={existingDailyRecord?.feed_given_kg ?? 0} /></label>
                      <label>Feed left over after feeding <span className="field-note">kg</span><input name="feedLeftKg" type="number" min="0" step="0.001" defaultValue={existingDailyRecord?.feed_left_kg ?? 0} /></label>
                      <label>Water <span className="field-note">litres</span><input name="waterLiters" type="number" min="0" step="0.001" defaultValue={existingDailyRecord?.water_liters ?? 0} /></label>
                    </div>
                  </section>
                  <section className="daily-form-section">
                    <div className="form-section-heading"><span>04</span><div><h3>House conditions</h3><p>Temperature and litter.</p></div></div>
                    <div className="form-grid">
                      <label>Min. temperature <span className="field-note">°C</span><input name="tempMinC" type="number" min="-20" max="80" step="0.1" defaultValue={existingDailyRecord?.temp_min_c ?? ""} /></label>
                      <label>Max. temperature <span className="field-note">°C</span><input name="tempMaxC" type="number" min="-20" max="80" step="0.1" defaultValue={existingDailyRecord?.temp_max_c ?? ""} /></label>
                      <label className="field-span">Litter condition<input name="litter" maxLength={128} placeholder="e.g. Dry, slightly damp" defaultValue={existingDailyRecord?.litter ?? ""} /></label>
                    </div>
                  </section>
                  <section className="daily-form-section notes-section">
                    <div className="form-section-heading"><span>05</span><div><h3>Notes</h3><p>Optional observations.</p></div></div>
                    <div className="form-grid">
                      <label>Recorded by <span className="field-note">initials</span><input name="initials" maxLength={16} placeholder="Optional" defaultValue={existingDailyRecord?.initials ?? ""} /></label>
                      <label className="field-span">Observations<input name="remarks" maxLength={2000} placeholder="Anything to note about today?" defaultValue={existingDailyRecord?.remarks ?? ""} /></label>
                    </div>
                  </section>
                  </div>
                  {existingDailyRecord && (
                    <div className={`record-exists-note ${canEditRecords ? "editable" : ""}`} role="status">
                      {canEditRecords
                        ? "A log already exists for this batch and date. Saving changes will add an audit entry."
                        : "A log already exists for this batch and date. Ask a farm owner or manager to update it."}
                    </div>
                  )}
                  {!runningBatches.length && <p className="inline-error">There are no running batches to record against. Create a batch first.</p>}
                  {dialogError && <p className="inline-error" role="alert">{dialogError}</p>}
                </div>
                <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy || !runningBatches.length || (Boolean(existingDailyRecord) && !canEditRecords)}>{busy ? "Saving…" : existingDailyRecord ? canEditRecords ? "Update daily record" : "Already recorded" : "Save daily record"}</button></div>
              </form>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function Overview({
  farm,
  batches,
  summary,
  dailyRecords,
  batchNames,
  loading,
  onTabChange,
  onAddDaily,
}: {
  farm: Farm;
  batches: Batch[];
  summary: FarmSummary | null;
  dailyRecords: DailyRecord[];
  batchNames: Map<string, string>;
  loading: boolean;
  onTabChange: (tab: Tab) => void;
  onAddDaily: () => void;
}) {
  const active = batches.filter((batch) => batch.status === "running");
  const today = todayInNairobi();
  const todaysRecords = dailyRecords.filter((record) => record.record_date === today);

  return (
    <>
      <div className="page-heading">
        <div><p className="eyebrow">FARM OVERVIEW</p><h1>Good day, {farm.name}</h1><p className="page-subtitle">Here’s how your flock and farm are doing.</p></div>
        <span className="heading-date"><span className="status-dot" />Updated for {shortDate(today)}</span>
      </div>
      <div className="welcome-banner">
        <span className="banner-art"><Icon name="bird" /></span>
        <div><p className="banner-kicker">YOUR FARM, AT A GLANCE</p><h2>{active.length ? `${active.length} active ${active.length === 1 ? "batch" : "batches"} in progress` : "Your next batch starts here"}</h2><p>{active.length ? "Keep your daily records consistent to make performance insights more useful." : "Create your first batch to start tracking flock performance."}</p></div>
        <button className="banner-button" type="button" onClick={() => onTabChange("batches")}>View batches <span aria-hidden="true">→</span></button>
      </div>
      <section className="metric-grid" aria-label="Farm metrics">
        <Metric icon="bird" label="Birds placed" value={formatNumber(summary?.birds_placed)} note={`${formatNumber(summary?.batches_recorded)} batches recorded`} tone="green" />
        <Metric icon="cash" label="Cash balance" value={formatKes(summary?.cash_balance_kes)} note="Opening balance + cash activity" tone="blue" />
        <Metric icon="sales" label="Revenue recorded" value={formatKes(summary?.revenue_kes)} note={`${formatKes(summary?.accounts_receivable_kes)} outstanding`} tone="gold" />
        <Metric icon="feed" label="Feed on hand" value={`${formatNumber(summary?.feed_stock_on_hand_kg, 1)} kg`} note={`${formatNumber(summary?.total_expenses_kes)} KES total expenses`} tone="lilac" />
      </section>
      <div className="content-grid">
        <section className="content-card batch-card">
          <div className="card-heading"><div><p className="eyebrow">YOUR FLOCK</p><h2>Active batches</h2></div><button className="text-button" type="button" onClick={() => onTabChange("batches")}>All batches <span aria-hidden="true">→</span></button></div>
          {loading ? <div className="empty-inline">Loading your latest farm data…</div> : active.length ? (
            <div className="batch-list">
              {active.slice(0, 4).map((batch) => {
                const remaining = Math.max(batch.chicks_received - batch.dead - batch.culled - batch.birds_sold, 0);
                const survival = batch.chicks_received ? (remaining / batch.chicks_received) * 100 : 0;
                return (
                  <article className="batch-row" key={batch.batch_id}>
                    <span className={`batch-type-icon ${batch.batch_type === "Broiler" ? "broiler" : "kienyeji"}`}><Icon name="bird" /></span>
                    <div className="batch-main"><strong>{batch.batch_code}</strong><span>{batch.batch_type}{batch.house ? ` · ${batch.house}` : ""} · Day {formatNumber(batch.age_days)}</span></div>
                    <div className="batch-progress"><div className="progress-track"><span style={{ width: `${Math.min(Math.max(survival, 0), 100)}%` }} /></div><small>{formatNumber(remaining)} birds · {formatNumber(survival, 1)}% livability</small></div>
                    <span className="batch-chevron" aria-hidden="true">›</span>
                  </article>
                );
              })}
            </div>
          ) : <EmptyState title="No active batches yet" detail="Add a batch to start following your flock." action="Create first batch" onClick={() => onTabChange("batches")} />}
        </section>
        <section className="content-card daily-card">
          <div className="card-heading"><div><p className="eyebrow">DAILY ROUTINE</p><h2>Today’s records</h2></div><span className="today-count">{todaysRecords.length}</span></div>
          {loading ? <div className="empty-inline">Loading records…</div> : todaysRecords.length ? (
            <div className="today-record-list">{todaysRecords.slice(0, 4).map((record) => <div className="today-record" key={record.id}><span className="record-check">✓</span><span><strong>{batchNames.get(record.batch_id) ?? "Batch record"}</strong><small>{formatNumber(record.feed_given_kg - record.feed_left_kg, 1)} kg feed used · {record.dead + record.culled} losses</small></span><span className="record-time">{record.initials || "Logged"}</span></div>)}</div>
          ) : <EmptyState title="Nothing logged today" detail="A quick daily entry helps build a reliable flock history." action="Add daily record" onClick={onAddDaily} />}
        </section>
      </div>
      <section className="performance-strip">
        <div className="performance-icon"><Icon name="sales" /></div>
        <div className="performance-copy"><strong>Building a better picture of your farm</strong><p>Record weights, sales, and costs as they happen to unlock meaningful flock performance insights.</p></div>
        <div className="performance-stat"><span>Farm timezone</span><strong>{farm.timezone || "Africa/Nairobi"}</strong></div>
        <div className="performance-stat"><span>Reporting currency</span><strong>{farm.currency || "KES"}</strong></div>
      </section>
    </>
  );
}

function Metric({ icon, label, value, note, tone }: { icon: "bird" | "cash" | "feed" | "sales"; label: string; value: string; note: string; tone: string }) {
  return (
    <article className="metric-card">
      <div className="metric-top"><span className={`metric-icon ${tone}`}><Icon name={icon} /></span><span className="metric-label">{label}</span></div>
      <strong className="metric-value">{value}</strong><span className="metric-note">{note}</span>
    </article>
  );
}

function EmptyState({ title, detail, action, onClick }: { title: string; detail: string; action: string; onClick: () => void }) {
  return <div className="empty-state"><span className="empty-illustration"><Icon name="bird" /></span><strong>{title}</strong><p>{detail}</p><button className="text-button" type="button" onClick={onClick}>{action} <span aria-hidden="true">→</span></button></div>;
}

function BatchesPage({ batches, loading, onAdd }: { batches: Batch[]; loading: boolean; onAdd: () => void }) {
  const [filter, setFilter] = useState<"all" | "running" | "closed">("all");
  const visible = batches.filter((batch) => filter === "all" || batch.status === filter);
  return (
    <>
      <div className="page-heading">
        <div><p className="eyebrow">FLOCK MANAGEMENT</p><h1>Your batches</h1><p className="page-subtitle">Follow every flock from placement through closeout.</p></div>
        <button className="button button-primary" type="button" onClick={onAdd}><span aria-hidden="true">+</span> New batch</button>
      </div>
      <section className="content-card table-card">
        <div className="table-toolbar"><div className="filter-tabs" role="group" aria-label="Filter batches">{(["all", "running", "closed"] as const).map((item) => <button key={item} type="button" className={filter === item ? "selected" : ""} onClick={() => setFilter(item)}>{item === "all" ? "All batches" : item === "running" ? "Active" : "Closed"} <span>{item === "all" ? batches.length : batches.filter((batch) => batch.status === item).length}</span></button>)}</div><span className="table-hint">Showing {visible.length} {visible.length === 1 ? "batch" : "batches"}</span></div>
        {loading ? <div className="empty-inline">Loading batches…</div> : visible.length ? (
          <div className="table-scroll"><table><thead><tr><th>Batch</th><th>Status</th><th>Placed</th><th>Birds placed</th><th>Age</th><th>Mortality</th><th>FCR</th></tr></thead><tbody>{visible.map((batch) => <tr key={batch.batch_id}><td><span className="table-batch"><span className={`table-batch-mark ${batch.batch_type === "Broiler" ? "broiler" : "kienyeji"}`}><Icon name="bird" /></span><span><strong>{batch.batch_code}</strong><small>{batch.batch_type}{batch.house ? ` · ${batch.house}` : ""}</small></span></span></td><td><span className={`status-pill ${batch.status}`}>{batch.status === "running" ? "Active" : "Closed"}</span></td><td>{shortDate(batch.date_placed)}</td><td>{formatNumber(batch.chicks_received)}</td><td>{batch.status === "running" ? `Day ${formatNumber(batch.age_days)}` : "—"}</td><td>{formatNumber(batch.mortality_percent, 1)}%</td><td>{batch.fcr == null ? "—" : formatNumber(batch.fcr, 2)}</td></tr>)}</tbody></table></div>
        ) : <EmptyState title={filter === "all" ? "No batches recorded" : `No ${filter} batches`} detail="Create a batch record to begin tracking flock performance." action="Create a batch" onClick={onAdd} />}
      </section>
    </>
  );
}

function DailyPage({ records, batchNames, loading, onAdd }: { records: DailyRecord[]; batchNames: Map<string, string>; loading: boolean; onAdd: () => void }) {
  return (
    <>
      <div className="page-heading">
        <div><p className="eyebrow">DAILY FARM ROUTINE</p><h1>Daily records</h1><p className="page-subtitle">A clear history of feed, water, flock losses, and house conditions.</p></div>
        <button className="button button-primary" type="button" onClick={onAdd}><span aria-hidden="true">+</span> Add daily record</button>
      </div>
      <section className="content-card table-card">
        <div className="table-toolbar"><div><h2 className="table-title">Recent activity</h2><p className="table-subtitle">Most recent records across all batches</p></div><span className="table-hint">{records.length} records</span></div>
        {loading ? <div className="empty-inline">Loading daily records…</div> : records.length ? (
          <div className="table-scroll"><table><thead><tr><th>Date</th><th>Batch</th><th>Feed used</th><th>Water</th><th>Deaths</th><th>Culls</th><th>Initials</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td>{shortDate(record.record_date)}</td><td><strong>{batchNames.get(record.batch_id) ?? "—"}</strong></td><td>{formatNumber(record.feed_given_kg - record.feed_left_kg, 2)} kg</td><td>{formatNumber(record.water_liters, 1)} L</td><td>{formatNumber(record.dead)}</td><td>{formatNumber(record.culled)}</td><td>{record.initials || "—"}</td></tr>)}</tbody></table></div>
        ) : <EmptyState title="No daily records yet" detail="Start with today’s activity. Add feed use, water, and flock observations." action="Add daily record" onClick={onAdd} />}
      </section>
    </>
  );
}
