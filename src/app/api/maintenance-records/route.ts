import { z } from "zod";
import { createFarmRecordCollection } from "@/lib/api/farm-record-collection";

const createSchema = z.object({
  farmId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  assetId: z.string().uuid().nullable().optional(),
  recordDate: z.iso.date(),
  house: z.string().trim().max(64).nullable().optional(),
  description: z.string().trim().min(1).max(255),
  workDone: z.string().trim().max(2000).nullable().optional(),
  serviceProvider: z.string().trim().max(128).nullable().optional(),
  status: z.enum(["reported", "in_progress", "completed"]).default("reported"),
  remarks: z.string().trim().max(2000).nullable().optional(),
});

export const { GET, POST } = createFarmRecordCollection({
  table: "maintenance_records",
  fields: "id, farm_id, batch_id, asset_id, record_date, house, description, work_done, service_provider, status, remarks, created_at",
  orderBy: "record_date",
  supportsBatchFilter: true,
  createSchema,
  toDatabaseRecord: (record) => ({
    farm_id: record.farmId,
    batch_id: record.batchId ?? null,
    asset_id: record.assetId ?? null,
    record_date: record.recordDate,
    house: record.house ?? null,
    description: record.description,
    work_done: record.workDone ?? null,
    service_provider: record.serviceProvider ?? null,
    status: record.status,
    remarks: record.remarks ?? null,
  }),
});
