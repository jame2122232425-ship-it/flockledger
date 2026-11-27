"use client";

import { useEffect, useState } from "react";
import { PaginationControls } from "@/components/pagination-controls";
import { request } from "@/lib/client/request";
import { dateTimeInNairobi, formatNumber } from "@/lib/format";
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
const operationLabels: Record<AuditEvent["operation"], string> = {
  INSERT: "Created",
  UPDATE: "Updated",
  DELETE: "Deleted",
};

function dateBound(value: string, endOfDay: boolean) {
  if (!value) return "";
  return `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+03:00`;
}

function displayFilterDate(value: string) {
  if (!value) return "Any date";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
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
  const dateRangeLabel = from || to
    ? `${displayFilterDate(from)} – ${displayFilterDate(to)}`
    : "All dates";

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
      <header className="content-card audit-hero">
        <div className="audit-hero-copy">
          <div className="audit-eyebrow-row">
            <p className="eyebrow">FARM GOVERNANCE</p>
            <span className="audit-owner-badge">Owner only</span>
          </div>
          <h1>Audit log</h1>
          <p>Review a traceable history of changes made across your farm.</p>
        </div>
        <div className="audit-hero-actions">
          <span>Audit access is recorded</span>
          <button className="button button-primary audit-export-button" type="button" onClick={() => void downloadExport()} disabled={loading || exporting}>
            <span aria-hidden="true">↓</span>
            {exporting ? "Preparing export…" : "Export CSV"}
          </button>
        </div>
      </header>

      <section className="audit-overview" aria-label="Audit log overview">
        <article className="content-card audit-overview-card">
          <span className="audit-overview-icon audit-overview-icon-green" aria-hidden="true">#</span>
          <div>
            <p>Matching events</p>
            <strong>{loading ? "—" : formatNumber(pagination.total)}</strong>
            <span>For the selected filters</span>
          </div>
        </article>
        <article className="content-card audit-overview-card">
          <span className="audit-overview-icon audit-overview-icon-blue" aria-hidden="true">↕</span>
          <div>
            <p>Current page</p>
            <strong>{loading ? "—" : `${pagination.page} / ${Math.max(pagination.pageCount, 1)}`}</strong>
            <span>{loading ? "Loading events" : `${formatNumber(visibleEvents.length)} events shown`}</span>
          </div>
        </article>
        <article className="content-card audit-overview-card">
          <span className="audit-overview-icon audit-overview-icon-amber" aria-hidden="true">◷</span>
          <div>
            <p>Date range</p>
            <strong>{dateRangeLabel}</strong>
            <span>Times are shown in East Africa Time</span>
          </div>
        </article>
      </section>

      <section className="content-card audit-filter-panel" aria-label="Audit filters">
        <div className="audit-filter-heading">
          <div>
            <p className="eyebrow">REFINE HISTORY</p>
            <h2>Find an activity</h2>
          </div>
          {(from || to) && (
            <button
              className="audit-clear-filters"
              type="button"
              onClick={() => { setFrom(""); setTo(""); setPage(1); }}
            >
              Clear dates
            </button>
          )}
        </div>
        <div className="audit-category-tabs" role="group" aria-label="Activity category">
          {categories.map((option) => (
            <button
              className={category === option ? "selected" : ""}
              type="button"
              aria-pressed={category === option}
              key={option}
              onClick={() => { setSelectedCategory(option); setPage(1); }}
            >
              {labels[option]}
            </button>
          ))}
        </div>
        <div className="audit-date-filters">
          <label>
            <span>From date</span>
            <input type="date" value={from} max={to || undefined} onChange={(event) => { setFrom(event.target.value); setPage(1); }} />
          </label>
          <label>
            <span>To date</span>
            <input type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setPage(1); }} />
          </label>
        </div>
      </section>

      {error && (
        <div className="notice error-notice" role="alert">
          {error}
          <button className="revenue-action-link primary" type="button" onClick={() => setRefreshKey((current) => current + 1)}>
            Try again
          </button>
        </div>
      )}
      <section className="content-card audit-activity-panel" aria-labelledby="audit-activity-heading">
        <div className="audit-activity-heading">
          <div>
            <p className="eyebrow">RECENT CHANGES</p>
            <h2 id="audit-activity-heading">Activity history</h2>
            <p>Each entry includes its record, actor and before-and-after details.</p>
          </div>
          <span className="audit-result-count">
            {loading ? "Loading" : `${formatNumber(pagination.total)} ${pagination.total === 1 ? "event" : "events"}`}
          </span>
        </div>
        {loading ? (
          <div className="audit-state" role="status">
            <span className="audit-loading-mark" aria-hidden="true" />
            <span>Loading activity history…</span>
          </div>
        ) : visibleEvents.length ? (
          <>
            <ol className="audit-event-list">
              {visibleEvents.map((event) => (
                <li className="audit-event-item" key={event.id}>
                  <span className={`audit-event-marker audit-event-marker-${event.operation.toLowerCase()}`} aria-hidden="true" />
                  <article className="audit-event-card">
                    <div className="audit-event-main">
                      <div className="audit-event-title">
                        <span className={`audit-operation-badge audit-operation-${event.operation.toLowerCase()}`}>
                          {operationLabels[event.operation]}
                        </span>
                        <h3>{event.table_name.replaceAll("_", " ")}</h3>
                        <span className="audit-event-id">Event #{event.id}</span>
                      </div>
                      <p className="audit-event-record">Record <code>{event.record_id}</code></p>
                      <div className="audit-event-meta">
                        <span><time dateTime={event.occurred_at}>{dateTimeInNairobi(event.occurred_at)}</time></span>
                        <span className="audit-event-actor">
                          <span>{event.actor_id ? "Actor" : "Performed by"}</span>
                          <code>{event.actor_id ?? "System"}</code>
                        </span>
                      </div>
                    </div>
                    <button
                      className="button button-quiet audit-review-button"
                      type="button"
                      onClick={() => setSelectedEvent(event)}
                      aria-label={`Open audit event ${event.id}`}
                    >
                      Review event <span aria-hidden="true">→</span>
                    </button>
                  </article>
                </li>
              ))}
            </ol>
            <PaginationControls pagination={pagination} onPageChange={setPage} />
          </>
        ) : (
          <div className="audit-empty-state">
            <span className="audit-empty-icon" aria-hidden="true">⌕</span>
            <h3>{error ? "Activity could not be loaded" : "No matching activity"}</h3>
            <p>{error ? "Try loading the activity again." : "Adjust the category or clear your date filters to see more entries."}</p>
            {error ? (
              <button className="button button-quiet" type="button" onClick={() => setRefreshKey((current) => current + 1)}>
                Try again
              </button>
            ) : (from || to) ? (
              <button className="button button-quiet" type="button" onClick={() => { setFrom(""); setTo(""); setPage(1); }}>
                Clear date filters
              </button>
            ) : null}
          </div>
        )}
      </section>
    </section>
  );
}

function AuditEventDetail({ event, onBack }: { event: AuditEvent; onBack: () => void }) {
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
