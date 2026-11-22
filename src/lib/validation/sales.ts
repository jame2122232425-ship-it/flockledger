import { z } from "zod";

const money = z.number().min(0).max(9999999999.99)
  .refine((value) => Number(value.toFixed(2)) === value, "Use at most two decimal places.");

export const saleCreateSchema = z.object({
  farmId: z.string().uuid(),
  batchId: z.string().uuid(),
  saleDate: z.iso.date(),
  customer: z.string().trim().min(1).max(128),
  birdsSold: z.number().int().positive().max(2147483647),
  totalWeightKg: z.number().positive().max(999999999.999)
    .refine((value) => Number(value.toFixed(3)) === value, "Use at most three decimal places."),
  priceBasis: z.enum(["Bird", "Kg"]),
  priceKes: money,
  paidKes: money.default(0),
  receiptNumber: z.string().trim().max(64).nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
}).refine((value) => {
  const amountKes = value.priceBasis === "Kg"
    ? value.totalWeightKg * value.priceKes
    : value.birdsSold * value.priceKes;
  const amountCents = Math.round(amountKes * 100 + Number.EPSILON * Math.abs(amountKes * 100));
  const paidCents = Math.round(value.paidKes * 100 + Number.EPSILON * Math.abs(value.paidKes * 100));
  return amountCents <= 999999999999 && paidCents <= amountCents;
}, "Sale amount must fit the database limit and cover the initial payment.");

export const salesListQuerySchema = z.object({
  farmId: z.string().uuid(),
  batchId: z.string().uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  paymentStatus: z.enum(["paid", "partial", "unpaid"]).optional(),
  search: z.string().trim().max(128).optional(),
}).refine(
  (value) => !value.from || !value.to || value.from <= value.to,
  { path: ["to"], message: "The end date must be on or after the start date." },
);

export const salePaymentCreateSchema = z.object({
  farmId: z.string().uuid(),
  paymentDate: z.iso.date(),
  amountKes: z.number().positive().max(9999999999.99)
    .refine((value) => Number(value.toFixed(2)) === value, "Use at most two decimal places."),
  reference: z.string().trim().max(64).nullable().optional(),
});
