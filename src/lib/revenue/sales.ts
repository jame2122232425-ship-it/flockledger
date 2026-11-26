import { z } from "zod";

export type RevenueSaleStatus = "paid" | "partial" | "unpaid";

export const revenueCursorSchema = z.object({
  saleDate: z.iso.date(),
  createdAt: z.string().datetime({ offset: true }),
  id: z.string().min(1).max(64),
});

export type RevenueCursor = z.infer<typeof revenueCursorSchema>;

export const revenueLedgerPageSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    farm_id: z.string().uuid(),
    batch_id: z.string().uuid(),
    sale_date: z.iso.date(),
    customer: z.string(),
    birds_sold: z.number(),
    total_weight_kg: z.number(),
    price_basis: z.enum(["Bird", "Kg"]).nullable(),
    price_kes: z.number().nullable(),
    amount_kes: z.number(),
    paid_kes: z.number(),
    unreconciled_paid_kes: z.number(),
    outstanding_kes: z.number(),
    payment_status: z.enum(["paid", "partial", "unpaid"]),
    receipt_number: z.string().nullable(),
    remarks: z.string().nullable(),
    created_at: z.string().datetime({ offset: true }),
    is_adjustment: z.boolean(),
  })),
  summary: z.object({
    sales_kes: z.number(),
    received_kes: z.number(),
    outstanding_kes: z.number(),
    unreconciled_paid_kes: z.number(),
    sale_count: z.number().int().nonnegative(),
  }),
  hasMore: z.boolean(),
  nextCursor: revenueCursorSchema.nullable(),
});

type SaleRow = {
  id: string;
  farm_id: string;
  batch_id: string;
  sale_date: string;
  customer: string;
  birds_sold: number | string;
  total_weight_kg: number | string;
  price_basis: "Bird" | "Kg";
  price_kes: number | string;
  amount_kes: number | string;
  receipt_number: string | null;
  remarks: string | null;
  created_at: string;
};

type SalePaymentRow = {
  sale_id: string;
  amount_kes: number | string;
};

type SaleCorrectionRow = {
  id: string;
  batch_id: string;
  source_record_id: string | null;
  reason: string;
  birds_sold_delta: number | string;
  live_weight_sold_kg_delta: number | string;
  revenue_kes_delta: number | string;
  paid_kes_delta: number | string;
  created_at: string;
};

type SaleRefundRow = {
  sale_id: string;
  amount_kes: number | string;
};

export type RevenueSale = {
  id: string;
  farm_id: string;
  batch_id: string;
  sale_date: string;
  customer: string;
  birds_sold: number;
  total_weight_kg: number;
  price_basis: "Bird" | "Kg" | null;
  price_kes: number | null;
  amount_kes: number;
  paid_kes: number;
  unreconciled_paid_kes: number;
  outstanding_kes: number;
  payment_status: RevenueSaleStatus;
  receipt_number: string | null;
  remarks: string | null;
  created_at: string;
  is_adjustment: boolean;
};

function cents(value: number | string | null | undefined) {
  return Math.round(Number(value ?? 0) * 100);
}

function statusFor(amountCents: number, paidCents: number): RevenueSaleStatus {
  if (paidCents >= amountCents) return "paid";
  return paidCents > 0 ? "partial" : "unpaid";
}

function saleDateInNairobi(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function buildRevenueSales(
  sales: SaleRow[],
  payments: SalePaymentRow[],
  corrections: SaleCorrectionRow[],
  farmId: string,
  refunds: SaleRefundRow[] = [],
): RevenueSale[] {
  const paidBySale = new Map<string, number>();
  for (const payment of payments) {
    paidBySale.set(payment.sale_id, (paidBySale.get(payment.sale_id) ?? 0) + cents(payment.amount_kes));
  }
  for (const refund of refunds) {
    paidBySale.set(refund.sale_id, (paidBySale.get(refund.sale_id) ?? 0) - cents(refund.amount_kes));
  }

  const correctionsBySale = new Map<string, SaleCorrectionRow[]>();
  for (const correction of corrections) {
    if (!correction.source_record_id) continue;
    const existing = correctionsBySale.get(correction.source_record_id) ?? [];
    existing.push(correction);
    correctionsBySale.set(correction.source_record_id, existing);
  }

  const records = sales.map((sale): RevenueSale => {
    const saleCorrections = correctionsBySale.get(sale.id) ?? [];
    const amountCents = cents(sale.amount_kes)
      + saleCorrections.reduce((sum, correction) => sum + cents(correction.revenue_kes_delta), 0);
    const paidCents = paidBySale.get(sale.id) ?? 0;
    const unreconciledPaidCents = saleCorrections
      .reduce((sum, correction) => sum + cents(correction.paid_kes_delta), 0);

    return {
      id: sale.id,
      farm_id: sale.farm_id,
      batch_id: sale.batch_id,
      sale_date: sale.sale_date,
      customer: sale.customer,
      birds_sold: Number(sale.birds_sold)
        + saleCorrections.reduce((sum, correction) => sum + Number(correction.birds_sold_delta), 0),
      total_weight_kg: Number(sale.total_weight_kg)
        + saleCorrections.reduce((sum, correction) => sum + Number(correction.live_weight_sold_kg_delta), 0),
      price_basis: sale.price_basis,
      price_kes: Number(sale.price_kes),
      amount_kes: amountCents / 100,
      paid_kes: paidCents / 100,
      unreconciled_paid_kes: unreconciledPaidCents / 100,
      outstanding_kes: Math.max(amountCents - paidCents, 0) / 100,
      payment_status: statusFor(amountCents, paidCents),
      receipt_number: sale.receipt_number,
      remarks: sale.remarks,
      created_at: sale.created_at,
      is_adjustment: false,
    };
  });

  for (const correction of corrections) {
    if (correction.source_record_id) continue;
    const amountCents = cents(correction.revenue_kes_delta);
    const unreconciledPaidCents = cents(correction.paid_kes_delta);
    records.push({
      id: `correction:${correction.id}`,
      farm_id: farmId,
      batch_id: correction.batch_id,
      sale_date: saleDateInNairobi(correction.created_at),
      customer: "Closed-batch adjustment",
      birds_sold: Number(correction.birds_sold_delta),
      total_weight_kg: Number(correction.live_weight_sold_kg_delta),
      price_basis: null,
      price_kes: null,
      amount_kes: amountCents / 100,
      paid_kes: 0,
      unreconciled_paid_kes: unreconciledPaidCents / 100,
      outstanding_kes: Math.max(amountCents, 0) / 100,
      payment_status: statusFor(amountCents, 0),
      receipt_number: null,
      remarks: correction.reason,
      created_at: correction.created_at,
      is_adjustment: true,
    });
  }

  return records.sort((left, right) =>
    right.sale_date.localeCompare(left.sale_date)
    || right.created_at.localeCompare(left.created_at)
    || right.id.localeCompare(left.id),
  );
}

export function filterRevenueSales(
  sales: RevenueSale[],
  paymentStatus?: RevenueSaleStatus,
) {
  return paymentStatus
    ? sales.filter((sale) => sale.payment_status === paymentStatus)
    : sales;
}

export function summarizeRevenueSales(sales: RevenueSale[]) {
  const totalCents = sales.reduce((sum, sale) => sum + cents(sale.amount_kes), 0);
  const receivedCents = sales.reduce((sum, sale) => sum + cents(sale.paid_kes), 0);
  const unreconciledPaidCents = sales.reduce(
    (sum, sale) => sum + cents(sale.unreconciled_paid_kes),
    0,
  );
  return {
    sales_kes: totalCents / 100,
    received_kes: receivedCents / 100,
    outstanding_kes: Math.max(totalCents - receivedCents, 0) / 100,
    unreconciled_paid_kes: unreconciledPaidCents / 100,
    sale_count: sales.length,
  };
}
