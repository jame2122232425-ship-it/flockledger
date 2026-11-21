import { z } from "zod";

const correctionFields = [
  "deadDelta",
  "culledDelta",
  "birdsSoldDelta",
  "liveWeightSoldKgDelta",
  "feedConsumedKgDelta",
  "revenueKesDelta",
  "paidKesDelta",
  "moneyInKesDelta",
  "moneyOutKesDelta",
] as const;

export const correctionCreateSchema = z.object({
  farmId: z.string().uuid(),
  batchId: z.string().uuid(),
  sourceTable: z.enum(["daily_records", "sales", "cash_entries"]),
  sourceRecordId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().min(1).max(2000),
  deadDelta: z.number().int().default(0),
  culledDelta: z.number().int().default(0),
  birdsSoldDelta: z.number().int().default(0),
  liveWeightSoldKgDelta: z.number().default(0),
  feedConsumedKgDelta: z.number().default(0),
  revenueKesDelta: z.number().default(0),
  paidKesDelta: z.number().default(0),
  moneyInKesDelta: z.number().default(0),
  moneyOutKesDelta: z.number().default(0),
}).superRefine((value, context) => {
  const changedFields = correctionFields.filter((field) => value[field] !== 0);
  if (changedFields.length === 0) {
    context.addIssue({ code: "custom", message: "At least one correction amount is required." });
  }

  const rejectFields = (fields: readonly (typeof correctionFields)[number][], message: string) => {
    if (fields.some((field) => value[field] !== 0)) {
      context.addIssue({ code: "custom", message });
    }
  };

  if (value.sourceTable === "daily_records") {
    if (!value.sourceRecordId) {
      context.addIssue({ code: "custom", path: ["sourceRecordId"], message: "Daily-record corrections must identify the original record." });
    }
    rejectFields(
      ["birdsSoldDelta", "liveWeightSoldKgDelta", "revenueKesDelta", "paidKesDelta", "moneyInKesDelta", "moneyOutKesDelta"],
      "Daily-record corrections may only adjust deaths, culls, or feed.",
    );
    return;
  }

  if (value.sourceTable === "sales") {
    rejectFields(
      ["deadDelta", "culledDelta", "feedConsumedKgDelta", "moneyInKesDelta", "moneyOutKesDelta"],
      "Sale corrections may only adjust sale quantities, weight, revenue, or payment.",
    );
    if (!value.sourceRecordId) {
      if (value.birdsSoldDelta <= 0 || value.liveWeightSoldKgDelta < 0
        || value.revenueKesDelta < 0 || value.paidKesDelta < 0
        || value.paidKesDelta > value.revenueKesDelta) {
        context.addIssue({ code: "custom", message: "New sale corrections require a positive bird count and valid non-negative sale amounts." });
      }
    }
    return;
  }

  rejectFields(
    ["deadDelta", "culledDelta", "birdsSoldDelta", "liveWeightSoldKgDelta", "feedConsumedKgDelta", "revenueKesDelta", "paidKesDelta"],
    "Cashbook corrections may only adjust money in or money out.",
  );
  if (!value.sourceRecordId
    && (value.moneyInKesDelta < 0 || value.moneyOutKesDelta < 0
      || (value.moneyInKesDelta > 0) === (value.moneyOutKesDelta > 0))) {
    context.addIssue({ code: "custom", message: "A new cashbook correction must add a positive amount in or amount out." });
  }
});
