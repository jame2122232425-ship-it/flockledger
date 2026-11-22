import { describe, expect, it } from "vitest";
import {
  buildRevenueSales,
  filterRevenueSales,
  summarizeRevenueSales,
} from "../src/lib/revenue/sales";
import {
  saleCreateSchema,
  salePaymentCreateSchema,
  salesListQuerySchema,
} from "../src/lib/validation/sales";

const farmId = "11111111-1111-4111-8111-111111111111";
const saleId = "22222222-2222-4222-8222-222222222222";

describe("revenue validation", () => {
  it("rejects initial payments greater than the sale amount", () => {
    const result = saleCreateSchema.safeParse({
      farmId,
      batchId: saleId,
      saleDate: "2026-03-10",
      customer: "Buyer",
      birdsSold: 5,
      totalWeightKg: 12.5,
      priceBasis: "Kg",
      priceKes: 100,
      paidKes: 1251,
    });

    expect(result.success).toBe(false);
  });

  it("uses the database-rounded sale amount when checking an initial payment", () => {
    const result = saleCreateSchema.safeParse({
      farmId,
      batchId: saleId,
      saleDate: "2026-03-10",
      customer: "Buyer",
      birdsSold: 1,
      totalWeightKg: 0.67,
      priceBasis: "Kg",
      priceKes: 1.5,
      paidKes: 1.01,
    });

    expect(result.success).toBe(true);
  });

  it("rejects sale amounts that exceed the database money column", () => {
    const result = saleCreateSchema.safeParse({
      farmId,
      batchId: saleId,
      saleDate: "2026-03-10",
      customer: "Buyer",
      birdsSold: 1000000000,
      totalWeightKg: 1,
      priceBasis: "Bird",
      priceKes: 100,
      paidKes: 0,
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid date ranges and zero-value payment transactions", () => {
    expect(salesListQuerySchema.safeParse({
      farmId,
      from: "2026-03-11",
      to: "2026-03-10",
    }).success).toBe(false);
    expect(salePaymentCreateSchema.safeParse({
      farmId,
      paymentDate: "2026-03-10",
      amountKes: 0,
    }).success).toBe(false);
    expect(salePaymentCreateSchema.safeParse({
      farmId,
      paymentDate: "2026-03-10",
      amountKes: 0.001,
    }).success).toBe(false);
  });
});

describe("revenue totals", () => {
  it("combines transactions and corrections while keeping added sales as dated adjustments", () => {
    const rows = buildRevenueSales(
      [{
        id: saleId,
        farm_id: farmId,
        batch_id: "33333333-3333-4333-8333-333333333333",
        sale_date: "2026-03-09",
        customer: "Buyer",
        birds_sold: 5,
        total_weight_kg: 12.5,
        price_basis: "Kg",
        price_kes: 100,
        amount_kes: 1250,
        receipt_number: null,
        remarks: null,
        created_at: "2026-03-09T08:00:00Z",
      }],
      [{ sale_id: saleId, amount_kes: 250 }],
      [
        {
          id: "44444444-4444-4444-8444-444444444444",
          batch_id: "33333333-3333-4333-8333-333333333333",
          source_record_id: saleId,
          reason: "Corrected sale values",
          birds_sold_delta: 0,
          live_weight_sold_kg_delta: 0,
          revenue_kes_delta: 100,
          paid_kes_delta: 50,
          created_at: "2026-03-10T08:00:00Z",
        },
        {
          id: "55555555-5555-4555-8555-555555555555",
          batch_id: "33333333-3333-4333-8333-333333333333",
          source_record_id: null,
          reason: "Added sale found after closing",
          birds_sold_delta: 2,
          live_weight_sold_kg_delta: 5,
          revenue_kes_delta: 300,
          paid_kes_delta: 100,
          created_at: "2026-03-10T23:30:00Z",
        },
      ],
      farmId,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      is_adjustment: true,
      sale_date: "2026-03-11",
      amount_kes: 300,
      paid_kes: 100,
      payment_status: "partial",
    });
    expect(rows[1]).toMatchObject({
      is_adjustment: false,
      amount_kes: 1350,
      paid_kes: 300,
      outstanding_kes: 1050,
      payment_status: "partial",
    });
    expect(filterRevenueSales(rows, "unpaid")).toEqual([]);
    expect(summarizeRevenueSales(rows)).toEqual({
      sales_kes: 1650,
      received_kes: 400,
      outstanding_kes: 1250,
      sale_count: 2,
    });
  });
});
