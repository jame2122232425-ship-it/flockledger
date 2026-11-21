import { z } from "zod";

export const batchCreateSchema = z
  .object({
    farmId: z.string().uuid(),
    batchCode: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, "Use capital letters, numbers, and hyphens."),
    batchType: z.enum(["Broiler", "Kienyeji"]),
    rearingSystem: z.string().trim().max(64).nullable().optional(),
    house: z.string().trim().max(64).nullable().optional(),
    datePlaced: z.iso.date(),
    source: z.string().trim().max(128).nullable().optional(),
    strain: z.string().trim().max(128).nullable().optional(),
    chicksOrdered: z.number().int().min(0).default(0),
    chicksReceived: z.number().int().positive(),
    remarks: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((value) => {
    const batchTypeCode = value.batchType === "Broiler" ? "BR" : "KJ";
    return value.batchCode.split("-").includes(batchTypeCode);
  }, "Batch ID must include BR for broilers or KJ for kienyeji.");

export const batchListQuerySchema = z.object({
  farmId: z.string().uuid(),
  status: z.enum(["running", "closed"]).optional(),
});
