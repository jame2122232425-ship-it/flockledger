"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "@/components/app-icon";
import { PaginationControls } from "@/components/pagination-controls";
import { request } from "@/lib/client/request";
import { formatKes, formatNumber, shortDate } from "@/lib/format";
import type { PageMetadata } from "@/lib/api/pagination";
import type {
  Batch,
  BatchDetail,
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

function RecordDetailPage({
  eyebrow,
  title,
  subtitle,
  onBack,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="page-heading record-detail-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        <button className="button button-quiet" type="button" onClick={onBack}>Back to list</button>
      </div>
      <section className="content-card record-detail-card">{children}</section>
    </>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="record-detail-section">
      <h2>{title}</h2>
      <dl className="record-detail-grid">{children}</dl>
    </section>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || "—"}</dd>
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
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [batchDetail, setBatchDetail] = useState<{
    batchId: string;
    data?: BatchDetail;
    error?: string;
  } | null>(null);
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

  useEffect(() => {
    if (!selectedBatch) return;
    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams({ farmId });
    request<{ data: BatchDetail }>(
      `/api/batches/${encodeURIComponent(selectedBatch.batch_id)}?${params.toString()}`,
      { signal: controller.signal },
    ).then((result) => {
      if (active) setBatchDetail({ batchId: selectedBatch.batch_id, data: result.data });
    }).catch((loadError: unknown) => {
      if (active) {
        setBatchDetail({
          batchId: selectedBatch.batch_id,
          error: loadError instanceof Error ? loadError.message : "Could not load batch details.",
        });
      }
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [farmId, selectedBatch]);

  function selectFilter(nextFilter: "all" | "running" | "closed") {
    setPage(1);
    setFilter(nextFilter);
  }

  if (selectedBatch) {
    const details = batchDetail?.batchId === selectedBatch.batch_id ? batchDetail.data : undefined;
    const detailError = batchDetail?.batchId === selectedBatch.batch_id ? batchDetail.error : undefined;
    return (
      <RecordDetailPage
        eyebrow="FLOCK MANAGEMENT"
        title={selectedBatch.batch_code}
        subtitle={`${selectedBatch.batch_type}${selectedBatch.house ? ` · ${selectedBatch.house}` : ""}`}
        onBack={() => setSelectedBatch(null)}
      >
        {detailError && <div className="notice error-notice" role="alert">{detailError}</div>}
        {!details && !detailError && <div className="empty-inline" role="status">Loading batch details…</div>}
        <DetailSection title="Batch information">
          <DetailField label="Status" value={(details ?? selectedBatch).status === "running" ? "Active" : "Closed"} />
          <DetailField label="Date placed" value={shortDate((details ?? selectedBatch).date_placed)} />
          <DetailField label="Date closed" value={details?.date_sold_out ? shortDate(details.date_sold_out) : "—"} />
          <DetailField label="House" value={details?.house ?? selectedBatch.house ?? "—"} />
          <DetailField label="Rearing system" value={details?.rearing_system ?? "—"} />
          <DetailField label="Source" value={details?.source ?? "—"} />
          <DetailField label="Strain" value={details?.strain ?? "—"} />
          <DetailField label="Chicks ordered" value={details ? formatNumber(details.chicks_ordered) : "—"} />
          <DetailField label="Birds placed" value={formatNumber((details ?? selectedBatch).chicks_received)} />
          <DetailField label="Age" value={(details ?? selectedBatch).status === "running" ? `Day ${formatNumber((details ?? selectedBatch).age_days)}` : "Closed"} />
          <DetailField label="Notes" value={details?.remarks ?? "—"} />
        </DetailSection>
        <DetailSection title="Flock performance">
          <DetailField label="Deaths" value={formatNumber((details ?? selectedBatch).dead)} />
          <DetailField label="Culls" value={formatNumber((details ?? selectedBatch).culled)} />
          <DetailField label="Mortality" value={`${formatNumber((details ?? selectedBatch).mortality_percent, 1)}%`} />
          <DetailField label="Livability" value={details ? `${formatNumber(details.livability_percent, 1)}%` : "—"} />
          <DetailField label="Birds sold" value={formatNumber((details ?? selectedBatch).birds_sold)} />
          <DetailField label="Live weight sold" value={details ? `${formatNumber(details.live_weight_sold_kg, 2)} kg` : "—"} />
          <DetailField label="Average sold weight" value={details?.avg_live_weight_sold_kg == null ? "—" : `${formatNumber(details.avg_live_weight_sold_kg, 2)} kg`} />
          <DetailField label="Feed consumed" value={`${formatNumber((details ?? selectedBatch).feed_consumed_kg, 2)} kg`} />
          <DetailField label="Feed conversion ratio" value={(details ?? selectedBatch).fcr == null ? "—" : formatNumber((details ?? selectedBatch).fcr, 2)} />
          <DetailField label="EPEF" value={details?.epef == null ? "—" : formatNumber(details.epef, 1)} />
        </DetailSection>
        <DetailSection title="Revenue">
          <DetailField label="Sales" value={formatKes((details ?? selectedBatch).revenue_kes)} />
          <DetailField label="Payments received" value={details ? formatKes(details.paid_kes) : "—"} />
          <DetailField label="Outstanding" value={formatKes((details ?? selectedBatch).outstanding_kes)} />
          <DetailField label="Total costs" value={details ? formatKes(details.total_cost_kes) : "—"} />
          <DetailField label="Profit" value={details ? formatKes(details.profit_kes) : "—"} />
        </DetailSection>
      </RecordDetailPage>
    );
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
                    <th>Age</th><th>Mortality</th><th>FCR</th><th>Actions</th>
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
                      <td><button className="revenue-action-link" type="button" onClick={() => { setBatchDetail(null); setSelectedBatch(batch); }}>Details</button></td>
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
  const [selectedRecord, setSelectedRecord] = useState<DailyRecord | null>(null);
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

  if (selectedRecord) {
    return (
      <RecordDetailPage
        eyebrow="DAILY FARM ROUTINE"
        title="Daily record"
        subtitle={`${shortDate(selectedRecord.record_date)} · ${batchNames.get(selectedRecord.batch_id) ?? "Batch"}`}
        onBack={() => setSelectedRecord(null)}
      >
        <DetailSection title="Flock activity">
          <DetailField label="Date" value={shortDate(selectedRecord.record_date)} />
          <DetailField label="Batch" value={batchNames.get(selectedRecord.batch_id) ?? "—"} />
          <DetailField label="Deaths" value={formatNumber(selectedRecord.dead)} />
          <DetailField label="Culls" value={formatNumber(selectedRecord.culled)} />
          <DetailField label="Recorded by" value={selectedRecord.initials ?? "—"} />
        </DetailSection>
        <DetailSection title="Feed and water">
          <DetailField label="Feed given" value={`${formatNumber(selectedRecord.feed_given_kg, 2)} kg`} />
          <DetailField label="Feed left" value={`${formatNumber(selectedRecord.feed_left_kg, 2)} kg`} />
          <DetailField label="Feed used" value={`${formatNumber(selectedRecord.feed_given_kg - selectedRecord.feed_left_kg, 2)} kg`} />
          <DetailField label="Water" value={`${formatNumber(selectedRecord.water_liters, 1)} L`} />
        </DetailSection>
        <DetailSection title="House conditions and notes">
          <DetailField label="Minimum temperature" value={selectedRecord.temp_min_c === null ? "—" : `${formatNumber(selectedRecord.temp_min_c, 1)} °C`} />
          <DetailField label="Maximum temperature" value={selectedRecord.temp_max_c === null ? "—" : `${formatNumber(selectedRecord.temp_max_c, 1)} °C`} />
          <DetailField label="Litter" value={selectedRecord.litter ?? "—"} />
          <DetailField label="Remarks" value={selectedRecord.remarks ?? "—"} />
        </DetailSection>
      </RecordDetailPage>
    );
  }

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
                  <tr><th>Date</th><th>Batch</th><th>Feed used</th><th>Water</th><th>Deaths</th><th>Culls</th><th>Initials</th><th>Actions</th></tr>
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
                      <td><button className="revenue-action-link" type="button" onClick={() => setSelectedRecord(record)}>Details</button></td>
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
