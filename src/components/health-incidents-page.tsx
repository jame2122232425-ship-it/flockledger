"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { request } from "@/lib/client/request";
import { shortDate, todayInNairobi } from "@/lib/format";
import type { FarmBatch } from "@/lib/farm/types";

type HealthIncident = {
  id: string;
  batch_id: string | null;
  incident_date: string;
  summary: string;
  observed_signs: string;
  birds_affected: number;
  immediate_actions: string | null;
  created_at: string;
};

export function HealthIncidentsPage({
  farmId,
  batches,
  canReport,
}: {
  farmId: string;
  batches: FarmBatch[];
  canReport: boolean;
}) {
  const [incidents, setIncidents] = useState<HealthIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const loadIncidents = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams({ farmId, page: "1", pageSize: "100" });
    const result = await request<{ data: HealthIncident[] }>(
      `/api/health-incidents?${params.toString()}`,
      { signal },
    );
    if (!signal?.aborted) setIncidents(result.data);
  }, [farmId]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadIncidents(controller.signal)).catch((loadError: unknown) => {
      if (controller.signal.aborted) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load health incidents.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [loadIncidents]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canReport) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request("/api/health-incidents", {
        method: "POST",
        body: JSON.stringify({
          farmId,
          batchId: String(form.get("batchId") ?? "") || null,
          incidentDate: String(form.get("incidentDate") ?? ""),
          summary: String(form.get("summary") ?? ""),
          observedSigns: String(form.get("observedSigns") ?? ""),
          birdsAffected: Number(form.get("birdsAffected") ?? 0),
          immediateActions: String(form.get("immediateActions") ?? "").trim() || null,
        }),
      });
      formElement.reset();
      setNotice("Health incident reported.");
      await loadIncidents();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not report health incident.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">FLOCK HEALTH</p>
          <h1>Health incidents</h1>
          <p className="page-subtitle">Coordinate observations and response without editing clinical records.</p>
        </div>
      </div>
      {notice && <div className="notice success-notice" role="status">{notice}</div>}
      {error && <div className="notice error-notice" role="alert">{error}</div>}
      {canReport && (
        <section className="content-card health-incident-form-card">
          <div className="card-heading"><div><p className="eyebrow">INCIDENT REPORT</p><h2>Record an observation</h2></div></div>
          <form className="form-stack" onSubmit={handleSubmit}>
            <div className="form-grid">
              <label>Incident date<input name="incidentDate" type="date" defaultValue={todayInNairobi()} required /></label>
              <label>Related batch<select name="batchId" defaultValue=""><option value="">Farm-wide</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.batch_code}</option>)}</select></label>
              <label className="field-span">Summary<input name="summary" maxLength={255} required placeholder="Short, factual summary" /></label>
              <label className="field-span">Observed signs<textarea name="observedSigns" maxLength={4000} required rows={3} /></label>
              <label>Birds affected<input name="birdsAffected" type="number" min="0" step="1" defaultValue="0" required /></label>
              <label className="field-span">Immediate coordination or action<textarea name="immediateActions" maxLength={4000} rows={2} /></label>
            </div>
            <div><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Submitting…" : "Report incident"}</button></div>
          </form>
        </section>
      )}
      {!canReport && (
        <div className="notice">You can review incidents but cannot submit reports with your current farm permissions.</div>
      )}
      <section className="content-card health-incident-list">
        <div className="card-heading"><div><p className="eyebrow">FARM RECORD</p><h2>Recent incidents</h2></div></div>
        {loading ? <div className="empty-inline" role="status">Loading health incidents…</div>
          : incidents.length ? (
            <div className="health-incident-items">
              {incidents.map((incident) => (
                <article className="health-incident-item" key={incident.id}>
                  <div className="health-incident-meta">
                    <strong>{incident.summary}</strong>
                    <span>{shortDate(incident.incident_date)} · {batches.find((batch) => batch.id === incident.batch_id)?.batch_code ?? "Farm-wide"}</span>
                  </div>
                  <p>{incident.observed_signs}</p>
                  <small>{incident.birds_affected} birds affected</small>
                  {incident.immediate_actions && <p><strong>Action:</strong> {incident.immediate_actions}</p>}
                </article>
              ))}
            </div>
          ) : <div className="empty-inline">No health incidents have been reported.</div>}
      </section>
    </>
  );
}
