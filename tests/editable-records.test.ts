import { describe, expect, it } from "vitest";
import { editableResources } from "../src/lib/api/editable-records";

describe("editable record definitions", () => {
  it("limits edits to explicitly approved fields and excludes append-only records", () => {
    expect(editableResources["daily-records"].editableFields.dead.schema.safeParse(2).success).toBe(true);
    expect(editableResources["daily-records"].editableFields.dead.schema.safeParse(-1).success).toBe(false);
    expect(editableResources.batches.editableFields.status).toBeUndefined();
    expect(editableResources.sales).toBeUndefined();
    expect(editableResources["cash-entries"]).toBeUndefined();
    expect(editableResources["daily-records"].editableFields.batchId).toBeUndefined();
    expect(editableResources.batches.deletable).toBe(false);
    expect(editableResources.corrections).toBeUndefined();
    expect(editableResources["audit-events"]).toBeUndefined();
  });

  it("rejects invalid enum and date values before they reach the database", () => {
    expect(
      editableResources["health-records"].editableFields.recordType.schema.safeParse("Other").success,
    ).toBe(false);
    expect(
      editableResources["daily-records"].editableFields.recordDate.schema.safeParse("not-a-date").success,
    ).toBe(false);
  });
});
