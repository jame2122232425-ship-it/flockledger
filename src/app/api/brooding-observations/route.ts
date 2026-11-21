import { z } from "zod";
import { createFarmRecordCollection } from "@/lib/api/farm-record-collection";

const createSchema = z.object({
  farmId: z.string().uuid(),
  batchId: z.string().uuid(),
  observationDate: z.iso.date(),
  observationTime: z.iso.time(),
  brooderTempC: z.number().min(-20).max(80).nullable().optional(),
  houseTempC: z.number().min(-20).max(80).nullable().optional(),
  humidityPercent: z.number().min(0).max(100).nullable().optional(),
  chickBehavior: z.enum(["spread", "huddled", "panting", "other"]).nullable().optional(),
  behaviorDetails: z.string().trim().max(1000).nullable().optional(),
  actionTaken: z.string().trim().max(2000).nullable().optional(),
  initials: z.string().trim().max(16).nullable().optional(),
}).refine((value) => value.brooderTempC != null || value.houseTempC != null
  || value.humidityPercent != null || value.chickBehavior != null,
"Enter at least one observation.");

export const { GET, POST } = createFarmRecordCollection({
  table: "brooding_observations",
  fields: "id, farm_id, batch_id, observation_date, observation_time, brooder_temp_c, house_temp_c, humidity_percent, chick_behavior, behavior_details, action_taken, initials, created_at",
  orderBy: "observation_date",
  supportsBatchFilter: true,
  createSchema,
  toDatabaseRecord: (record) => ({
    farm_id: record.farmId,
    batch_id: record.batchId,
    observation_date: record.observationDate,
    observation_time: record.observationTime,
    brooder_temp_c: record.brooderTempC ?? null,
    house_temp_c: record.houseTempC ?? null,
    humidity_percent: record.humidityPercent ?? null,
    chick_behavior: record.chickBehavior ?? null,
    behavior_details: record.behaviorDetails ?? null,
    action_taken: record.actionTaken ?? null,
    initials: record.initials ?? null,
  }),
});
