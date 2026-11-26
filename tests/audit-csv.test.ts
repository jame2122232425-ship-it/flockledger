import { describe, expect, it } from "vitest";
import { auditCsv } from "@/lib/audit/csv";

describe("auditCsv", () => {
  it("quotes CSV separators, quotes, and line breaks", () => {
    const csv = auditCsv([{
      table_name: "sales, archived",
      old_data: 'Customer said "received"\nconfirmed',
    }]);

    expect(csv).toContain('"sales, archived"');
    expect(csv).toContain('"Customer said ""received""\nconfirmed"');
  });

  it("neutralizes spreadsheet formulas in string cells", () => {
    const csv = auditCsv([{ old_data: "=HYPERLINK(\"https://example.invalid\")" }]);

    expect(csv).toContain("\"'=HYPERLINK(\"\"https://example.invalid\"\")\"");
  });

  it("exports platform governance fields with platform headers", () => {
    const csv = auditCsv([{
      event_type: "farm_approved",
      actor_user_id: "11111111-1111-4111-8111-111111111111",
    }], "platform");

    expect(csv.startsWith('"id","event_type","application_id"')).toBe(true);
    expect(csv).toContain('"farm_approved"');
  });
});
