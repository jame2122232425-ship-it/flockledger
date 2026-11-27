"use client";

import { useCallback, useEffect, useState } from "react";
import { request } from "@/lib/client/request";
import { dateTimeInNairobi } from "@/lib/format";

type Application = {
  application_id: string;
  farm_id: string;
  farm_name: string;
  owner_user_id: string;
  owner_name: string | null;
  owner_email: string;
  status: string;
  created_at: string;
  submitted_at: string | null;
  decision_reason: string | null;
};

type PlatformAuditEvent = {
  id: number;
  actor_user_id: string | null;
  event_type: string;
  application_id: string | null;
  farm_id: string | null;
  reason: string | null;
  details: unknown;
  request_id: string | null;
  occurred_at: string;
};

export function PlatformAdminPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [auditEvents, setAuditEvents] = useState<PlatformAuditEvent[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const [applicationResult, auditResult] = await Promise.all([
        request<{ data: Application[] }>("/api/platform/farm-applications", { signal }),
        request<{ data: PlatformAuditEvent[] }>("/api/platform/audit-events?page=1&pageSize=10", { signal }),
      ]);
      if (signal?.aborted) return;
      setApplications(applicationResult.data);
      setAuditEvents(auditResult.data);
    } catch (loadError) {
      if (signal?.aborted) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load platform administration.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load, refreshKey]);

  async function decide(application: Application, decision: "approved" | "rejected") {
    const reason = reasons[application.application_id]?.trim() ?? "";
    if (decision === "rejected" && !reason) {
      setError("A reason is required to reject an application.");
      return;
    }
    setBusyId(application.application_id);
    setError("");
    setNotice("");
    try {
      await request(`/api/platform/farm-applications/${encodeURIComponent(application.application_id)}/decision`, {
        method: "PATCH",
        body: JSON.stringify({ decision, reason: reason || undefined }),
      });
      setNotice(`${application.farm_name} application ${decision}.`);
      await load();
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "Could not decide this application.");
    } finally {
      setBusyId("");
    }
  }

  async function exportAudit() {
    setExporting(true);
    setError("");
    try {
      const response = await fetch("/api/platform/audit-events?export=csv", {
        credentials: "same-origin",
        headers: { Accept: "text/csv" },
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message = body && typeof body === "object" && "error" in body
          && typeof body.error === "string"
          ? body.error
          : "Could not export platform audit events.";
        throw new Error(message);
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `flockledger-platform-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Could not export platform audit events.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="platform-admin-page">
      <section className="content-card platform-admin-heading">
        <div>
          <p className="eyebrow">PLATFORM CONTROLS</p>
          <h1>Farm onboarding</h1>
          <p>Approve controlled onboarding requests and review governance activity.</p>
        </div>
        <button className="button button-quiet" type="button" onClick={() => setRefreshKey((current) => current + 1)} disabled={loading}>
          Refresh
        </button>
      </section>

      {error && <div className="notice error-notice" role="alert">{error}</div>}
      {notice && <div className="notice success-notice" role="status">{notice}</div>}

      <section className="content-card platform-applications">
        <div className="table-toolbar">
          <div><h2 className="table-title">Farm applications</h2><p className="table-subtitle">Applicant email and names are visible only to platform administrators.</p></div>
          <span className="table-hint">{applications.length} shown</span>
        </div>
        {loading ? (
          <div className="empty-inline" role="status">Loading applications…</div>
        ) : applications.length ? (
          <div className="platform-application-list">
            {applications.map((application) => (
              <article className="platform-application" key={application.application_id}>
                <div className="platform-application-main">
                  <div>
                    <h3>{application.farm_name}</h3>
                    <p>{application.owner_name || "Farm owner"} · {application.owner_email}</p>
                    <small>{application.status.replaceAll("_", " ")} · Submitted {application.submitted_at ? dateTimeInNairobi(application.submitted_at) : "not yet submitted"}</small>
                    {application.decision_reason && <p className="platform-decision-reason">{application.decision_reason}</p>}
                  </div>
                  {application.status === "pending_approval" && (
                    <div className="platform-application-actions">
                      <label>
                        Decision reason
                        <textarea
                          value={reasons[application.application_id] ?? ""}
                          maxLength={2000}
                          onChange={(event) => setReasons((current) => ({
                            ...current,
                            [application.application_id]: event.target.value,
                          }))}
                        />
                      </label>
                      <div>
                        <button className="button button-primary" type="button" disabled={busyId === application.application_id} onClick={() => void decide(application, "approved")}>
                          {busyId === application.application_id ? "Saving…" : "Approve farm"}
                        </button>
                        <button className="button button-quiet" type="button" disabled={busyId === application.application_id} onClick={() => void decide(application, "rejected")}>
                          Reject
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-inline">{error ? "Applications could not be loaded." : "No pending farm applications."}</div>
        )}
      </section>

      <section className="content-card platform-audit-list">
        <div className="table-toolbar">
          <div><h2 className="table-title">Platform audit</h2><p className="table-subtitle">Governance actions are recorded independently from farm activity.</p></div>
          <button className="button button-quiet" type="button" onClick={() => void exportAudit()} disabled={exporting}>
            {exporting ? "Preparing export…" : "Export CSV"}
          </button>
        </div>
        {auditEvents.length ? (
          <ul>
            {auditEvents.map((event) => (
              <li key={event.id}>
                <span><strong>{event.event_type.replaceAll("_", " ")}</strong><small>{dateTimeInNairobi(event.occurred_at)}</small></span>
                <span>{event.reason || event.farm_id || event.application_id || "Platform event"}</span>
              </li>
            ))}
          </ul>
        ) : !loading ? (
          <div className="empty-inline">No platform audit events recorded yet.</div>
        ) : null}
      </section>
    </div>
  );
}
