"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Icon } from "@/components/app-icon";
import { Metric } from "@/components/metric-card";
import { PaginationControls } from "@/components/pagination-controls";
import { request } from "@/lib/client/request";
import { formatKes, formatNumber, shortDate, todayInNairobi } from "@/lib/format";
import type { PageMetadata } from "@/lib/api/pagination";
import type { FarmBatch } from "@/lib/farm/types";
import type { RevenueCursor, RevenueSale, RevenueSaleStatus } from "@/lib/revenue/sales";
import { saleCreateSchema, salePaymentCreateSchema } from "@/lib/validation/sales";

type RevenueSummary = {
  sales_kes: number;
  received_kes: number;
  outstanding_kes: number;
  sale_count: number;
};

type RevenueFilters = {
  from: string;
  to: string;
  batchId: string;
  paymentStatus: RevenueSaleStatus | "";
  search: string;
};

type SalePayment = {
  id: string;
  payment_date: string;
  amount_kes: number | string;
  reference: string | null;
  created_at: string;
};

export function RevenuePage({
  farmId,
  batches,
  loadingBatches,
  canRecord,
  onFeedback,
}: {
  farmId: string;
  batches: FarmBatch[];
  loadingBatches: boolean;
  canRecord: boolean;
  onFeedback: (message: string) => void;
}) {
  const [filters, setFilters] = useState<RevenueFilters>({
    from: "",
    to: "",
    batchId: "",
    paymentStatus: "",
    search: "",
  });
  const [dateRangeInitialized, setDateRangeInitialized] = useState(false);
  const [rows, setRows] = useState<RevenueSale[]>([]);
  const [summary, setSummary] = useState<RevenueSummary>({
    sales_kes: 0,
    received_kes: 0,
    outstanding_kes: 0,
    sale_count: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [page, setPage] = useState(1);
  const [cursorStack, setCursorStack] = useState<Array<RevenueCursor | null>>([null]);
  const [pagination, setPagination] = useState<PageMetadata>({
    page: 1,
    pageSize: 25,
    total: 0,
    pageCount: 0,
    hasMore: false,
    nextCursor: null,
  });
  const cursor = cursorStack[page - 1] ?? null;
  const [saleDialogOpen, setSaleDialogOpen] = useState(false);
  const [saleDate, setSaleDate] = useState("");
  const [saleError, setSaleError] = useState("");
  const [saleBusy, setSaleBusy] = useState(false);
  const [paymentSale, setPaymentSale] = useState<RevenueSale | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<SalePayment[]>([]);
  const [paymentPage, setPaymentPage] = useState(1);
  const [paymentPagination, setPaymentPagination] = useState<PageMetadata>({
    page: 1,
    pageSize: 25,
    total: 0,
    pageCount: 0,
    hasMore: false,
  });
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!saleError) return;
    const timer = window.setTimeout(() => setSaleError(""), 5000);
    return () => window.clearTimeout(timer);
  }, [saleError]);

  useEffect(() => {
    if (!paymentError) return;
    const timer = window.setTimeout(() => setPaymentError(""), 5000);
    return () => window.clearTimeout(timer);
  }, [paymentError]);

  const runningBatches = batches.filter((batch) => batch.status === "running");
  const batchNames = useMemo(
    () => new Map(batches.map((batch) => [batch.id, batch.batch_code])),
    [batches],
  );
  const dateRangeError = Boolean(filters.from && filters.to && filters.from > filters.to)
    ? "The end date must be on or after the start date."
    : "";
  const displayError = dateRangeError || error;
  const visibleSummary = dateRangeError
    ? { sales_kes: 0, received_kes: 0, outstanding_kes: 0, sale_count: 0 }
    : summary;

  useEffect(() => {
    if (dateRangeInitialized) return;
    const timer = window.setTimeout(() => {
      const today = todayInNairobi();
      setFilters((current) => ({ ...current, from: `${today.slice(0, 7)}-01`, to: today }));
      setDateRangeInitialized(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [dateRangeInitialized]);

  useEffect(() => {
    if (!dateRangeInitialized || dateRangeError) return;

    let active = true;
    const currentRequestId = ++requestId.current;
    const controller = new AbortController();

    const timer = window.setTimeout(() => {
      if (!active) return;
      setLoading(true);
      setError("");
      const params = new URLSearchParams({ farmId });
      params.set("page", String(page));
      params.set("pageSize", "25");
      if (cursor) params.set("cursor", JSON.stringify(cursor));
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (filters.batchId) params.set("batchId", filters.batchId);
      if (filters.paymentStatus) params.set("paymentStatus", filters.paymentStatus);
      if (filters.search.trim()) params.set("search", filters.search.trim());

      request<{ data: RevenueSale[]; summary: RevenueSummary; pagination: PageMetadata }>(
        `/api/sales?${params.toString()}`,
        { signal: controller.signal },
      ).then((result) => {
        if (!active || currentRequestId !== requestId.current) return;
        setRows(result.data);
        setSummary(result.summary);
        setPagination(result.pagination);
      }).catch((loadError: unknown) => {
        if (!active || currentRequestId !== requestId.current) return;
        setRows([]);
        setSummary({ sales_kes: 0, received_kes: 0, outstanding_kes: 0, sale_count: 0 });
        setPagination({ page: 1, pageSize: 25, total: 0, pageCount: 0, hasMore: false, nextCursor: null });
        setError(loadError instanceof Error ? loadError.message : "Could not load revenue.");
      }).finally(() => {
        if (active && currentRequestId === requestId.current) setLoading(false);
      });
    }, filters.search ? 250 : 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cursor, dateRangeError, dateRangeInitialized, farmId, filters, page, refreshKey]);

  useEffect(() => {
    if (!paymentSale) return;
    let active = true;
    const params = new URLSearchParams({ farmId });
    params.set("page", String(paymentPage));
    params.set("pageSize", "25");
    const timer = window.setTimeout(() => {
      if (!active) return;
      request<{ data: SalePayment[]; pagination: PageMetadata }>(
        `/api/sales/${encodeURIComponent(paymentSale.id)}/payments?${params.toString()}`,
      ).then((result) => {
        if (active) {
          setPaymentHistory(result.data);
          setPaymentPagination(result.pagination);
        }
      }).catch((loadError: unknown) => {
        if (active) setPaymentError(loadError instanceof Error ? loadError.message : "Could not load payment history.");
      }).finally(() => {
        if (active) setPaymentLoading(false);
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [farmId, paymentPage, paymentSale]);

  function updateFilter<K extends keyof RevenueFilters>(key: K, value: RevenueFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    setCursorStack([null]);
  }

  function resetFilters() {
    const today = todayInNairobi();
    setFilters({
      from: `${today.slice(0, 7)}-01`,
      to: today,
      batchId: "",
      paymentStatus: "",
      search: "",
    });
    setPage(1);
    setCursorStack([null]);
  }

  function goToNextPage() {
    if (!pagination.nextCursor) return;
    setCursorStack((current) => [...current.slice(0, page), pagination.nextCursor ?? null]);
    setPage((current) => current + 1);
  }

  function openSaleDialog() {
    setSaleDate(todayInNairobi());
    setSaleError("");
    setSaleDialogOpen(true);
  }

  function openPaymentDialog(sale: RevenueSale) {
    setPaymentDate(todayInNairobi());
    setPaymentHistory([]);
    setPaymentPage(1);
    setPaymentLoading(true);
    setPaymentError("");
    setPaymentSale(sale);
  }

  function changePaymentPage(nextPage: number) {
    setPaymentPage(nextPage);
    setPaymentLoading(true);
  }

  async function handleSaleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nullableText = (key: string) => String(form.get(key) ?? "").trim() || null;
    const parsed = saleCreateSchema.safeParse({
      farmId,
      batchId: String(form.get("batchId") ?? ""),
      saleDate,
      customer: String(form.get("customer") ?? ""),
      birdsSold: Number(form.get("birdsSold") || 0),
      totalWeightKg: Number(form.get("totalWeightKg") || 0),
      priceBasis: String(form.get("priceBasis") ?? ""),
      priceKes: Number(form.get("priceKes") || 0),
      paidKes: Number(form.get("paidKes") || 0),
      receiptNumber: nullableText("receiptNumber"),
      remarks: nullableText("remarks"),
    });
    if (!parsed.success) {
      setSaleError(parsed.error.issues.map((issue) => issue.message).join(" "));
      return;
    }

    setSaleBusy(true);
    setSaleError("");
    try {
      await request<{ data: RevenueSale }>("/api/sales", {
        method: "POST",
        body: JSON.stringify(parsed.data),
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setSaleDialogOpen(false);
      onFeedback(parsed.data.paidKes > 0
        ? "Sale and initial payment recorded. The payment was added to the cashbook."
        : "Sale recorded successfully.");
      setRefreshKey((current) => current + 1);
    } catch (createError) {
      setSaleError(createError instanceof Error ? createError.message : "Could not record sale.");
    } finally {
      setSaleBusy(false);
    }
  }

  async function handlePaymentCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentSale) return;
    const form = new FormData(event.currentTarget);
    const parsed = salePaymentCreateSchema.safeParse({
      farmId,
      paymentDate,
      amountKes: Number(form.get("amountKes") || 0),
      reference: String(form.get("reference") ?? "").trim() || null,
    });
    if (!parsed.success) {
      setPaymentError(parsed.error.issues.map((issue) => issue.message).join(" "));
      return;
    }

    setPaymentBusy(true);
    setPaymentError("");
    try {
      await request<{ data: SalePayment }>(
        `/api/sales/${encodeURIComponent(paymentSale.id)}/payments`,
        {
          method: "POST",
          body: JSON.stringify(parsed.data),
          headers: { "Idempotency-Key": crypto.randomUUID() },
        },
      );
      setPaymentSale(null);
      onFeedback(`Payment of ${formatKes(parsed.data.amountKes)} recorded and added to the cashbook.`);
      setRefreshKey((current) => current + 1);
    } catch (createError) {
      setPaymentError(createError instanceof Error ? createError.message : "Could not record payment.");
    } finally {
      setPaymentBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading revenue-page-heading">
        <div>
          <p className="eyebrow">SALES &amp; RECEIPTS</p>
          <h1>Revenue</h1>
          <p className="page-subtitle">Track sales, customer payments, and outstanding balances.</p>
        </div>
        <button
          className="button button-primary"
          type="button"
          onClick={openSaleDialog}
          disabled={!canRecord || loadingBatches || !runningBatches.length}
          title={!runningBatches.length ? "Create a running batch before recording sales." : undefined}
        >
          Record sale
        </button>
      </div>

      {!canRecord && (
        <div className="revenue-permission-note">
          You can view revenue and payment history. Owners, managers, and accountants can record sales and payments.
        </div>
      )}

      <section className="metric-grid revenue-summary-grid" aria-label="Revenue summary">
        <Metric icon="sales" label="Sales" value={formatKes(visibleSummary.sales_kes)} note={`${formatNumber(visibleSummary.sale_count)} ${visibleSummary.sale_count === 1 ? "ledger entry" : "ledger entries"} in this view`} tone="gold" />
        <Metric icon="cash" label="Received" value={formatKes(visibleSummary.received_kes)} note="Payments recorded for these sales" tone="green" />
        <Metric icon="cash" label="Outstanding" value={formatKes(visibleSummary.outstanding_kes)} note="Remaining customer balances" tone="blue" />
      </section>

      <section className="content-card revenue-filter-card" aria-label="Revenue filters">
        <div className="revenue-filter-grid">
          <label>From<input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => updateFilter("from", event.target.value)} /></label>
          <label>To<input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => updateFilter("to", event.target.value)} /></label>
          <label>Batch<select value={filters.batchId} onChange={(event) => updateFilter("batchId", event.target.value)}><option value="">All batches</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.batch_code}</option>)}</select></label>
          <label>Payment status<select value={filters.paymentStatus} onChange={(event) => updateFilter("paymentStatus", event.target.value as RevenueFilters["paymentStatus"])}><option value="">All statuses</option><option value="paid">Paid</option><option value="partial">Partially paid</option><option value="unpaid">Unpaid</option></select></label>
          <label className="revenue-search-field">Buyer<input type="search" maxLength={128} value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Search buyers" /></label>
          <button className="revenue-reset-button" type="button" onClick={resetFilters}>Reset filters</button>
        </div>
      </section>

      <section className="content-card table-card revenue-ledger-card">
        <div className="table-toolbar">
          <div><h2 className="table-title">Sales ledger</h2><p className="table-subtitle">Sales and closed-batch adjustments matching your filters</p></div>
          <span className="table-hint">{formatNumber(pagination.total)} {pagination.total === 1 ? "entry" : "entries"}</span>
        </div>
        {displayError && <div className="notice error-notice revenue-error" role="alert">{displayError}</div>}
        {dateRangeError ? (
          <div className="empty-inline" role="status">Update the date range to view revenue.</div>
        ) : loading ? (
          <div className="empty-inline" role="status">Loading revenue…</div>
        ) : rows.length ? (
          <>
            <div className="table-scroll revenue-desktop-ledger">
              <table>
                <thead><tr><th>Date</th><th>Buyer / entry</th><th>Batch</th><th>Quantity</th><th>Sales</th><th>Received</th><th>Outstanding</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {rows.map((sale) => (
                    <tr key={sale.id} className={sale.is_adjustment ? "revenue-adjustment-row" : ""}>
                      <td>{shortDate(sale.sale_date)}</td>
                      <td><span className="revenue-buyer-cell"><strong>{sale.customer}</strong><small>{sale.is_adjustment ? sale.remarks : sale.receipt_number || "Sale"}</small></span></td>
                      <td>{batchNames.get(sale.batch_id) ?? "—"}</td>
                      <td>{formatNumber(sale.birds_sold)} birds<small className="revenue-cell-secondary">{formatNumber(sale.total_weight_kg, 2)} kg</small></td>
                      <td>{formatKes(sale.amount_kes)}</td>
                      <td>{formatKes(sale.paid_kes)}</td>
                      <td className={sale.outstanding_kes > 0 ? "revenue-due-value" : ""}>{formatKes(sale.outstanding_kes)}</td>
                      <td><span className={`revenue-status-pill ${sale.payment_status}`}>{sale.payment_status === "partial" ? "Partial" : sale.payment_status}</span>{sale.is_adjustment && <span className="revenue-adjustment-tag">Adjustment</span>}</td>
                      <td><div className="revenue-row-actions">{!sale.is_adjustment && <button type="button" className="revenue-action-link" onClick={() => openPaymentDialog(sale)}>Payments</button>}{canRecord && !sale.is_adjustment && sale.outstanding_kes > 0 && <button type="button" className="revenue-action-link primary" onClick={() => openPaymentDialog(sale)}>Add payment</button>}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="revenue-mobile-ledger">
              {rows.map((sale) => (
                <article className={`revenue-mobile-card ${sale.is_adjustment ? "adjustment" : ""}`} key={sale.id}>
                  <div className="revenue-mobile-card-top">
                    <div><strong>{sale.customer}</strong><small>{shortDate(sale.sale_date)} · {batchNames.get(sale.batch_id) ?? "Batch"}</small></div>
                    <span className={`revenue-status-pill ${sale.payment_status}`}>{sale.payment_status === "partial" ? "Partial" : sale.payment_status}</span>
                  </div>
                  {sale.is_adjustment && <p className="revenue-adjustment-reason">{sale.remarks}</p>}
                  <div className="revenue-mobile-values">
                    <span><small>Sales</small><strong>{formatKes(sale.amount_kes)}</strong></span>
                    <span><small>Received</small><strong>{formatKes(sale.paid_kes)}</strong></span>
                    <span><small>Outstanding</small><strong className={sale.outstanding_kes > 0 ? "revenue-due-value" : ""}>{formatKes(sale.outstanding_kes)}</strong></span>
                  </div>
                  <div className="revenue-mobile-card-bottom">
                    <span>{formatNumber(sale.birds_sold)} birds · {formatNumber(sale.total_weight_kg, 2)} kg</span>
                    {!sale.is_adjustment && <div className="revenue-row-actions"><button type="button" className="revenue-action-link" onClick={() => openPaymentDialog(sale)}>Payments</button>{canRecord && sale.outstanding_kes > 0 && <button type="button" className="revenue-action-link primary" onClick={() => openPaymentDialog(sale)}>Add payment</button>}</div>}
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="revenue-empty-state">
            <span className="revenue-empty-icon"><Icon name="sales" /></span>
            <strong>{displayError ? "Revenue could not be loaded" : "No sales in this view"}</strong>
            <p>{displayError ? "Check your connection and try again." : "Try changing the filters or record a sale for a running batch."}</p>
            {displayError && <button className="revenue-action-link primary" type="button" onClick={() => setRefreshKey((current) => current + 1)}>Try again</button>}
            {!displayError && canRecord && runningBatches.length > 0 && <button className="button button-primary" type="button" onClick={openSaleDialog}>Record sale</button>}
          </div>
        )}
        {!dateRangeError && !loading && rows.length > 0 && (
          <PaginationControls pagination={pagination} onPageChange={setPage} onNextPage={goToNextPage} />
        )}
      </section>

      {saleDialogOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSaleDialogOpen(false); }}>
          <section className="dialog-card revenue-dialog-card" role="dialog" aria-modal="true" aria-labelledby="sale-dialog-title">
            <div className="dialog-heading">
              <div><p className="eyebrow">REVENUE</p><h2 id="sale-dialog-title">Record a sale</h2><p className="dialog-description">Record the sale and any amount received today.</p></div>
              <button className="dialog-close" type="button" aria-label="Close dialog" onClick={() => setSaleDialogOpen(false)}>×</button>
            </div>
            <form className="form-stack dialog-form" onSubmit={handleSaleCreate}>
              <div className="form-grid">
                <label className="field-span">Running batch<select name="batchId" required defaultValue={runningBatches[0]?.id ?? ""}><option value="" disabled>Select a batch</option>{runningBatches.map((batch) => <option key={batch.id} value={batch.id}>{batch.batch_code}{batch.house ? ` · ${batch.house}` : ""}</option>)}</select></label>
                <label>Sale date<input type="date" required value={saleDate} onChange={(event) => setSaleDate(event.target.value)} /></label>
                <label>Buyer<input name="customer" required maxLength={128} autoFocus placeholder="Buyer name" /></label>
                <label>Birds sold<input name="birdsSold" type="number" min="1" step="1" required /></label>
                <label><span className="revenue-field-label">Total live weight <small>kg</small></span><input name="totalWeightKg" type="number" min="0.001" step="0.001" required /></label>
                <label>Price basis<select name="priceBasis" defaultValue="Bird"><option value="Bird">Per bird</option><option value="Kg">Per kilogram</option></select></label>
                <label><span className="revenue-field-label">Price per unit <small>KES</small></span><input name="priceKes" type="number" min="0" step="0.01" required /></label>
                <label><span className="revenue-field-label">Received now <small>KES · optional</small></span><input name="paidKes" type="number" min="0" step="0.01" defaultValue="0" /></label>
                <label>Receipt reference<input name="receiptNumber" maxLength={64} placeholder="Optional" /></label>
                <label className="field-span">Notes<input name="remarks" maxLength={2000} placeholder="Optional sale details" /></label>
              </div>
              {saleError && <p className="inline-error" role="alert">{saleError}</p>}
              <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={() => setSaleDialogOpen(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={saleBusy}>{saleBusy ? "Saving…" : "Save sale"}</button></div>
            </form>
          </section>
        </div>
      )}

      {paymentSale && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaymentSale(null); }}>
          <section className="dialog-card revenue-dialog-card payment-dialog-card" role="dialog" aria-modal="true" aria-labelledby="payment-dialog-title">
            <div className="dialog-heading">
              <div><p className="eyebrow">PAYMENT HISTORY</p><h2 id="payment-dialog-title">{paymentSale.customer}</h2><p className="dialog-description">{shortDate(paymentSale.sale_date)} · {batchNames.get(paymentSale.batch_id) ?? "Batch"}</p></div>
              <button className="dialog-close" type="button" aria-label="Close dialog" onClick={() => setPaymentSale(null)}>×</button>
            </div>
            <div className="payment-balance-strip">
              <span><small>Sale</small><strong>{formatKes(paymentSale.amount_kes)}</strong></span>
              <span><small>Received</small><strong>{formatKes(paymentSale.paid_kes)}</strong></span>
              <span><small>Due</small><strong>{formatKes(paymentSale.outstanding_kes)}</strong></span>
            </div>
            <section className="payment-history-section" aria-label="Recorded payments">
              <h3>Recorded payments</h3>
              {paymentLoading ? <p className="empty-inline">Loading payment history…</p> : paymentHistory.length ? (
                <ul className="payment-history-list">
                  {paymentHistory.map((payment) => (
                    <li key={payment.id}><span><strong>{shortDate(payment.payment_date)}</strong><small>{payment.reference || "No reference"}</small></span><strong>{formatKes(Number(payment.amount_kes))}</strong></li>
                  ))}
                </ul>
              ) : <p className="empty-inline">No payment transactions recorded yet.</p>}
              {!paymentLoading && paymentHistory.length > 0 && (
                <PaginationControls pagination={paymentPagination} onPageChange={changePaymentPage} />
              )}
            </section>
            {paymentError && <p className="inline-error" role="alert">{paymentError}</p>}
            {canRecord && paymentSale.outstanding_kes > 0 && (
              <form className="form-stack payment-entry-form" onSubmit={handlePaymentCreate}>
                <h3>Record a payment</h3>
                <div className="form-grid">
                  <label>Payment date<input type="date" required value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
                  <label><span className="revenue-field-label">Amount received <small>KES</small></span><input name="amountKes" type="number" min="0.01" max={paymentSale.outstanding_kes} step="0.01" defaultValue={paymentSale.outstanding_kes} required /></label>
                  <label className="field-span">Reference<input name="reference" maxLength={64} placeholder="Optional receipt or transaction reference" /></label>
                </div>
                <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={() => setPaymentSale(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={paymentBusy}>{paymentBusy ? "Saving…" : "Record payment"}</button></div>
              </form>
            )}
          </section>
        </div>
      )}
    </>
  );
}
