import { z } from "zod";

export const batchCreateSchema = z
  .object({
    farmId: z.string().uuid(),
    batchCode: z
      .string()
      .trim()
      .regex(/^BAT-[A-Z0-9]{8}$/, "Batch ID must be BAT- followed by eight capital letters or numbers."),
    batchType: z.enum(["Broiler", "Kienyeji"]),
    rearingSystem: z.string().trim().max(64).nullable().optional(),
    house: z.string().trim().max(64).nullable().optional(),
    datePlaced: z.iso.date(),
    source: z.string().trim().max(128).nullable().optional(),
    strain: z.string().trim().max(128).nullable().optional(),
    chicksOrdered: z.number().int().min(0).default(0),
    chicksReceived: z.number().int().positive(),
    remarks: z.string().trim().max(2000).nullable().optional(),
  });

export const batchListQuerySchema = z.object({
  farmId: z.string().uuid(),
  status: z.enum(["running", "closed"]).optional(),
});
