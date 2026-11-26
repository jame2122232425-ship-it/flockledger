import { describe, expect, it } from "vitest";
import { generateBatchCode, generateBatchCodeSuffix } from "../src/lib/batches/batch-code";
import { batchCreateSchema } from "../src/lib/validation/batches";

const batchInput = {
  farmId: "11111111-1111-4111-8111-111111111111",
  batchCode: "BAT-0D4E7C3D",
  batchType: "Broiler",
  datePlaced: "2026-11-12",
  chicksReceived: 100,
};

describe("generateBatchCode", () => {
  it("generates a twelve-character batch ID", () => {
    expect(generateBatchCode("2026-11-12", "0D4E7C3D"))
      .toBe("BAT-0D4E7C3D");
  });

  it("rejects invalid dates and suffixes", () => {
    expect(generateBatchCode("2026-02-30", "0D4E7C3D")).toBe("");
    expect(generateBatchCode("2026-11-12", "0D4E7C3")).toBe("");
  });

  it("creates an eight-character uppercase alphanumeric suffix", () => {
    expect(generateBatchCodeSuffix()).toMatch(/^[A-Z0-9]{8}$/);
  });

  it("accepts only the new twelve-character batch ID format", () => {
    expect(batchCreateSchema.safeParse(batchInput).success).toBe(true);
    expect(batchCreateSchema.safeParse({ ...batchInput, batchCode: "BAT-0D4E7C3" }).success).toBe(false);
    expect(batchCreateSchema.safeParse({ ...batchInput, batchCode: "RPF-BR-2611-01" }).success).toBe(false);
  });
});
