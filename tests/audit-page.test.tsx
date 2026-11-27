/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditPage } from "../src/components/audit-page";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("@/lib/client/request", () => ({
  request: requestMock,
}));

const farmId = "11111111-1111-4111-8111-111111111111";
const auditEvent = {
  id: 42,
  farm_id: farmId,
  table_name: "batches",
  record_id: "22222222-2222-4222-8222-222222222222",
  operation: "UPDATE" as const,
  actor_id: "33333333-3333-4333-8333-333333333333",
  old_data: { batch_code: "OLD-01", status: "running" },
  new_data: { batch_code: "NEW-01", status: "closed" },
  occurred_at: "2026-11-27T10:15:30Z",
};

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({
    data: [auditEvent],
    pagination: { page: 1, pageSize: 25, total: 1, pageCount: 1, hasMore: false },
  });
});

afterEach(() => {
  cleanup();
});

describe("farm audit event details", () => {
  it("opens a snapshot detail view and returns to the filtered history", async () => {
    render(<AuditPage farmId={farmId} role="owner" />);

    expect(await screen.findByRole("heading", { name: "Audit log" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Activity category" })).toBeTruthy();
    expect(screen.getByText("Matching events")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Open audit event 42" }));

    expect(screen.getByRole("heading", { name: "batches" })).toBeTruthy();
    expect(screen.getByText("AUDIT EVENT #42")).toBeTruthy();
    expect(screen.getByLabelText("Before snapshot").textContent).toContain("OLD-01");
    expect(screen.getByLabelText("After snapshot").textContent).toContain("NEW-01");

    fireEvent.click(screen.getByRole("button", { name: "Back to history" }));
    expect(screen.getByRole("heading", { name: "Audit log" })).toBeTruthy();
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("filters the event list by category and date range", async () => {
    render(<AuditPage farmId={farmId} role="owner" />);

    await screen.findByRole("button", { name: "Open audit event 42" });
    fireEvent.click(screen.getByRole("button", { name: "Financial" }));
    await waitFor(() => {
      expect(requestMock).toHaveBeenLastCalledWith(
        expect.stringContaining("category=financial"),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-11-01" } });
    await waitFor(() => {
      expect(requestMock).toHaveBeenLastCalledWith(
        expect.stringContaining("from=2026-11-01"),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear dates" }));
    await waitFor(() => {
      expect(requestMock).toHaveBeenLastCalledWith(
        expect.not.stringContaining("from="),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it("does not fetch or expose audit details to a non-owner", async () => {
    render(<AuditPage farmId={farmId} role="manager" />);

    expect(screen.getByRole("heading", { name: "Audit access is restricted" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull();
    await waitFor(() => expect(requestMock).not.toHaveBeenCalled());
  });
});
