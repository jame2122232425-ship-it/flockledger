"use client";

import { useEffect, useState } from "react";
import { PaginationControls } from "@/components/pagination-controls";
import { request } from "@/lib/client/request";
import { dateTimeInNairobi } from "@/lib/format";
import type { PageMetadata } from "@/lib/api/pagination";

type AuditCategory = "all" | "operational" | "financial" | "inventory";
type AuditEvent = {
  id: number;
  farm_id: string;
  table_name: string;
  record_id: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  actor_id: string | null;
  old_data: unknown | null;
  new_data: unknown | null;
  occurred_at: string;
};

const ownerAuditCategories: AuditCategory[] = ["all", "operational", "financial", "inventory"];
const noAuditCategories: AuditCategory[] = [];
const emptyPagination: PageMetadata = {
  page: 1,
  pageSize: 25,
  total: 0,
  pageCount: 0,
  hasMore: false,
};
const labels: Record<AuditCategory, string> = {
  all: "All categories",
  operational: "Operational",
  financial: "Financial",
  inventory: "Inventory",
};

function dateBound(value: string, endOfDay: boolean) {
  if (!value) return "";
  return `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+03:00`;
}

function displayJson(value: unknown | null) {
  return value == null ? "No snapshot recorded" : JSON.stringify(value, null, 2);
}

export function AuditPage({ farmId, role }: { farmId: string; role: string }) {
  const categories = role === "owner" ? ownerAuditCategories : noAuditCategories;
  const [selectedCategory, setSelectedCategory] = useState<AuditCategory>(categories[0] ?? "operational");
  const category = categories.includes(selectedCategory) ? selectedCategory : categories[0] ?? "operational";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [pageResult, setPageResult] = useState<{
    queryKey: string;
    pagination: PageMetadata;
  } | null>(null);
  const [loadedQueryKey, setLoadedQueryKey] = useState("");
  const [queryError, setQueryError] = useState<{ queryKey: string; message: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const fromBound = dateBound(from, false);
  const toBound = dateBound(to, true);
  const queryKey = `${farmId}:${category}:${fromBound}:${toBound}:${page}:${refreshKey}`;
  const loading = loadedQueryKey !== queryKey;
  const error = queryError?.queryKey === queryKey ? queryError.message : "";
  const pagination = pageResult?.queryKey === queryKey ? pageResult.pagination : emptyPagination;
  const visibleEvents = loading ? [] : events;

  useEffect(() => {
    if (!categories.length) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      farmId,
      category,
      page: String(page),
      pageSize: "25",
    });
    if (fromBound) params.set("from", fromBound);
    if (toBound) params.set("to", toBound);
    request<{ data: AuditEvent[]; pagination: PageMetadata }>(
      `/api/audit-events?${params.toString()}`,
      { signal: controller.signal },
    ).then((result) => {
      setEvents(result.data);
      setPageResult({ queryKey, pagination: result.pagination });
      setLoadedQueryKey(queryKey);
    }).catch((loadError: unknown) => {
      if (controller.signal.aborted) return;
      setEvents([]);
      setQueryError({
        queryKey,
        message: loadError instanceof Error ? loadError.message : "Could not load audit events.",
      });
      setLoadedQueryKey(queryKey);
    });
    return () => controller.abort();
  }, [categories.length, category, farmId, fromBound, page, queryKey, toBound]);

  const downloadExport = async () => {
    const params = new URLSearchParams({ farmId, category, export: "csv" });
    if (fromBound) params.set("from", fromBound);
    if (toBound) params.set("to", toBound);
    setExporting(true);
    setQueryError(null);
    try {
      const response = await fetch(`/api/audit-events?${params.toString()}`, {
        credentials: "same-origin",
        headers: { Accept: "text/csv" },
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message = body && typeof body === "object" && "error" in body
          && typeof body.error === "string"
          ? body.error
          : "Could not export audit events.";
        throw new Error(message);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `flockledger-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (exportError) {
      setQueryError({
        queryKey,
        message: exportError instanceof Error ? exportError.message : "Could not export audit events.",
      });
    } finally {
      setExporting(false);
    }
  };

  if (role !== "owner") {
    return (
      <section className="audit-page">
        <div className="content-card audit-restricted">
          <h1>Audit access is restricted</h1>
          <p>Only the farm owner can view audit history.</p>
        </div>
      </section>
    );
  }

  if (selectedEvent) {
    return <AuditEventDetail event={selectedEvent} onBack={() => setSelectedEvent(null)} />;
  }

  return (
    <section className="audit-page">
      <div className="content-card audit-toolbar">
        <div>
          <p className="eyebrow">AUDIT TRAIL</p>
          <h1>Farm activity history</h1>
          <p>Only the farm owner can view this history. Successful views and exports are recorded.</p>
        </div>
        <button className="button button-quiet" type="button" onClick={() => void downloadExport()} disabled={loading || exporting}>
          {exporting ? "Preparing export…" : "Export CSV"}
        </button>
        <div className="audit-filters">
          <label>
            Category
            <select value={category} onChange={(event) => { setSelectedCategory(event.target.value as AuditCategory); setPage(1); }}>
              {categories.map((option) => <option value={option} key={option}>{labels[option]}</option>)}
            </select>
          </label>
          <label>
            From
            <input type="date" value={from} max={to || undefined} onChange={(event) => { setFrom(event.target.value); setPage(1); }} />
          </label>
          <label>
            To
            <input type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setPage(1); }} />
          </label>
        </div>
      </div>

      {error && (
        <div className="notice error-notice" role="alert">
          {error}
          <button className="revenue-action-link primary" type="button" onClick={() => setRefreshKey((current) => current + 1)}>
            Try again
          </button>
        </div>
      )}
      <section className="content-card table-card">
        <div className="table-toolbar">
          <div><h2 className="table-title">Recorded changes</h2><p className="table-subtitle">Before-and-after snapshots are available to the farm owner.</p></div>
          <span className="table-hint">{pagination.total} events</span>
        </div>
        {loading ? (
          <div className="empty-inline" role="status">Loading audit history…</div>
        ) : visibleEvents.length ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>When</th><th>Area</th><th>Change</th><th>Record</th><th>Actor</th><th>Details</th></tr>
                </thead>
                <tbody>
                  {visibleEvents.map((event) => (
                    <tr key={event.id}>
                      <td>{dateTimeInNairobi(event.occurred_at)}</td>
                      <td>{event.table_name.replaceAll("_", " ")}</td>
                      <td>{event.operation}</td>
                      <td><code>{event.record_id}</code></td>
                      <td>{event.actor_id ?? "System"}</td>
                      <td>
                        <button
                          className="audit-detail-link"
                          type="button"
                          onClick={() => setSelectedEvent(event)}
                          aria-label={`Open audit event ${event.id}`}
                        >
                          View details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationControls pagination={pagination} onPageChange={setPage} />
          </>
        ) : (
          <div className="empty-inline">{error ? "Audit history could not be loaded." : "No audit events match these filters."}</div>
        )}
      </section>
    </section>
  );
}

function AuditEventDetail({ event, onBack }: { event: AuditEvent; onBack: () => void }) {
  const operationLabels: Record<AuditEvent["operation"], string> = {
    INSERT: "Created",
    UPDATE: "Updated",
    DELETE: "Deleted",
  };

  return (
    <section className="audit-page audit-event-detail" aria-labelledby="audit-event-heading">
      <header className="content-card audit-detail-header">
        <button className="button button-quiet audit-detail-back" type="button" onClick={onBack}>
          Back to history
        </button>
        <div>
          <p className="eyebrow">{`AUDIT EVENT #${event.id}`}</p>
          <div className="audit-detail-title">
            <h1 id="audit-event-heading">{event.table_name.replaceAll("_", " ")}</h1>
            <span className={`audit-operation-badge audit-operation-${event.operation.toLowerCase()}`}>
              {operationLabels[event.operation]}
            </span>
          </div>
          <p>Recorded change to a farm record.</p>
        </div>
      </header>

      <dl className="content-card audit-detail-metadata">
        <div>
          <dt>Record ID</dt>
          <dd><code>{event.record_id}</code></dd>
        </div>
        <div>
          <dt>Farm ID</dt>
          <dd><code>{event.farm_id}</code></dd>
        </div>
        <div>
          <dt>Actor</dt>
          <dd>{event.actor_id ?? "System"}</dd>
        </div>
        <div>
          <dt>Recorded at (EAT)</dt>
          <dd><time dateTime={event.occurred_at}>{dateTimeInNairobi(event.occurred_at)}</time></dd>
        </div>
      </dl>

      <section className="audit-detail-snapshots" aria-label="Before and after snapshots">
        <article className="content-card audit-snapshot-card">
          <div className="audit-snapshot-heading">
            <div>
              <p className="eyebrow">PREVIOUS STATE</p>
              <h2>Before</h2>
            </div>
          </div>
          <pre aria-label="Before snapshot">{displayJson(event.old_data)}</pre>
        </article>
        <article className="content-card audit-snapshot-card">
          <div className="audit-snapshot-heading">
            <div>
              <p className="eyebrow">RECORDED STATE</p>
              <h2>After</h2>
            </div>
          </div>
          <pre aria-label="After snapshot">{displayJson(event.new_data)}</pre>
        </article>
      </section>
    </section>
  );
}
