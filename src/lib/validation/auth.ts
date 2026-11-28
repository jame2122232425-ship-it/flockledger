import { z } from "zod";

export const signUpSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
  fullName: z.string().trim().min(1).max(128),
});

export const passwordResetRequestSchema = z.object({
  email: z.email(),
});

export const passwordUpdateSchema = z.object({
  password: z.string().min(8).max(128),
});
