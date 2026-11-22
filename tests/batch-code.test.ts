import { describe, expect, it } from "vitest";
import { generateBatchCode } from "../src/lib/batches/batch-code";

describe("generateBatchCode", () => {
  it("uses the farm initials, bird type, placement month, and monthly sequence", () => {
    expect(generateBatchCode("Rosy Poultry Farm", "Broiler", "2026-11-12", "", []))
      .toBe("RPF-BR-2611-01");
  });

  it("increments the highest matching sequence without reusing skipped numbers", () => {
    expect(generateBatchCode(
      "Rosy Poultry Farm",
      "Broiler",
      "2026-11-28",
      "",
      ["RPF-BR-2611-01", "RPF-BR-2611-03", "RPF-KJ-2611-01"],
    )).toBe("RPF-BR-2611-04");
  });

  it("adds a house token and returns no code for an invalid placement date", () => {
    expect(generateBatchCode("Rosy Poultry Farm", "Kienyeji", "2026-11-20", "House A", []))
      .toBe("RPF-KJ-A-2611-01");
    expect(generateBatchCode("Rosy Poultry Farm", "Broiler", "2026-02-30", "", []))
      .toBe("");
  });
});
