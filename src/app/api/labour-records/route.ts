import { z } from "zod";
import { createFarmRecordCollection } from "@/lib/api/farm-record-collection";

const createSchema = z.object({
  farmId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  recordType: z.enum(["attendance", "payroll"]),
  recordDate: z.iso.date(),
  workerName: z.string().trim().min(1).max(128),
  hoursWorked: z.number().min(0).nullable().optional(),
  payPeriodStart: z.iso.date().nullable().optional(),
  payPeriodEnd: z.iso.date().nullable().optional(),
  amountKes: z.number().min(0).default(0),
  remarks: z.string().trim().max(2000).nullable().optional(),
}).refine((value) => value.recordType !== "attendance"
  || (value.hoursWorked != null && value.payPeriodStart == null && value.payPeriodEnd == null),
"Attendance records require hours and cannot include a payroll period.")
  .refine((value) => value.recordType !== "payroll"
    || (value.amountKes > 0 && value.payPeriodStart != null && value.payPeriodEnd != null),
  "Payroll records require a pay period and positive amount.")
  .refine((value) => value.payPeriodStart == null || value.payPeriodEnd == null
    || value.payPeriodEnd >= value.payPeriodStart,
  "Pay period end cannot be before its start date.");

export const { GET, POST } = createFarmRecordCollection({
  table: "labour_records",
  fields: "id, farm_id, batch_id, record_type, record_date, worker_name, hours_worked, pay_period_start, pay_period_end, amount_kes, remarks, created_at",
  orderBy: "record_date",
  supportsBatchFilter: true,
  createSchema,
  toDatabaseRecord: (record) => ({
    farm_id: record.farmId,
    batch_id: record.batchId ?? null,
    record_type: record.recordType,
    record_date: record.recordDate,
    worker_name: record.workerName,
    hours_worked: record.hoursWorked ?? null,
    pay_period_start: record.payPeriodStart ?? null,
    pay_period_end: record.payPeriodEnd ?? null,
    amount_kes: record.amountKes,
    remarks: record.remarks ?? null,
  }),
});
