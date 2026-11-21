import { z } from "zod";
import { createFarmRecordCollection } from "@/lib/api/farm-record-collection";

const createSchema = z.object({
  farmId: z.string().uuid(),
  documentType: z.string().trim().min(1).max(128),
  documentNumber: z.string().trim().max(128).nullable().optional(),
  issuingAuthority: z.string().trim().max(128).nullable().optional(),
  issuedDate: z.iso.date().nullable().optional(),
  expiryDate: z.iso.date().nullable().optional(),
  storagePath: z.string().trim().max(512).nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
}).refine((value) => value.issuedDate == null || value.expiryDate == null
  || value.expiryDate >= value.issuedDate,
"Expiry date cannot be before issue date.");

export const { GET, POST } = createFarmRecordCollection({
  table: "compliance_records",
  fields: "id, farm_id, document_type, document_number, issuing_authority, issued_date, expiry_date, storage_path, remarks, created_at",
  orderBy: "expiry_date",
  createSchema,
  toDatabaseRecord: (record) => ({
    farm_id: record.farmId,
    document_type: record.documentType,
    document_number: record.documentNumber ?? null,
    issuing_authority: record.issuingAuthority ?? null,
    issued_date: record.issuedDate ?? null,
    expiry_date: record.expiryDate ?? null,
    storage_path: record.storagePath ?? null,
    remarks: record.remarks ?? null,
  }),
});
