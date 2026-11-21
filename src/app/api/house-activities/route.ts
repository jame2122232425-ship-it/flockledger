import { z } from "zod";
import { createFarmRecordCollection } from "@/lib/api/farm-record-collection";

const createSchema = z.object({
  farmId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  activityDate: z.iso.date(),
  house: z.string().trim().min(1).max(64),
  activityType: z.enum(["litter_check", "cleanout", "disinfection", "downtime"]),
  litterCondition: z.string().trim().max(128).nullable().optional(),
  ammoniaObservation: z.string().trim().max(255).nullable().optional(),
  disinfectant: z.string().trim().max(128).nullable().optional(),
  downtimeStart: z.iso.date().nullable().optional(),
  downtimeEnd: z.iso.date().nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
}).refine((value) => value.activityType !== "downtime" || value.downtimeStart != null,
  "Downtime records require a start date.")
  .refine((value) => value.downtimeEnd == null || value.downtimeStart == null
    || value.downtimeEnd >= value.downtimeStart,
  "Downtime end date cannot be before its start date.");

export const { GET, POST } = createFarmRecordCollection({
  table: "house_activity_records",
  fields: "id, farm_id, batch_id, activity_date, house, activity_type, litter_condition, ammonia_observation, disinfectant, downtime_start, downtime_end, remarks, created_at",
  orderBy: "activity_date",
  supportsBatchFilter: true,
  createSchema,
  toDatabaseRecord: (record) => ({
    farm_id: record.farmId,
    batch_id: record.batchId ?? null,
    activity_date: record.activityDate,
    house: record.house,
    activity_type: record.activityType,
    litter_condition: record.litterCondition ?? null,
    ammonia_observation: record.ammoniaObservation ?? null,
    disinfectant: record.disinfectant ?? null,
    downtime_start: record.downtimeStart ?? null,
    downtime_end: record.downtimeEnd ?? null,
    remarks: record.remarks ?? null,
  }),
});
