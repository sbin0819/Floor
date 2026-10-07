import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

describe("environment", () => {
  it("allows absent database and authentication settings for builds", () => {
    const env = parseEnv({});
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.AUTH_SECRET).toBeUndefined();
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });
  it("normalizes optional empty values", () => {
    expect(
      parseEnv({
        DATABASE_URL: "",
        AUTH_SECRET: "",
        NEXT_PUBLIC_APP_URL: "",
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
      }),
    ).toMatchObject({
      DATABASE_URL: undefined,
      AUTH_SECRET: undefined,
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
    });
  });
  it.each(["GOOGLE", "GITHUB"])(
    "requires paired %s credentials",
    (provider) => {
      expect(() => parseEnv({ [`${provider}_CLIENT_ID`]: "id" })).toThrow();
      expect(() =>
        parseEnv({ [`${provider}_CLIENT_SECRET`]: "secret" }),
      ).toThrow();
      expect(() =>
        parseEnv({
          [`${provider}_CLIENT_ID`]: "id",
          [`${provider}_CLIENT_SECRET`]: "",
        }),
      ).toThrow();
      expect(() =>
        parseEnv({
          [`${provider}_CLIENT_ID`]: "id",
          [`${provider}_CLIENT_SECRET`]: "secret",
        }),
      ).not.toThrow();
    },
  );
  it("requires a provided secret to have at least 32 bytes", () => {
    expect(() => parseEnv({ AUTH_SECRET: "x".repeat(31) })).toThrow();
    expect(parseEnv({ AUTH_SECRET: "x".repeat(32) }).AUTH_SECRET).toHaveLength(
      32,
    );
  });
  it("rejects an invalid application URL", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_APP_URL: "not-a-url" })).toThrow();
  });
  it("accepts supplied database and app URLs", () => {
    expect(
      parseEnv({
        DATABASE_URL: "postgresql://user:password@example.invalid/floor",
        NEXT_PUBLIC_APP_URL: "https://floor.example.invalid",
      }).NEXT_PUBLIC_APP_URL,
    ).toBe("https://floor.example.invalid");
  });
});
