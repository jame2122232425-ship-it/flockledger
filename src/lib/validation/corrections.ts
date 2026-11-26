import { z } from "zod";

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
  const financialFields = [
    "birdsSoldDelta",
    "liveWeightSoldKgDelta",
    "revenueKesDelta",
    "paidKesDelta",
    "moneyInKesDelta",
    "moneyOutKesDelta",
  ] as const;
  if (value.sourceTable !== "daily_records") {
    context.addIssue({
      code: "custom",
      path: ["sourceTable"],
      message: "Financial corrections must use the approval workflow.",
    });
  }
  if (!value.sourceRecordId) {
    context.addIssue({
      code: "custom",
      path: ["sourceRecordId"],
      message: "Operational corrections must identify the original daily record.",
    });
  }
  if (financialFields.some((field) => value[field] !== 0)) {
    context.addIssue({
      code: "custom",
      message: "This endpoint only accepts operational corrections.",
    });
  }
  if (value.deadDelta === 0 && value.culledDelta === 0 && value.feedConsumedKgDelta === 0) {
    context.addIssue({
      code: "custom",
      message: "At least one operational adjustment is required.",
    });
  }
});
