import { describe, expect, it } from "vitest";
import { signUpSchema } from "../src/lib/validation/auth";

describe("signUpSchema", () => {
  const account = {
    email: "farmer@example.com",
    fullName: "Farm Owner",
  };

  it("accepts an 8-character password", () => {
    expect(signUpSchema.safeParse({ ...account, password: "poultry8" }).success).toBe(true);
  });

  it("rejects passwords shorter than 8 characters", () => {
    expect(signUpSchema.safeParse({ ...account, password: "bird123" }).success).toBe(false);
  });
});
