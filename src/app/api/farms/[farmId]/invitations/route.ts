import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, isUuid } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/app-url";
import { createHash, randomBytes } from "node:crypto";
import {
  attemptKey,
  getClientIp,
  payloadHash,
  requireIdempotencyKey,
} from "@/lib/security";
import {
  paginationMetadata,
  parsePagination,
} from "@/lib/api/pagination";

const invitationSchema = z.object({
  email: z.email().transform((email) => email.trim().toLowerCase()),
  role: z.enum(["manager", "attendant", "accountant", "veterinarian", "inventory_officer"]),
  fullName: z.string().trim().min(1).max(128).optional(),
  password: z.string().min(8).max(128),
});

const reservationSchema = z.object({
  reservationId: z.string().uuid(),
  status: z.enum(["reserved", "provisioned", "consumed", "released"]),
  expiresAt: z.string(),
  reused: z.boolean(),
});

type RouteContext = { params: Promise<{ farmId: string }> };

async function compensateStaffProvisioning(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  reservationId: string,
  authUserId?: string,
) {
  let compensationFailed = false;
  if (authUserId) {
    try {
      const { error } = await admin.auth.admin.deleteUser(authUserId);
      if (error) {
        compensationFailed = true;
        console.error("Failed to delete partially provisioned Auth user:", {
          status: error.status,
          reservationId,
        });
      }
    } catch {
      compensationFailed = true;
      console.error("Could not reach Auth to delete a partially provisioned user:", { reservationId });
    }
  }

  try {
    const { error } = await admin.rpc("release_farm_staff_seat_reservation", {
      p_reservation_id: reservationId,
    });
    if (error) {
      compensationFailed = true;
      console.error("Failed to release a staff seat reservation:", {
        code: error.code,
        reservationId,
      });
    }
  } catch {
    compensationFailed = true;
    console.error("Could not reach the database to release a staff seat reservation:", { reservationId });
  }
  return !compensationFailed;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination) return apiError("Provide valid page and pageSize values (1-100).", 400);
  const { farmId } = await context.params;
  if (!isUuid(farmId)) return apiError("Invalid farm ID.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const { data, error } = await supabase.rpc("get_farm_staff_invitations", {
      p_farm_id: farmId,
    });
    if (error) {
      if (error.code === "42501") return apiError("Staff invitation permission required.", 403);
      console.error("Failed to load invitations:", error.code);
      return apiError("Could not load invitations.", 500);
    }
    const invitations = data ?? [];
    const from = (pagination.page - 1) * pagination.pageSize;
    return NextResponse.json({
      data: invitations.slice(from, from + pagination.pageSize),
      pagination: paginationMetadata(invitations.length, pagination),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected invitation list error:", error);
    return apiError("Could not load invitations.", 500);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { farmId } = await context.params;
  if (!isUuid(farmId)) return apiError("Invalid farm ID.", 400);
  const idempotencyKey = requireIdempotencyKey(request);
  if (!idempotencyKey) return apiError("Provide an Idempotency-Key header.", 400);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }
  const parsed = invitationSchema.safeParse(body);
  if (!parsed.success) return apiError("Provide a valid email and staff role.", 400);
  const appUrl = getAppUrl();
  if (!appUrl) return apiError("Application URL is not configured.", 503);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);
    const keyHash = attemptKey(getClientIp(request), user.id);
    const { data: allowed, error: limitError } = await supabase.rpc(
      "check_auth_attempt",
      { p_scope: "staff-invite", p_key_hash: keyHash, p_limit: 20, p_window_seconds: 3600 },
    );
    if (limitError) return apiError("Staff provisioning is temporarily unavailable.", 503);
    if (!allowed) return apiError("Too many staff invitations. Try again later.", 429);

    const admin = createSupabaseAdminClient();
    const tempPassword = parsed.data.password;
    const { data: reservationData, error: reservationError } = await supabase.rpc(
      "reserve_farm_staff_seat",
      {
        p_farm_id: farmId,
        p_email: parsed.data.email,
        p_role: parsed.data.role,
        p_full_name: parsed.data.fullName ?? null,
        p_idempotency_key_hash: createHash("sha256").update(idempotencyKey).digest("hex"),
        p_payload_hash: payloadHash({
          email: parsed.data.email,
          role: parsed.data.role,
          fullName: parsed.data.fullName ?? null,
        }),
      },
    );
    if (reservationError) {
      if (reservationError.message === "STAFF_SEAT_QUOTA_EXCEEDED") {
        return NextResponse.json(
          {
            error: "The additional staff limit for this farm has been reached. Remove a staff member or change plans before inviting another.",
            code: "QUOTA_EXCEEDED",
          },
          { status: 409 },
        );
      }
      if (reservationError.code === "42501") {
        return apiError("Staff invitation permission required for this farm.", 403);
      }
      if (reservationError.code === "55000") {
        return apiError("The additional staff limit is unavailable. Contact support.", 503);
      }
      if (reservationError.code === "23505") {
        return apiError("A staff seat for this email is already reserved or requires reconciliation.", 409);
      }
      if (reservationError.code === "P0001") {
        return apiError(reservationError.message, 409);
      }
      console.error("Failed to reserve a staff seat:", reservationError.code);
      return apiError("Could not reserve a staff seat.", 500);
    }

    const parsedReservation = reservationSchema.safeParse(reservationData);
    if (!parsedReservation.success) {
      console.error("Staff seat reservation returned an invalid response.");
      return apiError("Could not reserve a staff seat.", 500);
    }
    const reservation = parsedReservation.data;
    if (reservation.reused && reservation.status === "released") {
      return apiError("The previous provisioning attempt was rolled back. Submit again to retry.", 409);
    }
    if (reservation.reused || reservation.status !== "reserved") {
      return apiError("This invitation request has already been processed or is still in progress.", 409);
    }

    let createdUser: Awaited<ReturnType<typeof admin.auth.admin.createUser>>;
    try {
      createdUser = await admin.auth.admin.createUser({
        email: parsed.data.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          full_name: parsed.data.fullName ?? "",
          force_password_change: true,
          staff_reservation_id: reservation.reservationId,
        },
        app_metadata: {
          force_password_change: true,
          staff_reservation_id: reservation.reservationId,
        },
      });
    } catch {
      console.error("Staff Auth provisioning outcome is unknown; reservation retained for reconciliation:", {
        reservationId: reservation.reservationId,
      });
      return apiError(`Staff provisioning did not complete. Contact support with reservation ${reservation.reservationId}.`, 503);
    }
    const { error: createError } = createdUser;
    const createdAuthUser = createdUser.data.user;
    if (createError) {
      if (createError.status === 422) {
        const compensated = await compensateStaffProvisioning(admin, reservation.reservationId);
        if (!compensated) {
          return apiError(`Could not create the staff account. Contact support with reservation ${reservation.reservationId}.`, 500);
        }
        return apiError("An Auth account already uses this email address.", 409);
      }
      console.error("Failed to create staff Auth account; reservation left to expire for reconciliation:", {
        status: createError.status,
        reservationId: reservation.reservationId,
      });
      return apiError(`Staff provisioning did not complete. Contact support with reservation ${reservation.reservationId}.`, 503);
    }
    if (!createdAuthUser) {
      const compensated = await compensateStaffProvisioning(admin, reservation.reservationId);
      return apiError(
        !compensated
          ? `Could not create the staff account. Contact support with reservation ${reservation.reservationId}.`
          : "Could not create the staff account.",
        !compensated ? 500 : 503,
      );
    }

    const setupToken = randomBytes(32).toString("base64url");
    const setupTokenHash = createHash("sha256").update(setupToken).digest("hex");

    const setupUrl = new URL("/staff/setup", appUrl);
    setupUrl.searchParams.set("token_hash", setupToken);
    setupUrl.searchParams.set("email", parsed.data.email);
    let finalization: Awaited<ReturnType<typeof admin.rpc>>;
    try {
      finalization = await admin.rpc("finalize_farm_staff_invitation", {
        p_reservation_id: reservation.reservationId,
        p_auth_user_id: createdAuthUser.id,
        p_setup_token_hash: setupTokenHash,
      });
    } catch {
      const compensated = await compensateStaffProvisioning(
        admin,
        reservation.reservationId,
        createdAuthUser.id,
      );
      if (!compensated) {
        return apiError(`Staff provisioning failed and requires reconciliation. Contact support with reservation ${reservation.reservationId}.`, 500);
      }
      console.error("Staff invitation finalization request failed:", {
        reservationId: reservation.reservationId,
      });
      return apiError("Could not create invitation.", 500);
    }
    const { data, error } = finalization;
    if (error) {
      const compensated = await compensateStaffProvisioning(
        admin,
        reservation.reservationId,
        createdAuthUser.id,
      );
      if (!compensated) {
        return apiError(`Staff provisioning failed and requires reconciliation. Contact support with reservation ${reservation.reservationId}.`, 500);
      }
      console.error("Failed to finalize staff invitation:", {
        code: error.code,
        reservationId: reservation.reservationId,
      });
      if (error.code === "42501") return apiError("Staff invitation could not be finalized.", 403);
      return apiError("Could not create invitation.", 500);
    }
    const invitation = z.object({
      id: z.string().uuid(),
      email: z.string(),
      role: z.string(),
      status: z.string(),
      created_at: z.string(),
    }).safeParse(data);
    if (!invitation.success) {
      const compensated = await compensateStaffProvisioning(
        admin,
        reservation.reservationId,
        createdAuthUser.id,
      );
      if (!compensated) {
        return apiError(`Staff provisioning failed and requires reconciliation. Contact support with reservation ${reservation.reservationId}.`, 500);
      }
      console.error("Staff invitation finalization returned an invalid response.");
      return apiError("Could not create invitation.", 500);
    }
    return NextResponse.json({
      data: {
        ...invitation.data,
        setupUrl: setupUrl.toString(),
        temporaryPassword: tempPassword,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return apiError(error.message, 503);
    console.error("Unexpected invitation creation error:", error);
    return apiError("Could not create invitation.", 500);
  }
}
