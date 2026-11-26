"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/app-icon";
import { PaginationControls } from "@/components/pagination-controls";
import { request } from "@/lib/client/request";
import { formatNumber, shortDate } from "@/lib/format";
import type { PageMetadata } from "@/lib/api/pagination";
import type {
  Batch,
  DailyRecord,
  DashboardPayload,
} from "@/lib/farm/types";

function EmptyState({
  title,
  detail,
  action,
  onClick,
}: {
  title: string;
  detail: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="empty-state">
      <span className="empty-illustration"><Icon name="bird" /></span>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action && onClick && (
        <button className="text-button" type="button" onClick={onClick}>
          {action} <span aria-hidden="true">→</span>
        </button>
      )}
    </div>
  );
}

export function BatchesPage({
  farmId,
  initialDashboard,
  loading,
  canCreate,
  onAdd,
}: {
  farmId: string;
  initialDashboard: DashboardPayload | null;
  loading: boolean;
  canCreate: boolean;
  onAdd: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "running" | "closed">("all");
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState<{ key: string; data: DashboardPayload } | null>(null);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const pageKey = `${filter}:${page}`;
  const payload = loaded?.key === pageKey
    ? loaded.data
    : filter === "all" && page === 1
      ? initialDashboard
      : null;
  const visible = payload?.data ?? [];
  const pageLoading = !payload && loadError?.key !== pageKey;
  const error = !payload && loadError?.key === pageKey ? loadError.message : "";

  useEffect(() => {
    if (!farmId || (filter === "all" && page === 1 && (initialDashboard || loading))) return;
    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams({
      farmId,
      page: String(page),
      pageSize: "25",
    });
    if (filter !== "all") params.set("status", filter);
    request<DashboardPayload>(`/api/dashboard?${params.toString()}`, {
      signal: controller.signal,
    }).then((data) => {
      if (active) setLoaded({ key: pageKey, data });
    }).catch((loadError: unknown) => {
      if (active) {
        setLoadError({
          key: pageKey,
          message: loadError instanceof Error ? loadError.message : "Could not load batches.",
        });
      }
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [farmId, filter, initialDashboard, loading, page, pageKey]);

  function selectFilter(nextFilter: "all" | "running" | "closed") {
    setPage(1);
    setFilter(nextFilter);
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">FLOCK MANAGEMENT</p>
          <h1>Your batches</h1>
          <p className="page-subtitle">Follow every flock from placement through closeout.</p>
        </div>
        {canCreate && <button className="button button-primary" type="button" onClick={onAdd}>New batch</button>}
      </div>
      <section className="content-card table-card">
        <div className="table-toolbar">
          <div className="filter-tabs" role="group" aria-label="Filter batches">
            {(["all", "running", "closed"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? "selected" : ""}
                onClick={() => selectFilter(item)}
              >
                {item === "all" ? "All batches" : item === "running" ? "Active" : "Closed"}
                <span>{payload?.batchCounts[item] ?? initialDashboard?.batchCounts[item] ?? 0}</span>
              </button>
            ))}
          </div>
          <span className="table-hint">{payload?.pagination.total ?? 0} batches</span>
        </div>
        {(loading && !initialDashboard) || pageLoading ? (
          <div className="empty-inline">Loading batches…</div>
        ) : error ? (
          <div className="notice error-notice" role="alert">{error}</div>
        ) : payload && visible.length ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Batch</th><th>Status</th><th>Placed</th><th>Birds placed</th>
                    <th>Age</th><th>Mortality</th><th>FCR</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((batch: Batch) => (
                    <tr key={batch.batch_id}>
                      <td>
                        <span className="table-batch">
                          <span className={`table-batch-mark ${batch.batch_type === "Broiler" ? "broiler" : "kienyeji"}`}>
                            <Icon name="bird" />
                          </span>
                          <span>
                            <strong>{batch.batch_code}</strong>
                            <small>{batch.batch_type}{batch.house ? ` · ${batch.house}` : ""}</small>
                          </span>
                        </span>
                      </td>
                      <td><span className={`status-pill ${batch.status}`}>{batch.status === "running" ? "Active" : "Closed"}</span></td>
                      <td>{shortDate(batch.date_placed)}</td>
                      <td>{formatNumber(batch.chicks_received)}</td>
                      <td>{batch.status === "running" ? `Day ${formatNumber(batch.age_days)}` : "—"}</td>
                      <td>{formatNumber(batch.mortality_percent, 1)}%</td>
                      <td>{batch.fcr == null ? "—" : formatNumber(batch.fcr, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationControls pagination={payload.pagination} onPageChange={setPage} />
          </>
        ) : (
          <EmptyState
            title={filter === "all" ? "No batches recorded" : `No ${filter} batches`}
            detail={canCreate
              ? "Create a batch record to begin tracking flock performance."
              : "Only farm owners and managers can create batches. Ask an owner to help you get started."}
            action={canCreate ? "Create a batch" : undefined}
            onClick={canCreate ? onAdd : undefined}
          />
        )}
      </section>
    </>
  );
}

export function DailyPage({
  farmId,
  batchNames,
  refreshVersion,
  onAdd,
}: {
  farmId: string;
  batchNames: Map<string, string>;
  refreshVersion: number;
  onAdd: () => void;
}) {
  const [page, setPage] = useState(1);
  const [loadedPage, setLoadedPage] = useState<{
    key: string;
    records: DailyRecord[];
    pagination: PageMetadata;
  } | null>(null);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const pageKey = `${farmId}:${page}:${refreshVersion}`;
  const pagination: PageMetadata = loadedPage?.key === pageKey
    ? loadedPage.pagination
    : { page: 1, pageSize: 25, total: 0, pageCount: 0, hasMore: false };
  const records = loadedPage?.key === pageKey ? loadedPage.records : [];
  const loading = loadedPage?.key !== pageKey && loadError?.key !== pageKey;
  const error = loadError?.key === pageKey ? loadError.message : "";

  useEffect(() => {
    if (!farmId) return;
    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams({
      farmId,
      page: String(page),
      pageSize: "25",
    });
    request<{ data: DailyRecord[]; pagination: PageMetadata }>(
      `/api/daily-records?${params.toString()}`,
      { signal: controller.signal },
    ).then((result) => {
      if (!active) return;
      setLoadedPage({
        key: pageKey,
        records: result.data,
        pagination: result.pagination,
      });
    }).catch((loadError: unknown) => {
      if (!active) return;
      setLoadError({
        key: pageKey,
        message: loadError instanceof Error ? loadError.message : "Could not load daily records.",
      });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [farmId, page, pageKey, refreshVersion]);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">DAILY FARM ROUTINE</p>
          <h1>Daily records</h1>
          <p className="page-subtitle">A clear history of feed, water, flock losses, and house conditions.</p>
        </div>
        <button className="button button-primary" type="button" onClick={onAdd}>Add daily record</button>
      </div>
      <section className="content-card table-card">
        <div className="table-toolbar">
          <div>
            <h2 className="table-title">Recent activity</h2>
            <p className="table-subtitle">Most recent records across all batches</p>
          </div>
          <span className="table-hint">{pagination.total} records</span>
        </div>
        {error && <div className="notice error-notice" role="alert">{error}</div>}
        {loading ? (
          <div className="empty-inline">Loading daily records…</div>
        ) : records.length ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Date</th><th>Batch</th><th>Feed used</th><th>Water</th><th>Deaths</th><th>Culls</th><th>Initials</th></tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id}>
                      <td>{shortDate(record.record_date)}</td>
                      <td><strong>{batchNames.get(record.batch_id) ?? "—"}</strong></td>
                      <td>{formatNumber(record.feed_given_kg - record.feed_left_kg, 2)} kg</td>
                      <td>{formatNumber(record.water_liters, 1)} L</td>
                      <td>{formatNumber(record.dead)}</td>
                      <td>{formatNumber(record.culled)}</td>
                      <td>{record.initials || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationControls pagination={pagination} onPageChange={setPage} />
          </>
        ) : (
          <EmptyState
            title="No daily records yet"
            detail="Start with today’s activity. Add feed use, water, and flock observations."
            action="Add daily record"
            onClick={onAdd}
          />
        )}
      </section>
    </>
  );
}
