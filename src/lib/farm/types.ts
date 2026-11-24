import type { PageMetadata } from "@/lib/api/pagination";

export type Batch = {
  batch_id: string;
  batch_code: string;
  batch_type: "Broiler" | "Kienyeji";
  house: string | null;
  date_placed: string;
  chicks_received: number;
  status: "running" | "closed";
  dead: number;
  culled: number;
  birds_sold: number;
  feed_consumed_kg: number;
  revenue_kes: number;
  outstanding_kes: number;
  fcr: number | null;
  mortality_percent: number;
  age_days: number;
};

export type DailyRecord = {
  id: string;
  batch_id: string;
  record_date: string;
  dead: number;
  culled: number;
  feed_given_kg: number;
  feed_left_kg: number;
  water_liters: number;
  temp_min_c: number | null;
  temp_max_c: number | null;
  litter: string | null;
  remarks: string | null;
  initials: string | null;
};

export type FarmBatch = {
  id: string;
  batch_code: string;
  batch_type: "Broiler" | "Kienyeji";
  house: string | null;
  status: "running" | "closed";
};

export type FarmSummary = {
  batches_recorded: number;
  birds_placed: number;
  revenue_kes: number;
  total_expenses_kes: number;
  feed_stock_on_hand_kg: number;
  accounts_receivable_kes: number;
  cash_balance_kes: number;
};

export type DashboardPayload = {
  data: Batch[];
  summary: FarmSummary | null;
  activeBatches: Batch[];
  activeBatchCount: number;
  batchCounts: { all: number; running: number; closed: number };
  pagination: PageMetadata;
};

