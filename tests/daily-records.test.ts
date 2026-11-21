import { describe, expect, it } from "vitest";
import { dailyRecordCreateSchema } from "../src/lib/validation/daily-records";

const record = {
  farmId: "11111111-1111-4111-8111-111111111111",
  batchId: "22222222-2222-4222-8222-222222222222",
  recordDate: "2026-11-21",
  dead: 0,
  culled: 0,
  feedGivenKg: 12,
  feedLeftKg: 1,
  waterLiters: 25,
};

describe("dailyRecordCreateSchema", () => {
  it("accepts a valid daily record", () => {
    expect(dailyRecordCreateSchema.safeParse(record).success).toBe(true);
  });

  it("rejects feed left over greater than feed given with a clear message", () => {
    const result = dailyRecordCreateSchema.safeParse({ ...record, feedGivenKg: 4, feedLeftKg: 5 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Feed left over after feeding cannot exceed feed given.",
      );
    }
  });

  it("rejects minimum temperature greater than maximum", () => {
    expect(
      dailyRecordCreateSchema.safeParse({ ...record, tempMinC: 30, tempMaxC: 24 }).success,
    ).toBe(false);
  });
});
