import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  membershipQuery: {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  },
  supabase: {
    auth: { getUser: vi.fn() },
    rpc: vi.fn(),
    from: vi.fn(),
  },
  admin: {
    auth: {
      admin: {
        createUser: vi.fn(),
        deleteUser: vi.fn(),
      },
    },
    rpc: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => mocks.supabase),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => mocks.admin),
}));

import { POST as createBatch } from "@/app/api/batches/route";
import { POST as createInvitation } from "@/app/api/farms/[farmId]/invitations/route";
import { POST as addFarmMember } from "@/app/api/farms/[farmId]/members/route";

const farmId = "11111111-1111-4111-8111-111111111111";
const authUserId = "22222222-2222-4222-8222-222222222222";
const reservationId = "33333333-3333-4333-8333-333333333333";
const invitationId = "44444444-4444-4444-8444-444444444444";

function batchRequest() {
  return new NextRequest("https://flockledger.test/api/batches", {
    method: "POST",
    body: JSON.stringify({
      farmId,
      batchCode: "BR-2026-001",
      batchType: "Broiler",
      datePlaced: "2026-11-25",
      chicksReceived: 100,
    }),
  });
}

function invitationRequest() {
  return new NextRequest(`https://flockledger.test/api/farms/${farmId}/invitations`, {
    method: "POST",
    headers: { "Idempotency-Key": "staff-invite-request-0001" },
    body: JSON.stringify({
      email: "worker@example.test",
      role: "attendant",
      fullName: "Farm Worker",
      password: "Temporary-pass-123",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.membershipQuery.select.mockReturnThis();
  mocks.membershipQuery.eq.mockReturnThis();
  mocks.membershipQuery.maybeSingle.mockResolvedValue({
    data: { role: "owner" },
    error: null,
  });
  mocks.supabase.auth.getUser.mockResolvedValue({
    data: { user: { id: authUserId } },
    error: null,
  });
  mocks.supabase.from.mockReturnValue(mocks.membershipQuery);
  mocks.supabase.rpc.mockImplementation(async (name: string) => {
    if (name === "check_auth_attempt") return { data: true, error: null };
    if (name === "reserve_farm_staff_seat") {
      return {
        data: {
          reservationId,
          status: "reserved",
          expiresAt: "2026-12-02T00:00:00.000Z",
          reused: false,
        },
        error: null,
      };
    }
    return { data: null, error: null };
  });
  mocks.admin.auth.admin.createUser.mockResolvedValue({
    data: { user: { id: "55555555-5555-4555-8555-555555555555" } },
    error: null,
  });
  mocks.admin.auth.admin.deleteUser.mockResolvedValue({ data: {}, error: null });
  mocks.admin.rpc.mockImplementation(async (name: string) => {
    if (name === "finalize_farm_staff_invitation") {
      return {
        data: {
          id: invitationId,
          email: "worker@example.test",
          role: "attendant",
          status: "pending",
          created_at: "2026-11-25T00:00:00.000Z",
        },
        error: null,
      };
    }
    return { data: true, error: null };
  });
});

describe("quota-protected API writes", () => {
  it("returns a clear conflict when the batch quota RPC rejects creation", async () => {
    mocks.supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "ACTIVE_BATCH_QUOTA_EXCEEDED" },
    });

    const response = await createBatch(batchRequest());
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.code).toBe("QUOTA_EXCEEDED");
    expect(payload.error).toContain("active batch limit");
  });

  it("explains when the database does not recognize batch-creation permissions", async () => {
    mocks.supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "You cannot create batches for this farm." },
    });

    const response = await createBatch(batchRequest());
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain("owner or manager");
    expect(payload.error).toContain("verify your role");
  });

  it("does not provision an Auth user when staff-seat reservation exceeds quota", async () => {
    mocks.supabase.rpc.mockImplementation(async (name: string) => {
      if (name === "check_auth_attempt") return { data: true, error: null };
      return {
        data: null,
        error: { code: "P0001", message: "STAFF_SEAT_QUOTA_EXCEEDED" },
      };
    });

    const response = await createInvitation(invitationRequest(), {
      params: Promise.resolve({ farmId }),
    });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.code).toBe("QUOTA_EXCEEDED");
    expect(mocks.admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("releases a seat when Auth rejects staff-account creation", async () => {
    mocks.admin.auth.admin.createUser.mockResolvedValue({
      data: { user: null },
      error: { status: 422 },
    });

    const response = await createInvitation(invitationRequest(), {
      params: Promise.resolve({ farmId }),
    });

    expect(response.status).toBe(409);
    expect(mocks.admin.rpc).toHaveBeenCalledWith(
      "release_farm_staff_seat_reservation",
      { p_reservation_id: reservationId },
    );
  });

  it("compensates a failed invitation finalization without granting membership", async () => {
    mocks.admin.rpc.mockImplementation(async (name: string) => {
      if (name === "finalize_farm_staff_invitation") {
        return { data: null, error: { code: "XX000", message: "Database unavailable." } };
      }
      return { data: true, error: null };
    });

    const response = await createInvitation(invitationRequest(), {
      params: Promise.resolve({ farmId }),
    });

    expect(response.status).toBe(500);
    expect(mocks.admin.auth.admin.deleteUser).toHaveBeenCalledWith(
      "55555555-5555-4555-8555-555555555555",
    );
    expect(mocks.admin.rpc).toHaveBeenCalledWith(
      "release_farm_staff_seat_reservation",
      { p_reservation_id: reservationId },
    );
  });

  it("creates an invitation but does not insert farm membership before setup", async () => {
    const response = await createInvitation(invitationRequest(), {
      params: Promise.resolve({ farmId }),
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.status).toBe("pending");
    expect(mocks.admin.rpc).toHaveBeenCalledWith(
      "finalize_farm_staff_invitation",
      expect.objectContaining({ p_reservation_id: reservationId }),
    );
    expect(mocks.admin).not.toHaveProperty("from");
  });

  it("blocks direct member creation that could bypass staff setup and seat reservations", async () => {
    const response = await addFarmMember();
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toContain("complete an invitation setup");
  });
});
