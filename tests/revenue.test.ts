import { describe, expect, it, vi } from "vitest";
import {
  buildRevenueSales,
  filterRevenueSales,
  summarizeRevenueSales,
} from "../src/lib/revenue/sales";
import {
  createPaymentReceiptPdf,
  createSaleReceiptPdf,
  formatPaymentReference,
  printSaleReceiptPdf,
  type ReceiptPrintTarget,
} from "../src/lib/revenue/receipts";
import type { RevenueSale } from "../src/lib/revenue/sales";
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

describe("revenue receipt PDFs", () => {
  const sale: RevenueSale = {
    id: saleId,
    farm_id: farmId,
    batch_id: "33333333-3333-4333-8333-333333333333",
    sale_date: "2026-03-09",
    customer: "Test buyer",
    birds_sold: 5,
    total_weight_kg: 12.5,
    price_basis: "Kg",
    price_kes: 100,
    amount_kes: 1250,
    paid_kes: 250,
    outstanding_kes: 1000,
    payment_status: "partial",
    receipt_number: "SALE-001",
    remarks: null,
    created_at: "2026-03-09T08:00:00Z",
    is_adjustment: false,
  };

  it("generates a sale PDF with the sale reference, buyer, and current balance", async () => {
    const pdf = await createSaleReceiptPdf(sale, "Test Farm", "TEST-BATCH-01", "Broiler");
    const output = pdf.output();

    expect(output.startsWith("%PDF-")).toBe(true);
    expect(output).toContain("SALE-001");
    expect(output).toContain("Test buyer");
    expect(output).toContain("Outstanding balance");
    expect(output).toContain("1,000.00");
    expect(output).toContain("11:00:00 EAT");
    expect(output).toContain("FlockLedger");
    expect(output).toContain("Broiler chickens");
  });

  it("uses the sale ID when no receipt reference exists", async () => {
    const pdf = await createSaleReceiptPdf({ ...sale, receipt_number: null }, "Test Farm", "TEST-BATCH-01");
    expect(pdf.output()).toContain(sale.id.slice(0, 8).toUpperCase());
  });

  it("formats generated temporary references as ten uppercase hexadecimal characters", () => {
    expect(formatPaymentReference({
      id: "55555555-5555-4555-8555-555555555555",
      reference: "TMP-MPESA-0D4E7C3D1F",
    })).toBe("0D4E7C3D1F");
    expect(formatPaymentReference({
      id: "55555555-5555-4555-8555-555555555555",
      reference: "MPESA-4422",
    })).toBe("MPESA-4422");
  });

  it("generates a payment PDF with the payment reference and exact transaction amount", async () => {
    const pdf = await createPaymentReceiptPdf({
      id: "55555555-5555-4555-8555-555555555555",
      payment_date: "2026-03-10",
      amount_kes: "180.25",
      reference: "0D4E7C3D1F",
      created_at: "2026-03-10T10:15:30Z",
    }, {
      farmName: "Test Farm",
      batchCode: "TEST-BATCH-01",
      sale,
    });
    const output = pdf.output();

    expect(output.startsWith("%PDF-")).toBe(true);
    expect(output).toContain("Reference: 0D4E7C3D1F");
    expect(output).toContain("180.25");
    expect(output).toContain("13:15:30 EAT");
    expect(output).toContain("Test buyer");
  });

  it("opens a print-ready PDF in the supplied print window", async () => {
    const replace = vi.fn();
    const target: ReceiptPrintTarget = { location: { replace } };

    await printSaleReceiptPdf(sale, "Test Farm", "TEST-BATCH-01", "Broiler", target);

    expect(replace).toHaveBeenCalledOnce();
    expect(replace.mock.calls[0][0]).toMatch(/^blob:/);
  });
});
