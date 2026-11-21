import { z } from "zod";
import { createFarmRecordCollection } from "@/lib/api/farm-record-collection";

const createSchema = z.object({
  farmId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  usageDate: z.iso.date(),
  house: z.string().trim().max(64).nullable().optional(),
  utilityType: z.enum(["electricity", "water", "fuel", "gas", "charcoal", "other"]),
  quantity: z.number().min(0),
  unit: z.string().trim().min(1).max(32),
  meterReading: z.number().min(0).nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
});

export const { GET, POST } = createFarmRecordCollection({
  table: "utility_usage",
  fields: "id, farm_id, batch_id, usage_date, house, utility_type, quantity, unit, meter_reading, remarks, created_at",
  orderBy: "usage_date",
  supportsBatchFilter: true,
  createSchema,
  toDatabaseRecord: (record) => ({
    farm_id: record.farmId,
    batch_id: record.batchId ?? null,
    usage_date: record.usageDate,
    house: record.house ?? null,
    utility_type: record.utilityType,
    quantity: record.quantity,
    unit: record.unit,
    meter_reading: record.meterReading ?? null,
    remarks: record.remarks ?? null,
  }),
});
