/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RevenuePage } from "../src/components/revenue-page";
import type { FarmBatch } from "../src/lib/farm/types";
import type { RevenueSale } from "../src/lib/revenue/sales";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("@/lib/client/request", () => ({
  request: requestMock,
}));

const farmId = "11111111-1111-4111-8111-111111111111";
const batchId = "22222222-2222-4222-8222-222222222222";
const saleId = "33333333-3333-4333-8333-333333333333";
const paymentId = "44444444-4444-4444-8444-444444444444";

const sale: RevenueSale = {
  id: saleId,
  farm_id: farmId,
  batch_id: batchId,
  sale_date: "2026-11-20",
  customer: "Example buyer",
  birds_sold: 100,
  total_weight_kg: 220,
  price_basis: "Kg",
  price_kes: 400,
  amount_kes: 88000,
  paid_kes: 40000,
  unreconciled_paid_kes: 0,
  outstanding_kes: 48000,
  payment_status: "partial",
  receipt_number: "SALE-1120",
  remarks: "Morning delivery",
  created_at: "2026-11-20T08:00:00Z",
  is_adjustment: false,
};

const payment = {
  id: paymentId,
  payment_date: "2026-11-22",
  amount_kes: 40000,
  reference: "MPESA-4422",
  created_at: "2026-11-22T10:15:00Z",
};

const batches: FarmBatch[] = [{
  id: batchId,
  batch_code: "FARM-BR-2611-01",
  batch_type: "Broiler",
  house: "House 1",
  status: "running",
}];

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/sales?")) {
      return {
        data: [sale],
        summary: { sales_kes: 88000, received_kes: 40000, outstanding_kes: 48000, unreconciled_paid_kes: 0, sale_count: 1 },
        pagination: {
          page: 1,
          pageSize: 25,
          total: 1,
          pageCount: 1,
          hasMore: false,
          nextCursor: null,
        },
      };
    }
    if (url === `/api/sales/${saleId}/payments`) {
      return {
        data: {
          ...payment,
          reference: "0D4E7C3D1F",
          created_at: "2026-11-26T10:15:30Z",
        },
      };
    }
    if (url.includes(`/api/sales/${saleId}/payments?`)) {
      return {
        data: [payment],
        pagination: { page: 1, pageSize: 25, total: 1, pageCount: 1, hasMore: false },
      };
    }
    throw new Error(`Unexpected API request: ${url}`);
  });
});

afterEach(() => {
  cleanup();
});

describe("revenue record details", () => {
  it("navigates from a sale to its payment history and payment details", async () => {
    render(
      <RevenuePage
        farmId={farmId}
        farmName="Example farm"
        batches={batches}
        loadingBatches={false}
        canCreateSales={true}
        canRecordPayments={true}
        canDownloadReceipts={true}
        onFeedback={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Details" }, { timeout: 5000 }));
    expect(screen.getByRole("heading", { name: "Sale information" })).toBeTruthy();
    expect(screen.getByText("Morning delivery")).toBeTruthy();
    expect(screen.getByText("Recorded at (EAT)").parentElement?.textContent).toContain("20 Nov 2026, 11:00:00 EAT");
    expect(screen.getByRole("button", { name: "Download receipt PDF" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Print receipt" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "View payment history" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(await screen.findByText("Recorded payments")).toBeTruthy();
    expect(screen.getByText(/Recorded 22 Nov 2026, 13:15:00 EAT/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Details" }));

    expect(await screen.findByRole("heading", { name: "Payment receipt" })).toBeTruthy();
    expect(screen.getByText("MPESA-4422")).toBeTruthy();
    expect(screen.getByText("Recorded at (EAT)").parentElement?.textContent).toContain("22 Nov 2026, 13:15:00 EAT");
    expect(screen.getByText("Amount received").parentElement?.textContent).toContain("40,000");
    expect(screen.getByText(/may include payments recorded after this transaction/)).toBeTruthy();
  });

  it("shows the automatically generated payment reference after recording", async () => {
    const onFeedback = vi.fn();
    render(
      <RevenuePage
        farmId={farmId}
        farmName="Example farm"
        batches={batches}
        loadingBatches={false}
        canCreateSales={true}
        canRecordPayments={true}
        canDownloadReceipts={true}
        onFeedback={onFeedback}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Details" }, { timeout: 5000 }));
    fireEvent.click(screen.getByRole("button", { name: "View payment history" }));
    fireEvent.click(await screen.findByRole("button", { name: "Record payment" }));

    await waitFor(() => expect(onFeedback).toHaveBeenCalledWith(expect.stringContaining("Reference: 0D4E7C3D1F")));
    const paymentRequest = requestMock.mock.calls.find(([url]) => url === `/api/sales/${saleId}/payments`);
    expect(JSON.parse(paymentRequest?.[1].body as string).reference).toBeNull();
  });
});
