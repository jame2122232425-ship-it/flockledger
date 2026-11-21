import { describe, expect, it } from "vitest";
import { correctionCreateSchema } from "../src/lib/validation/corrections";

const baseCorrection = {
  farmId: "11111111-1111-4111-8111-111111111111",
  batchId: "22222222-2222-4222-8222-222222222222",
  reason: "Correcting a closed-batch entry",
};

describe("correctionCreateSchema", () => {
  it("requires a source row for daily-record corrections", () => {
    const result = correctionCreateSchema.safeParse({
      ...baseCorrection,
      sourceTable: "daily_records",
      deadDelta: -1,
    });

    expect(result.success).toBe(false);
  });

  it("allows payment adjustments to an original sale", () => {
    const result = correctionCreateSchema.safeParse({
      ...baseCorrection,
      sourceTable: "sales",
      sourceRecordId: "33333333-3333-4333-8333-333333333333",
      paidKesDelta: 100,
    });

    expect(result.success).toBe(true);
  });

  it("rejects a new sale correction when payment exceeds its revenue", () => {
    const result = correctionCreateSchema.safeParse({
      ...baseCorrection,
      sourceTable: "sales",
      birdsSoldDelta: 1,
      liveWeightSoldKgDelta: 2,
      revenueKesDelta: 100,
      paidKesDelta: 101,
    });

    expect(result.success).toBe(false);
  });

  it("requires a new cashbook correction to add exactly one positive amount", () => {
    const valid = correctionCreateSchema.safeParse({
      ...baseCorrection,
      sourceTable: "cash_entries",
      moneyInKesDelta: 50,
    });
    const invalid = correctionCreateSchema.safeParse({
      ...baseCorrection,
      sourceTable: "cash_entries",
      moneyInKesDelta: 50,
      moneyOutKesDelta: 25,
    });

    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  it("allows a negative reversal against an identified cashbook row", () => {
    const result = correctionCreateSchema.safeParse({
      ...baseCorrection,
      sourceTable: "cash_entries",
      sourceRecordId: "44444444-4444-4444-8444-444444444444",
      moneyOutKesDelta: -50,
    });

    expect(result.success).toBe(true);
  });
});
