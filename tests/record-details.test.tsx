/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchesPage, DailyPage } from "../src/components/farm-list-pages";
import type { Batch, BatchDetail, DashboardPayload, DailyRecord } from "../src/lib/farm/types";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("@/lib/client/request", () => ({
  request: requestMock,
}));

const farmId = "11111111-1111-4111-8111-111111111111";
const batchId = "22222222-2222-4222-8222-222222222222";
const recordId = "33333333-3333-4333-8333-333333333333";

const batch: Batch = {
  batch_id: batchId,
  batch_code: "FARM-BR-2601-01",
  batch_type: "Broiler",
  house: "House 1",
  date_placed: "2026-01-10",
  chicks_received: 500,
  status: "running",
  dead: 12,
  culled: 3,
  birds_sold: 100,
  feed_consumed_kg: 450,
  revenue_kes: 125000,
  outstanding_kes: 15000,
  fcr: 1.8,
  mortality_percent: 2.4,
  age_days: 25,
};

const batchDetail: BatchDetail = {
  ...batch,
  id: batchId,
  farm_id: farmId,
  rearing_system: "Deep litter",
  source: "Local hatchery",
  strain: "Cobb 500",
  chicks_ordered: 510,
  date_sold_out: null,
  remarks: "Morning placement",
  live_weight_sold_kg: 220,
  avg_live_weight_sold_kg: 2.2,
  total_cost_kes: 90000,
  cost_per_bird_sold_kes: 900,
  cost_per_kg_sold_kes: 409,
  profit_kes: 35000,
  profit_per_bird_sold_kes: 350,
  livability_percent: 97.6,
  epef: 320,
  cash_in_kes: 125000,
  cash_out_kes: 90000,
  paid_kes: 110000,
  created_at: "2026-01-10T08:00:00Z",
  updated_at: "2026-02-04T08:00:00Z",
};

const dailyRecord: DailyRecord = {
  id: recordId,
  batch_id: batchId,
  record_date: "2026-02-04",
  dead: 2,
  culled: 1,
  feed_given_kg: 40,
  feed_left_kg: 3,
  water_liters: 90,
  temp_min_c: 22,
  temp_max_c: 30,
  litter: "Dry",
  remarks: "Checked drinkers",
  initials: "SK",
};

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("batch and daily record details", () => {
  it("opens a batch detail view with its recorded metadata and performance", async () => {
    const dashboard: DashboardPayload = {
      data: [batch],
      summary: null,
      activeBatches: [batch],
      activeBatchCount: 1,
      batchCounts: { all: 1, running: 1, closed: 0 },
      pagination: { page: 1, pageSize: 25, total: 1, pageCount: 1, hasMore: false },
    };
    requestMock.mockResolvedValue({ data: batchDetail });
    render(
      <BatchesPage
        farmId={farmId}
        initialDashboard={dashboard}
        loading={false}
        canCreate={false}
        onAdd={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    expect(await screen.findByText("Local hatchery")).toBeTruthy();
    expect(screen.getByText("Cobb 500")).toBeTruthy();
    expect(screen.getByText(/35,000/)).toBeTruthy();
    expect(requestMock).toHaveBeenCalledWith(
      `/api/batches/${batchId}?farmId=${farmId}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("opens a daily record detail view with house observations and notes", async () => {
    requestMock.mockResolvedValue({
      data: [dailyRecord],
      pagination: { page: 1, pageSize: 25, total: 1, pageCount: 1, hasMore: false },
    });
    render(
      <DailyPage
        farmId={farmId}
        batchNames={new Map([[batchId, batch.batch_code]])}
        refreshVersion={0}
        onAdd={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Details" }));

    expect(screen.getByRole("heading", { name: "Daily record" })).toBeTruthy();
    expect(screen.getByText("Checked drinkers")).toBeTruthy();
    expect(screen.getByText("22 °C")).toBeTruthy();
    expect(screen.getByText("37 kg")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to list" }));
    expect(screen.getByRole("heading", { name: "Daily records" })).toBeTruthy();
  });
});
