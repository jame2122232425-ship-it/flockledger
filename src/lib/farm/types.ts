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
  revenue_kes?: number;
  outstanding_kes?: number;
  fcr: number | null;
  mortality_percent: number;
  age_days: number;
};

export type BatchDetail = Batch & {
  id: string;
  farm_id: string;
  rearing_system: string | null;
  source: string | null;
  strain: string | null;
  chicks_ordered: number;
  date_sold_out: string | null;
  remarks: string | null;
  live_weight_sold_kg: number;
  avg_live_weight_sold_kg: number | null;
  total_cost_kes?: number;
  cost_per_bird_sold_kes?: number | null;
  cost_per_kg_sold_kes?: number | null;
  profit_kes?: number;
  profit_per_bird_sold_kes?: number | null;
  livability_percent: number;
  epef: number | null;
  cash_in_kes?: number;
  cash_out_kes?: number;
  paid_kes?: number;
  created_at: string;
  updated_at: string;
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
  revenue_kes?: number;
  total_expenses_kes?: number;
  feed_stock_on_hand_kg: number;
  accounts_receivable_kes?: number;
  cash_balance_kes?: number;
};

export type DashboardPayload = {
  data: Batch[];
  summary: FarmSummary | null;
  activeBatches: Batch[];
  activeBatchCount: number;
  batchCounts: { all: number; running: number; closed: number };
  pagination: PageMetadata;
};

