"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { generateBatchCode, generateBatchCodeSuffix } from "@/lib/batches/batch-code";
import { dailyRecordCreateSchema } from "@/lib/validation/daily-records";
import { Icon } from "@/components/app-icon";
import { Metric } from "@/components/metric-card";
import { BottomTabs, MobileAccountMenu, type AppTab } from "@/components/mobile-navigation";
import { RequestError, request } from "@/lib/client/request";
import { formatKes, formatNumber, shortDate, todayInNairobi } from "@/lib/format";
import type { PageMetadata } from "@/lib/api/pagination";
import type {
  Batch,
  DailyRecord,
  DashboardPayload,
  FarmBatch,
  FarmSummary,
} from "@/lib/farm/types";

const BatchesPage = dynamic(
  () => import("@/components/farm-list-pages").then((module) => module.BatchesPage),
  { loading: () => <div className="empty-inline">Loading batches…</div> },
);
const DailyPage = dynamic(
  () => import("@/components/farm-list-pages").then((module) => module.DailyPage),
  { loading: () => <div className="empty-inline">Loading daily records…</div> },
);
const RevenuePage = dynamic(
  () => import("@/components/revenue-page").then((module) => module.RevenuePage),
  { loading: () => <div className="empty-inline">Loading revenue ledger…</div> },
);
const AuditPage = dynamic(
  () => import("@/components/audit-page").then((module) => module.AuditPage),
  { loading: () => <div className="empty-inline">Loading audit history…</div> },
);
const HealthIncidentsPage = dynamic(
  () => import("@/components/health-incidents-page").then((module) => module.HealthIncidentsPage),
  { loading: () => <div className="empty-inline">Loading health incidents…</div> },
);
const PlatformAdminPage = dynamic(
  () => import("@/components/platform-admin-page").then((module) => module.PlatformAdminPage),
  { loading: () => <div className="empty-inline">Loading platform controls…</div> },
);

type Farm = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  lifecycle_status: "active" | "suspended" | "pending_setup" | "pending_approval" | "rejected" | "archived";
  role: string;
};

type FarmApplication = {
  id: string;
  farm_id: string;
  status: string;
  farm_name: string;
  decision_reason: string | null;
  created_at: string;
  submitted_at: string | null;
  decided_at: string | null;
};

type PermissionDelegation = {
  id: string;
  user_id: string;
  permission_key: string;
  revoked_at: string | null;
};

const DELEGABLE_MANAGER_PERMISSIONS = [
  ["staff.invite", "Invite eligible staff"],
  ["staff.assign_roles", "Assign eligible staff roles"],
  ["inventory.adjust", "Adjust inventory"],
  ["reports.export", "Export reports"],
] as const;

type Tab = AppTab;
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
  return tab === "batches" || tab === "daily" || tab === "health" || tab === "revenue" || tab === "audit"
    || tab === "platform"
    ? tab
    : "overview";
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

async function requestAllPages<T>(url: string): Promise<T[]> {
  const parsedUrl = new URL(url, window.location.origin);
  const data: T[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    parsedUrl.searchParams.set("page", String(page));
    parsedUrl.searchParams.set("pageSize", "100");
    const result = await request<{ data: T[]; pagination: PageMetadata }>(
      `${parsedUrl.pathname}${parsedUrl.search}`,
    );
    data.push(...result.data);
    hasMore = result.pagination.hasMore;
    page += 1;
  }
  return data;
}

function normalizeFarm(row: unknown): Farm | null {
  if (!row || typeof row !== "object") return null;
  const entry = row as {
    farm_id?: string;
    role?: string;
    farms?: Omit<Farm, "role"> | Array<Omit<Farm, "role">> | null;
  };
  const farm = Array.isArray(entry.farms) ? entry.farms[0] : entry.farms;
  if (!farm?.id || !entry.role) return null;
  return { ...farm, role: entry.role };
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
                <small>{farm.role} · {farm.lifecycle_status.replaceAll("_", " ")}</small>
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
            <span>Add new farm</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function FlockLedgerApp({
  initialAuthMode = "sign-in",
}: {
  initialAuthMode?: "sign-in" | "sign-up";
}) {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">(initialAuthMode);
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [farms, setFarms] = useState<Farm[]>([]);
  const [farmApplications, setFarmApplications] = useState<FarmApplication[]>([]);
  const [farmBatches, setFarmBatches] = useState<FarmBatch[]>([]);
  const [farmId, setFarmId] = useState("");
  const [farmError, setFarmError] = useState("");
  const [teamMembers, setTeamMembers] = useState<Array<{ user_id: string; role: string; created_at: string; profiles?: { full_name: string | null } | null }>>([]);
  const [teamInvitations, setTeamInvitations] = useState<Array<{ id: string; email: string; role: string; status: string }>>([]);
  const [permissionDelegations, setPermissionDelegations] = useState<PermissionDelegation[]>([]);
  const [delegationManagerId, setDelegationManagerId] = useState("");
  const [delegationPermissions, setDelegationPermissions] = useState<string[]>([]);
  const [farmPermissionState, setFarmPermissionState] = useState<{ farmId: string; permissions: string[] } | null>(null);
  const [teamError, setTeamError] = useState("");
  const [teamNotice, setTeamNotice] = useState("");
  const [teamSetupLink, setTeamSetupLink] = useState("");
  const [teamTemporaryPassword, setTeamTemporaryPassword] = useState("");
  const invitationIdempotencyKey = useRef<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [dailyRecords, setDailyRecords] = useState<DailyRecord[]>([]);
  const [dailyRefreshVersion, setDailyRefreshVersion] = useState(0);
  const [dailyRecordLookup, setDailyRecordLookup] = useState<{
    key: string;
    record?: DailyRecord;
    error?: string;
  } | null>(null);
  const [batchType, setBatchType] = useState<"Broiler" | "Kienyeji">("Broiler");
  const [batchDatePlaced, setBatchDatePlaced] = useState("");
  const [batchHouse, setBatchHouse] = useState("");
  const [batchCodeSuffix, setBatchCodeSuffix] = useState("");
  const tab = useSyncExternalStore(
    subscribeToTabChanges,
    getTabFromLocation,
    getServerTabSnapshot,
  );
  const [dialog, setDialog] = useState<"batch" | "daily" | "farm" | "team" | null>(null);
  const [dialogError, setDialogError] = useState("");
  const farmApplicationIdempotencyKey = useRef<string | null>(null);
  const [dailyBatchId, setDailyBatchId] = useState("");
  const [dailyRecordDate, setDailyRecordDate] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pageError, setPageError] = useState("");
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const dashboardRequestId = useRef(0);
  const dialogCardRef = useRef<HTMLElement>(null);


  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (!pageError) return;
    const timer = window.setTimeout(() => setPageError(""), 5000);
    return () => window.clearTimeout(timer);
  }, [pageError]);

  useEffect(() => {
    if (authenticated !== true) return;
    let active = true;
    request<{ isPlatformAdmin: boolean }>("/api/platform/session")
      .then((result) => {
        if (active) setIsPlatformAdmin(result.isPlatformAdmin);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setIsPlatformAdmin(false);
        setPageError(error instanceof Error ? error.message : "Could not load platform access.");
      });
    return () => {
      active = false;
    };
  }, [authenticated]);

  useEffect(() => {
    if (!authNotice) return;
    const timer = window.setTimeout(() => setAuthNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [authNotice]);

  useEffect(() => {
    if (!authError) return;
    const timer = window.setTimeout(() => setAuthError(""), 5000);
    return () => window.clearTimeout(timer);
  }, [authError]);

  useEffect(() => {
    if (!dialogError) return;
    const timer = window.setTimeout(() => setDialogError(""), 5000);
    return () => window.clearTimeout(timer);
  }, [dialogError]);

  useEffect(() => {
    if (!dialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => dialogCardRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDialog(null);
        return;
      }
      if (event.key !== "Tab" || !dialogCardRef.current) return;
      const focusable = Array.from(
        dialogCardRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null || element === document.activeElement);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogCardRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [dialog]);

  useEffect(() => {
    if (!farmError) return;
    const timer = window.setTimeout(() => setFarmError(""), 5000);
    return () => window.clearTimeout(timer);
  }, [farmError]);

  const activeFarm = farms.find((farm) => farm.id === farmId) ?? null;
  const generatedBatchCode = useMemo(
    () => generateBatchCode(batchDatePlaced, batchCodeSuffix),
    [batchCodeSuffix, batchDatePlaced],
  );
  const batches = useMemo(() => dashboard?.data ?? [], [dashboard]);
  const runningBatches = farmBatches.filter((batch) => batch.status === "running");
  const dailyRecordLookupKey = `${farmId}:${dailyBatchId}:${dailyRecordDate}`;
  const existingDailyRecord = dailyRecordLookup?.key === dailyRecordLookupKey
    ? dailyRecordLookup.record
    : undefined;
  const dailyRecordLookupLoading = dialog === "daily"
    && Boolean(farmId && dailyBatchId && dailyRecordDate)
    && dailyRecordLookup?.key !== dailyRecordLookupKey;
  const dailyRecordLookupFailed = dailyRecordLookup?.key === dailyRecordLookupKey
    && Boolean(dailyRecordLookup.error);
  const farmIsActive = activeFarm?.lifecycle_status === "active";
  const canViewAudit = activeFarm?.role === "owner";
  const isFarmOwner = activeFarm?.role === "owner";
  const farmPermissions = farmPermissionState?.farmId === farmId ? farmPermissionState.permissions : [];
  const hasPermission = (permission: string) => isFarmOwner || farmPermissions.includes(permission);
  const canViewTeam = hasPermission("staff.view");
  const canInviteStaff = farmIsActive && hasPermission("staff.invite");
  const canAssignRoles = farmIsActive && hasPermission("staff.assign_roles");
  const canEditRecords = farmIsActive && hasPermission("production.record");
  const canCreateBatches = farmIsActive && hasPermission("batches.create");
  const canViewFinance = hasPermission("finance.view");
  const canViewSales = hasPermission("sales.view") || canViewFinance;
  const canCreateSales = farmIsActive && hasPermission("finance.sales.create");
  const canRecordPayments = farmIsActive && hasPermission("finance.payments.record");
  const canViewHealth = hasPermission("health.view");
  const canCoordinateHealth = farmIsActive && hasPermission("health.coordinate");
  const batchNames = useMemo(() => new Map([
    ...batches.map((batch) => [batch.batch_id, batch.batch_code] as const),
    ...farmBatches.map((batch) => [batch.id, batch.batch_code] as const),
  ]), [batches, farmBatches]);

  useEffect(() => {
    if (authenticated !== true || !farmId) {
      return;
    }

    let active = true;
    request<{ data: string[] }>(`/api/farms/${encodeURIComponent(farmId)}/permissions`)
      .then((result) => {
        if (active) setFarmPermissionState({ farmId, permissions: result.data });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFarmPermissionState({ farmId, permissions: [] });
        setPageError(error instanceof Error ? error.message : "Could not load farm permissions.");
      });

    return () => {
      active = false;
    };
  }, [authenticated, farmId]);

  useEffect(() => {
    if (dialog !== "daily" || !farmId || !dailyBatchId || !dailyRecordDate) return;

    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams({
      farmId,
      batchId: dailyBatchId,
      from: dailyRecordDate,
      to: dailyRecordDate,
      page: "1",
      pageSize: "1",
    });
    request<{ data: DailyRecord[] }>(`/api/daily-records?${params.toString()}`, {
      signal: controller.signal,
    }).then((result) => {
      if (active) setDailyRecordLookup({
        key: dailyRecordLookupKey,
        record: result.data[0],
      });
    }).catch((error: unknown) => {
      if (active) {
        const message = error instanceof Error ? error.message : "Could not check the existing daily record.";
        setDailyRecordLookup({ key: dailyRecordLookupKey, error: message });
        setDialogError(message);
      }
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [dailyBatchId, dailyRecordDate, dailyRecordLookupKey, dialog, farmId]);

  function openDialog(nextDialog: "batch" | "daily" | "farm" | "team") {
    setDialogError("");
    setFarmError("");
    setTeamError("");
    setTeamNotice("");
    if (nextDialog === "farm" && activeFarm && activeFarm.role !== "owner") {
      setFeedback("Only a farm owner can create or add another farm.");
      return;
    }
    if (nextDialog === "team" && !canViewTeam) {
      setFeedback("Your farm role does not include team access.");
      return;
    }
    if (nextDialog === "daily") {
      setDailyBatchId("");
      setDailyRecordDate(todayInNairobi());
    }
    if (nextDialog === "batch") {
      setBatchType("Broiler");
      setBatchDatePlaced(todayInNairobi());
      setBatchHouse("");
      setBatchCodeSuffix(generateBatchCodeSuffix());
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
    await request<{ data: { accepted: number } }>("/api/invitations/accept", { method: "POST" }).catch(() => undefined);
    const [farmRows, applicationRows] = await Promise.all([
      requestAllPages<unknown>(`${window.location.origin}/api/farms`),
      requestAllPages<FarmApplication>(`${window.location.origin}/api/farm-applications`),
    ]);
    const loadedFarms = farmRows.map(normalizeFarm).filter((farm): farm is Farm => farm !== null);
    const savedFarmId = preferredFarmId ?? window.localStorage.getItem(ACTIVE_FARM_STORAGE_KEY);
    setFarms(loadedFarms);
    setFarmApplications(applicationRows);
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
    request<{ data: { accepted: number } }>("/api/invitations/accept", { method: "POST" })
      .catch(() => ({ data: { accepted: 0 } }))
      .then(() => Promise.all([
        requestAllPages<unknown>(`${window.location.origin}/api/farms`),
        requestAllPages<FarmApplication>(`${window.location.origin}/api/farm-applications`),
      ]))
      .then(([farmRows, applicationRows]) => {
        if (!active) return;
        const loadedFarms = farmRows.map(normalizeFarm).filter((farm): farm is Farm => farm !== null);
        const savedFarmId = window.localStorage.getItem(ACTIVE_FARM_STORAGE_KEY);
        setFarms(loadedFarms);
        setFarmApplications(applicationRows);
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
          setIsPlatformAdmin(false);
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
        `/api/dashboard?farmId=${encodeURIComponent(selectedFarmId)}&pageSize=25`,
      ),
      requestAllPages<FarmBatch>(
        `/api/batches?farmId=${encodeURIComponent(selectedFarmId)}`,
      ),
      requestAllPages<DailyRecord>(
        `/api/daily-records?farmId=${encodeURIComponent(selectedFarmId)}&from=${todayInNairobi()}&to=${todayInNairobi()}`,
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
      setFarmBatches(batchesResult.value);
    } else {
      setFarmBatches([]);
      errors.push(batchesResult.reason instanceof Error
        ? batchesResult.reason.message
        : "Could not load farm batches.");
    }
    if (dailyResult.status === "fulfilled") {
      setDailyRecords(dailyResult.value);
      setDailyRefreshVersion((version) => version + 1);
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
      const result = await request<{ data: { emailConfirmationRequired?: boolean; requiresPasswordChange?: boolean } }>(
        `/api/auth/${authMode}`,
        { method: "POST", body: JSON.stringify(body) },
      );
      if (authMode === "sign-up" && result.data.emailConfirmationRequired) {
        setAuthNotice("Account created. Confirm your email, then sign in to continue.");
        setAuthMode("sign-in");
        return;
      }
      if (result.data.requiresPasswordChange) {
        router.push("/staff/setup?change_password=1");
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
    if (activeFarm && activeFarm.role !== "owner") {
      setFarmError("Only a farm owner can create or add another farm.");
      return;
    }
    setBusy(true);
    setFarmError("");
    const form = new FormData(event.currentTarget);
    const name = String(form.get("farmName") ?? "").trim();
    const openingCashBalanceKes = Number(form.get("openingBalance") || 0);
    farmApplicationIdempotencyKey.current ??= crypto.randomUUID();
    try {
      await request<{ data: { applicationId: string; farmId: string; status: string } }>("/api/farms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": farmApplicationIdempotencyKey.current,
        },
        body: JSON.stringify({ name, openingCashBalanceKes }),
      });
      setDialog(null);
      try {
        await loadFarms();
      } catch (error) {
        setLoadingDashboard(false);
        setPageError(
          error instanceof Error
            ? `Application was submitted, but the application list could not be refreshed. ${error.message}`
            : "Application was submitted, but the application list could not be refreshed. Reload the page.",
        );
        return;
      }
      farmApplicationIdempotencyKey.current = null;
      setFeedback("Farm application submitted for platform review. You can start recording after approval.");
    } catch (error) {
      setFarmError(error instanceof Error ? error.message : "Could not create farm.");
    } finally {
      setBusy(false);
    }
  }

  async function loadTeam() {
    if (!activeFarm || !canViewTeam) return;
    setTeamError("");
    setTeamNotice("");
    setBusy(true);
    try {
      const membersResult = await requestAllPages<{ user_id: string; role: string; created_at: string }>(
        `${window.location.origin}/api/farms/${encodeURIComponent(activeFarm.id)}/members`,
      );
      const invitationsResult = canInviteStaff
        ? await requestAllPages<{ id: string; email: string; role: string; status: string }>(
          `${window.location.origin}/api/farms/${encodeURIComponent(activeFarm.id)}/invitations`,
        )
        : [];
      setTeamMembers(membersResult);
      setTeamInvitations(invitationsResult);
      if (isFarmOwner) {
        const { data: delegationData } = await request<{ data: PermissionDelegation[] }>(
          `/api/farms/${encodeURIComponent(activeFarm.id)}/permission-delegations`,
        );
        setPermissionDelegations(delegationData);
        const firstManager = membersResult.find((member) => member.role === "manager")?.user_id ?? "";
        setDelegationManagerId((current) => current || firstManager);
        const selectedManager = delegationManagerId || firstManager;
        setDelegationPermissions(delegationData
          .filter((entry) => entry.user_id === selectedManager && !entry.revoked_at)
          .map((entry) => entry.permission_key));
      }
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : "Could not load team details.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveManagerPermissions() {
    if (!activeFarm || !isFarmOwner || !delegationManagerId) return;
    setTeamError("");
    setTeamNotice("");
    setBusy(true);
    try {
      await request(`/api/farms/${encodeURIComponent(activeFarm.id)}/permission-delegations`, {
        method: "PUT",
        body: JSON.stringify({
          managerUserId: delegationManagerId,
          permissions: delegationPermissions,
        }),
      });
      setTeamNotice("Manager permissions updated.");
      await loadTeam();
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : "Could not update manager permissions.");
      setBusy(false);
    }
  }

  async function handleInviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeFarm || !canInviteStaff) return;
    const formElement = event.currentTarget;
    setTeamError("");
    setTeamNotice("");
    setTeamSetupLink("");
    setTeamTemporaryPassword("");
    const form = new FormData(formElement);
    setBusy(true);
    const idempotencyKey = invitationIdempotencyKey.current ?? crypto.randomUUID();
    invitationIdempotencyKey.current = idempotencyKey;
    try {
      const result = await request<{ data: { id: string; setupUrl?: string; temporaryPassword?: string } }>(
        `/api/farms/${encodeURIComponent(activeFarm.id)}/invitations`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            email: String(form.get("email") ?? ""),
            fullName: String(form.get("fullName") ?? "").trim() || undefined,
            role: String(form.get("role") ?? "attendant"),
            password: String(form.get("password") ?? ""),
          }),
        },
      );
      invitationIdempotencyKey.current = null;
      formElement.reset();
      setTeamSetupLink(result.data.setupUrl ?? "");
      setTeamTemporaryPassword(result.data.temporaryPassword ?? "");
      setTeamNotice("Staff account created. Send the setup link and temporary password securely.");
      await loadTeam();
    } catch (error) {
      if (
        error instanceof RequestError
        && error.status > 0
        && error.status < 500
        && !error.message.includes("already been processed or is still in progress")
      ) {
        invitationIdempotencyKey.current = null;
      }
      setTeamError(error instanceof Error ? error.message : "Could not create invitation.");
      setBusy(false);
    }
  }

  async function handleUpdateMemberRole(userId: string, role: "manager" | "attendant" | "accountant" | "veterinarian" | "inventory_officer" | "owner") {
    if (!activeFarm || !canAssignRoles) return;
    setTeamError("");
    setTeamNotice("");
    setBusy(true);
    try {
      await request(`/api/farms/${encodeURIComponent(activeFarm.id)}/members`, {
        method: "PATCH",
        body: JSON.stringify({ userId, role }),
      });
      setTeamNotice("Member role updated.");
      await loadTeam();
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : "Could not update member role.");
      setBusy(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!activeFarm || !isFarmOwner) return;
    setTeamError("");
    setTeamNotice("");
    setBusy(true);
    try {
      await request(
        `/api/farms/${encodeURIComponent(activeFarm.id)}/members?userId=${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      );
      setTeamNotice("Member removed.");
      await loadTeam();
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : "Could not remove member.");
      setBusy(false);
    }
  }

  async function handleBatchCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeFarm) return;
    if (!generatedBatchCode) {
      setDialogError("Choose a valid placement date to generate the batch ID.");
      return;
    }
    setBusy(true);
    setFeedback("");
    setPageError("");
    const form = new FormData(event.currentTarget);
    const body = {
      farmId: activeFarm.id,
      batchCode: generatedBatchCode,
      batchType,
      house: String(form.get("house") ?? "").trim() || null,
      rearingSystem: String(form.get("rearingSystem") ?? "").trim() || null,
      datePlaced: String(form.get("datePlaced") ?? ""),
      source: String(form.get("source") ?? "").trim() || null,
      chicksOrdered: Number(form.get("chicksOrdered") || 0),
      chicksReceived: Number(form.get("chicksReceived") || 0),
    };
    try {
      const created = await request<{ data: { batch_code: string } }>("/api/batches", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setDialog(null);
      setFeedback(`Batch ${created.data.batch_code} created successfully.`);
      await refreshDashboard(activeFarm.id);
    } catch (error) {
      if (error instanceof RequestError && error.status === 409) {
        setBatchCodeSuffix(generateBatchCodeSuffix());
        await refreshDashboard(activeFarm.id);
        setDialogError(`${error.message} A new batch ID was generated; submit again.`);
      } else {
        setDialogError(error instanceof Error ? error.message : "Could not create batch.");
      }
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
    const existing = existingDailyRecord;
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

  const selectedTabTitle = tab === "overview"
    ? "Overview"
    : tab === "batches"
      ? "Flock batches"
      : tab === "daily"
        ? "Daily records"
        : tab === "health"
          ? "Health incidents"
        : tab === "revenue"
          ? "Revenue"
          : tab === "audit"
            ? "Audit history"
            : tab === "platform"
              ? "Platform administration"
              : "Overview";

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
              <span>Register new farm</span>
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
            ...(canViewHealth ? [["health", "Health incidents", "health"] as const] : []),
            ...(canViewSales ? [["revenue", "Revenue", "sales"] as const] : []),
            ...(canViewAudit ? [["audit", "Audit history", "sales"] as const] : []),
            ...(isPlatformAdmin ? [["platform", "Platform administration", "billing"] as const] : []),
          ] as const).map(([id, label, icon]) => (
            <button
              className={`nav-link ${tab === id ? "active" : ""}`}
              type="button"
              key={id}
              aria-label={label}
              aria-current={tab === id ? "page" : undefined}
              title={label}
              onClick={() => navigateToTab(id)}
            >
              <span className="nav-icon"><Icon name={icon} /></span>
              <span className="nav-label">{label}</span>
              {id === "batches" && runningBatches.length > 0 && <span className="nav-count" aria-label={`${runningBatches.length} active batches`}>{runningBatches.length}</span>}
            </button>
          ))}
          {canViewTeam && (
            <button
              className="nav-link"
              type="button"
              aria-label="Manage team"
              title="Manage team"
              onClick={() => {
                openDialog("team");
                void loadTeam();
              }}
            >
              <span className="nav-icon"><Icon name="bird" /></span>
              <span className="nav-label">Team</span>
            </button>
          )}
          <button
            className="nav-link sidebar-signout"
            type="button"
            onClick={handleSignOut}
            disabled={busy}
            aria-label="Sign out"
            title="Sign out"
          >
            <span className="nav-icon" aria-hidden="true">
              <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5" />
                <path d="M14 8l4 4-4 4M18 12H8" />
              </svg>
            </span>
            Sign out
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button className="profile-button" type="button" aria-label="Sign out" title="Sign out" onClick={handleSignOut} disabled={busy}>
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
            <div className="topbar-farm-picker">
              {farms.length > 0 ? (
                <FarmPicker farms={farms} selectedFarmId={farmId} onSelect={handleFarmSelection} onAddFarm={() => openDialog("farm")} />
              ) : (
                <button className="farm-picker add-farm-picker" type="button" onClick={() => openDialog("farm")}>
                  <span>Register new farm</span>
                </button>
              )}
            </div>
            {tab === "daily" || (tab !== "revenue" && tab !== "audit" && tab !== "platform" && canCreateBatches) ? (
              <button className="button button-primary topbar-add" type="button" disabled={!farmIsActive} onClick={() => openDialog(tab === "daily" ? "daily" : "batch")}>
                {tab === "daily" ? "Add daily record" : "New batch"}
              </button>
            ) : null}
            <MobileAccountMenu
              canViewTeam={canViewTeam}
              busy={busy}
              extraLinks={[
                ...(canViewHealth ? [{ label: "Health incidents", onClick: () => navigateToTab("health") }] : []),
                ...(canViewAudit && activeFarm ? [{ label: "Audit history", onClick: () => navigateToTab("audit") }] : []),
                ...(isPlatformAdmin ? [{ label: "Platform administration", onClick: () => navigateToTab("platform") }] : []),
              ]}
              onTeam={() => { openDialog("team"); void loadTeam(); }}
              onSignOut={() => void handleSignOut()}
            />
          </div>
        </header>

        <div className="page-content">
          {pageError && <div className="notice error-notice page-notice" role="alert">{pageError}<button type="button" aria-label="Dismiss error" onClick={() => setPageError("")}>×</button></div>}
          {feedback && <div className="notice success-notice page-notice" role="status">{feedback}<button type="button" aria-label="Dismiss message" onClick={() => setFeedback("")}>×</button></div>}
          {!farms.length ? (
            isPlatformAdmin && tab === "platform" ? (
              <PlatformAdminPage />
            ) : <section className="welcome-card">
              <span className="welcome-icon"><Icon name="bird" /></span>
              <p className="eyebrow">{farmApplications.length ? "APPLICATION STATUS" : "A good place to begin"}</p>
              <h1>{farmApplications.length ? "Your farm application is under review" : "Apply for a farm workspace"}</h1>
              <p>{farmApplications.length
                ? "You can start recording farm activity after a platform administrator approves your application."
                : "Submit your farm details for approval. Farm access is enabled after a platform administrator reviews your application."}</p>
              {farmApplications.map((application) => (
                <div className="notice" role="status" key={application.id}>
                  <strong>{application.farm_name}</strong> · {application.status.replaceAll("_", " ")}
                  {application.decision_reason && <p>{application.decision_reason}</p>}
                </div>
              ))}
              <button className="button button-primary" type="button" onClick={() => openDialog("farm")}>Submit another application</button>
              {farmError && <p className="inline-error" role="alert">{farmError}</p>}
            </section>
          ) : !activeFarm ? (
            <div className="loading-card">Loading selected farm…</div>
          ) : tab === "platform" ? (
            isPlatformAdmin
              ? <PlatformAdminPage />
              : <section className="welcome-card"><h1>Platform access is restricted</h1><p>This area is available only to platform administrators.</p></section>
          ) : !farmIsActive && tab !== "audit" ? (
            <section className="welcome-card">
              <span className="welcome-icon"><Icon name="bird" /></span>
              <p className="eyebrow">FARM ACCESS</p>
              <h1>{activeFarm.lifecycle_status === "suspended" ? "Farm access is read-only" : "Farm is not active"}</h1>
              <p>{activeFarm.lifecycle_status === "suspended"
                ? "You can review permitted records, but changes are disabled while the farm is suspended."
                : "This farm cannot record transactions until its status is active."}</p>
            </section>
          ) : tab === "overview" ? (
            <Overview
              farm={activeFarm}
              batches={dashboard?.activeBatches ?? []}
              activeBatchCount={dashboard?.activeBatchCount ?? 0}
              summary={dashboard?.summary ?? null}
              dailyRecords={dailyRecords}
              batchNames={batchNames}
              loading={loadingDashboard}
              canViewFinance={canViewFinance}
              onTabChange={navigateToTab}
              onAddDaily={() => openDialog("daily")}
            />
          ) : tab === "batches" ? (
            <BatchesPage key={farmId} farmId={farmId} initialDashboard={dashboard} loading={loadingDashboard} canCreate={canCreateBatches} canViewFinance={canViewFinance} onAdd={() => openDialog("batch")} />
          ) : tab === "daily" ? (
            <DailyPage key={farmId} farmId={farmId} batchNames={batchNames} refreshVersion={dailyRefreshVersion} onAdd={() => openDialog("daily")} />
          ) : tab === "health" ? (
            canViewHealth
              ? <HealthIncidentsPage key={activeFarm.id} farmId={activeFarm.id} batches={farmBatches} canReport={canCoordinateHealth} />
              : <section className="welcome-card"><h1>Health access is restricted</h1><p>Your farm role does not include access to health records.</p></section>
          ) : tab === "revenue" ? (
            canViewSales ? (
              <RevenuePage
                key={activeFarm.id}
                farmId={activeFarm.id}
                farmName={activeFarm.name}
                batches={farmBatches}
                loadingBatches={loadingDashboard}
                canCreateSales={canCreateSales}
                canRecordPayments={canRecordPayments}
                canViewPaymentHistory={canViewFinance}
                canDownloadReceipts={canViewFinance}
                onFeedback={setFeedback}
              />
            ) : <section className="welcome-card"><h1>Sales access is restricted</h1><p>Your farm role does not include access to sales records.</p></section>
          ) : tab === "audit" ? (
            canViewAudit
              ? <AuditPage key={activeFarm.id} farmId={activeFarm.id} role={activeFarm.role} />
              : <section className="welcome-card"><h1>Audit access is restricted</h1><p>Only the farm owner can view audit history.</p></section>
          ) : null}
        </div>
      </section>

      <BottomTabs tab={tab} batchCount={runningBatches.length} canViewSales={canViewSales} onChange={navigateToTab} />

      {dialog && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <section
            ref={dialogCardRef}
            className={`dialog-card ${dialog === "daily" ? "daily-dialog-card" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            tabIndex={-1}
          >
            <div className="dialog-heading">
              <div>
                <p className="eyebrow">{dialog === "farm" ? "CONTROLLED ONBOARDING" : dialog === "batch" ? "FLOCK MANAGEMENT" : dialog === "team" ? "OWNER CONTROLS" : "DAILY HOUSE LOG"}</p>
                <h2 id="dialog-title">{dialog === "farm" ? "Apply for a farm" : dialog === "batch" ? "Start a new batch" : dialog === "team" ? "Manage your team" : "Record today’s activity"}</h2>
                {dialog === "daily" && <p className="dialog-description">Choose a flock and date, then record what happened in the house.</p>}
              </div>
              <button className="dialog-close" type="button" aria-label="Close dialog" onClick={() => setDialog(null)}>×</button>
            </div>
            {dialog === "team" ? (
              <div className="team-dialog">
                {teamNotice && <div className="notice success-notice" role="status">{teamNotice}</div>}
                {teamError && <div className="notice error-notice" role="alert">{teamError}</div>}
                {teamSetupLink && (
                  <section className="team-setup-credentials">
                    <strong>One-time staff setup</strong>
                    <label>
                      Setup link
                      <div>
                        <input readOnly value={teamSetupLink} />
                        <button type="button" onClick={() => void navigator.clipboard.writeText(teamSetupLink)}>Copy link</button>
                      </div>
                    </label>
                    {teamTemporaryPassword && (
                      <label>
                        Temporary password
                        <div>
                          <input readOnly value={teamTemporaryPassword} />
                          <button type="button" onClick={() => void navigator.clipboard.writeText(teamTemporaryPassword)}>Copy password</button>
                        </div>
                      </label>
                    )}
                    <p>This link expires after 7 days and becomes inactive after password setup.</p>
                  </section>
                )}
                {canInviteStaff ? <form
                  className="form-stack team-invite-form"
                  onSubmit={handleInviteMember}
                  onChange={() => { invitationIdempotencyKey.current = null; }}
                >
                  <div className="team-invite-grid">
                    <label>
                      Full name
                      <input name="fullName" required maxLength={128} placeholder="Staff member name" />
                    </label>
                    <label>
                      Worker email
                      <input name="email" type="email" required autoComplete="email" placeholder="worker@example.com" />
                    </label>
                    <label>
                      Temporary password
                      <input
                        name="password"
                        type="password"
                        required
                        minLength={8}
                        maxLength={128}
                        autoComplete="new-password"
                        placeholder="At least 8 characters"
                      />
                    </label>
                    <label>
                      Role
                      <select name="role" defaultValue="attendant">
                        {isFarmOwner && <option value="manager">Manager</option>}
                        <option value="attendant">Worker (Attendant)</option>
                        <option value="veterinarian">Veterinarian</option>
                        <option value="accountant">Accountant</option>
                        <option value="inventory_officer">Inventory officer</option>
                      </select>
                    </label>
                  </div>
                  <button className="button button-primary" type="submit" disabled={busy}>
                    {busy ? "Please wait…" : "Invite team member"}
                  </button>
                </form> : <p className="team-empty">Staff invitations are not included in your current farm permissions.</p>}

                {isFarmOwner && teamMembers.some((member) => member.role === "manager") && (
                  <section className="team-section">
                    <div className="team-section-heading"><h3>Manager permissions</h3></div>
                    <p className="dialog-description">Grant only these additional permissions. Managers cannot grant permissions or promote anyone to owner or manager.</p>
                    <label>
                      Manager
                      <select
                        value={delegationManagerId}
                        onChange={(event) => {
                          const userId = event.target.value;
                          setDelegationManagerId(userId);
                          setDelegationPermissions(permissionDelegations
                            .filter((entry) => entry.user_id === userId && !entry.revoked_at)
                            .map((entry) => entry.permission_key));
                        }}
                      >
                        {teamMembers.filter((member) => member.role === "manager").map((manager) => (
                          <option key={manager.user_id} value={manager.user_id}>{manager.user_id.slice(0, 8)}</option>
                        ))}
                      </select>
                    </label>
                    <div className="team-delegation-options">
                      {DELEGABLE_MANAGER_PERMISSIONS.map(([permission, label]) => (
                        <label key={permission}>
                          <input
                            type="checkbox"
                            checked={delegationPermissions.includes(permission)}
                            onChange={(event) => setDelegationPermissions((current) => event.target.checked
                              ? [...current, permission]
                              : current.filter((value) => value !== permission))}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                    <button className="button button-secondary" type="button" onClick={() => void handleSaveManagerPermissions()} disabled={busy || !delegationManagerId}>
                      {busy ? "Saving…" : "Save manager permissions"}
                    </button>
                  </section>
                )}

                <section className="team-section">
                  <div className="team-section-heading"><h3>Farm members</h3><span>{teamMembers.length}</span></div>
                  {teamMembers.length === 0 ? (
                    <p className="team-empty">No members loaded yet.</p>
                  ) : (
                    <div className="team-list">
                      {teamMembers.map((member) => (
                        <div className="team-row" key={member.user_id}>
                          <div>
                            <strong>{member.role === "attendant" ? "Worker (Attendant)" : member.role}</strong>
                            <small>{member.user_id.slice(0, 8)}</small>
                          </div>
                          {member.role === "owner" ? (
                            <span className="team-owner-badge">Owner</span>
                          ) : canAssignRoles && (isFarmOwner || member.role !== "manager") ? (
                            <div className="team-row-actions">
                              <select
                                aria-label="Change member role"
                                value={member.role}
                                onChange={(event) => void handleUpdateMemberRole(
                                  member.user_id,
                                  event.target.value as "manager" | "attendant" | "accountant" | "veterinarian" | "inventory_officer",
                                )}
                                disabled={busy}
                              >
                                {isFarmOwner && <option value="manager">Manager</option>}
                                <option value="attendant">Worker (Attendant)</option>
                                <option value="veterinarian">Veterinarian</option>
                                <option value="accountant">Accountant</option>
                                <option value="inventory_officer">Inventory officer</option>
                              </select>
                              {isFarmOwner && <button type="button" onClick={() => void handleRemoveMember(member.user_id)} disabled={busy}>Remove</button>}
                            </div>
                          ) : <span className="team-owner-badge">{member.role}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {teamInvitations.length > 0 && (
                  <section className="team-section">
                    <div className="team-section-heading"><h3>Pending invitations</h3><span>{teamInvitations.filter((item) => item.status === "pending").length}</span></div>
                    <div className="team-list">
                      {teamInvitations.map((invitation) => (
                        <div className="team-row" key={invitation.id}>
                          <div><strong>{invitation.email}</strong><small>{invitation.role === "attendant" ? "Worker (Attendant)" : invitation.role}</small></div>
                          <span className={`team-status ${invitation.status}`}>{invitation.status}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            ) : dialog === "farm" ? (
              <form className="form-stack dialog-form" onSubmit={handleFarmCreate} onChange={() => { farmApplicationIdempotencyKey.current = null; }}>
                <p className="dialog-description">Farm access is enabled after a platform administrator reviews your application.</p>
                <label>Farm name<input name="farmName" required autoFocus maxLength={128} placeholder="e.g. Green Valley Poultry" /></label>
                <label>Opening cash balance <span className="field-note">KES</span><input name="openingBalance" type="number" min="0" step="0.01" defaultValue="0" /><small>Captured once and effective only after approval.</small></label>
                {farmError && <p className="inline-error" role="alert">{farmError}</p>}
                <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? "Submitting…" : "Submit application"}</button></div>
              </form>
            ) : dialog === "batch" ? (
              <form className="form-stack dialog-form" onSubmit={handleBatchCreate}>
                <div className="form-grid">
                  <label>Batch type<select name="batchType" value={batchType} onChange={(event) => {
                    if (event.target.value === "Broiler" || event.target.value === "Kienyeji") {
                      setBatchType(event.target.value);
                    }
                  }}><option value="Broiler">Broiler</option><option value="Kienyeji">Kienyeji</option></select></label>
                  <label>Batch ID<input name="batchCode" value={generatedBatchCode} readOnly aria-readonly="true" maxLength={64} placeholder="Generated from batch details" /><small className="generated-field-note">Generated automatically and cannot be edited.</small></label>
                  <label>Date placed<input name="datePlaced" type="date" required value={batchDatePlaced} onChange={(event) => setBatchDatePlaced(event.target.value)} /></label>
                  <label>Birds received<input name="chicksReceived" type="number" min="1" step="1" required /></label>
                  <label>Birds ordered<input name="chicksOrdered" type="number" min="0" step="1" defaultValue="0" /></label>
                  <label>House<input name="house" maxLength={64} placeholder="e.g. House 1" value={batchHouse} onChange={(event) => setBatchHouse(event.target.value)} /></label>
                  <label>Rearing system<input name="rearingSystem" maxLength={64} placeholder="e.g. Deep litter" /></label>
                  <label>Source / supplier<input name="source" maxLength={128} placeholder="Optional" /></label>
                </div>
                {dialogError && <p className="inline-error" role="alert">{dialogError}</p>}
                <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy || loadingDashboard || !generatedBatchCode}>{busy ? "Saving…" : loadingDashboard ? "Loading batches…" : "Create batch"}</button></div>
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
                      <label>Active batch<select name="batchId" required value={dailyBatchId} onChange={(event) => { setDialogError(""); setDailyBatchId(event.target.value); }}><option value="" disabled>Select a running batch</option>{runningBatches.map((batch) => <option key={batch.id} value={batch.id}>{batch.batch_code} · {batch.batch_type}{batch.house ? ` · ${batch.house}` : ""}</option>)}</select></label>
                      <label>Date<input name="recordDate" type="date" required value={dailyRecordDate} onChange={(event) => { setDialogError(""); setDailyRecordDate(event.target.value); }} /></label>
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
                <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy || dailyRecordLookupLoading || dailyRecordLookupFailed || !runningBatches.length || (Boolean(existingDailyRecord) && !canEditRecords)}>{busy ? "Saving…" : dailyRecordLookupLoading ? "Checking record…" : existingDailyRecord ? canEditRecords ? "Update daily record" : "Already recorded" : "Save daily record"}</button></div>
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
  activeBatchCount,
  summary,
  dailyRecords,
  batchNames,
  loading,
  canViewFinance,
  onTabChange,
  onAddDaily,
}: {
  farm: Farm;
  batches: Batch[];
  activeBatchCount: number;
  summary: FarmSummary | null;
  dailyRecords: DailyRecord[];
  batchNames: Map<string, string>;
  loading: boolean;
  canViewFinance: boolean;
  onTabChange: (tab: Tab) => void;
  onAddDaily: () => void;
}) {
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
        <div><p className="banner-kicker">YOUR FARM, AT A GLANCE</p><h2>{activeBatchCount ? `${activeBatchCount} active ${activeBatchCount === 1 ? "batch" : "batches"} in progress` : "Your next batch starts here"}</h2><p>{activeBatchCount ? "Keep your daily records consistent to make performance insights more useful." : "Create a batch record to start tracking flock performance."}</p></div>
        <button className="banner-button" type="button" onClick={() => onTabChange("batches")}>View batches <span aria-hidden="true">→</span></button>
      </div>
      <section className="metric-grid" aria-label="Farm metrics">
        <Metric icon="bird" label="Birds placed" value={formatNumber(summary?.birds_placed)} note={`${formatNumber(summary?.batches_recorded)} batches recorded`} tone="green" />
        {canViewFinance && (
          <>
            <Metric icon="cash" label="Cash balance" value={formatKes(summary?.cash_balance_kes)} note="Opening balance + cash activity" tone="blue" />
            <Metric icon="sales" label="Revenue recorded" value={formatKes(summary?.revenue_kes)} note={`${formatKes(summary?.accounts_receivable_kes)} outstanding · View revenue`} tone="gold" onClick={() => onTabChange("revenue")} />
          </>
        )}
        <Metric icon="feed" label="Feed on hand" value={`${formatNumber(summary?.feed_stock_on_hand_kg, 1)} kg`} note={canViewFinance ? `${formatNumber(summary?.total_expenses_kes)} KES total expenses` : "Current inventory balance"} tone="lilac" />
      </section>
      <div className="content-grid">
        <section className="content-card batch-card">
          <div className="card-heading"><div><p className="eyebrow">YOUR FLOCK</p><h2>Active batches</h2></div><button className="text-button" type="button" onClick={() => onTabChange("batches")}>All batches <span aria-hidden="true">→</span></button></div>
          {loading ? <div className="empty-inline">Loading your latest farm data…</div> : batches.length ? (
            <div className="batch-list">
              {batches.slice(0, 4).map((batch) => {
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

function EmptyState({ title, detail, action, onClick }: { title: string; detail: string; action: string; onClick: () => void }) {
  return <div className="empty-state"><span className="empty-illustration"><Icon name="bird" /></span><strong>{title}</strong><p>{detail}</p><button className="text-button" type="button" onClick={onClick}>{action} <span aria-hidden="true">→</span></button></div>;
}
