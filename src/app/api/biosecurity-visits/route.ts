import { z } from "zod";
import { createFarmRecordCollection } from "@/lib/api/farm-record-collection";

const createSchema = z.object({
  farmId: z.string().uuid(),
  visitDate: z.iso.date(),
  timeIn: z.iso.time(),
  visitorName: z.string().trim().min(1).max(128),
  organizationPurpose: z.string().trim().max(255).nullable().optional(),
  lastPoultryPremises: z.string().trim().max(255).nullable().optional(),
  footbathUsed: z.boolean().default(false),
  protectiveClothingUsed: z.boolean().default(false),
  signature: z.string().trim().max(128).nullable().optional(),
});

export const { GET, POST } = createFarmRecordCollection({
  table: "biosecurity_visits",
  fields: "id, farm_id, visit_date, time_in, visitor_name, organization_purpose, last_poultry_premises, footbath_used, protective_clothing_used, signature, created_at",
  orderBy: "visit_date",
  createSchema,
  toDatabaseRecord: (record) => ({
    farm_id: record.farmId,
    visit_date: record.visitDate,
    time_in: record.timeIn,
    visitor_name: record.visitorName,
    organization_purpose: record.organizationPurpose ?? null,
    last_poultry_premises: record.lastPoultryPremises ?? null,
    footbath_used: record.footbathUsed,
    protective_clothing_used: record.protectiveClothingUsed,
    signature: record.signature ?? null,
  }),
});
