import { z } from "zod";

export const dailyRecordCreateSchema = z
  .object({
    farmId: z.string().uuid(),
    batchId: z.string().uuid(),
    recordDate: z.iso.date(),
    dead: z.number().int().min(0).default(0),
    culled: z.number().int().min(0).default(0),
    feedGivenKg: z.number().min(0).default(0),
    feedLeftKg: z.number().min(0).default(0),
    waterLiters: z.number().min(0).default(0),
    tempMinC: z.number().min(-20).max(80).nullable().optional(),
    tempMaxC: z.number().min(-20).max(80).nullable().optional(),
    litter: z.string().trim().max(128).nullable().optional(),
    remarks: z.string().trim().max(2000).nullable().optional(),
    initials: z.string().trim().max(16).nullable().optional(),
  })
  .refine(
    (value) =>
      value.tempMinC == null ||
      value.tempMaxC == null ||
      value.tempMinC <= value.tempMaxC,
    "Minimum temperature cannot exceed maximum temperature.",
  )
  .refine(
    (value) => value.feedLeftKg <= value.feedGivenKg,
    "Feed left cannot exceed feed given.",
  );

export const dailyRecordListQuerySchema = z.object({
  farmId: z.string().uuid(),
  batchId: z.string().uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
