import { afterEach, describe, expect, it } from "vitest";
import { getAppUrl } from "../src/lib/app-url";

const originalVercelEnv = process.env.VERCEL_ENV;
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;

  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
});

describe("getAppUrl", () => {
  it("uses the canonical host for Vercel production even if the configured URL is local", () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

    expect(getAppUrl()?.origin).toBe("https://flockledgerupdated.vercel.app");
  });

  it("uses the configured URL for preview deployments", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.NEXT_PUBLIC_APP_URL = "https://flockledger-preview.vercel.app";

    expect(getAppUrl()?.origin).toBe("https://flockledger-preview.vercel.app");
  });
});
