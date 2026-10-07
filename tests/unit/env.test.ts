import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

describe("environment", () => {
  it("allows absent database and authentication settings", () => {
    const env = parseEnv({});
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.AUTH_SECRET).toBeUndefined();
    expect(env).toMatchObject({
      AUTH_MODE: "",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    });
  });
  it("normalizes optional empty values", () => {
    expect(
      parseEnv({ DATABASE_URL: "", AUTH_SECRET: "", NEXT_PUBLIC_APP_URL: "" }),
    ).toMatchObject({
      DATABASE_URL: undefined,
      AUTH_SECRET: undefined,
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    });
  });
  it.each([undefined, ""])("requires a secret for demo mode (%s)", (secret) => {
    expect(() =>
      parseEnv({ AUTH_MODE: "demo", AUTH_SECRET: secret }),
    ).toThrow();
  });
  it("accepts a non-empty demo secret without an extra length restriction", () => {
    expect(
      parseEnv({ AUTH_MODE: "demo", AUTH_SECRET: "test-key" }).AUTH_MODE,
    ).toBe("demo");
  });
  it("rejects unknown authentication modes", () => {
    expect(() => parseEnv({ AUTH_MODE: "production" })).toThrow();
  });
  it("rejects an invalid application URL", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_APP_URL: "not-a-url" })).toThrow();
  });
  it("accepts the supplied database URL and app URL", () => {
    expect(
      parseEnv({
        DATABASE_URL: "postgresql://user:password@example.invalid/floor",
        NEXT_PUBLIC_APP_URL: "https://floor.example.invalid",
      }).NEXT_PUBLIC_APP_URL,
    ).toBe("https://floor.example.invalid");
  });
});
