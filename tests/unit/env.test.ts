import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

describe("environment", () => {
  it("allows absent database and authentication settings for builds", () => {
    const env = parseEnv({});
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.SEED_ALLOW_HOST).toBeUndefined();
    expect(env.AUTH_SECRET).toBeUndefined();
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });
  it("normalizes optional empty values", () => {
    expect(
      parseEnv({
        DATABASE_URL: "",
        SEED_ALLOW_HOST: "",
        AUTH_SECRET: "",
        NEXT_PUBLIC_APP_URL: "",
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
      }),
    ).toMatchObject({
      DATABASE_URL: undefined,
      SEED_ALLOW_HOST: undefined,
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
  it("accepts optional local storage settings without enabling them in the parser", () => {
    expect(parseEnv({}).FILE_STORAGE).toBeUndefined();
    expect(parseEnv({ FILE_STORAGE: "", FILE_STORAGE_DIR: "" })).toMatchObject({
      FILE_STORAGE: undefined,
      FILE_STORAGE_DIR: undefined,
    });
    expect(
      parseEnv({ FILE_STORAGE: "local", FILE_STORAGE_DIR: "/private/uploads" }),
    ).toMatchObject({
      FILE_STORAGE: "local",
      FILE_STORAGE_DIR: "/private/uploads",
    });
    expect(parseEnv({ FILE_STORAGE: "disabled" }).FILE_STORAGE).toBe(
      "disabled",
    );
    for (const value of ["s3", "LOCAL", " local "])
      expect(() => parseEnv({ FILE_STORAGE: value })).toThrow();
  });
  it("preserves the exact optional seed hostname for the CLI allowlist", () => {
    expect(
      parseEnv({ SEED_ALLOW_HOST: "dev-db.example.test" }).SEED_ALLOW_HOST,
    ).toBe("dev-db.example.test");
    expect(
      parseEnv({ SEED_ALLOW_HOST: " DEV-DB.example.test " }).SEED_ALLOW_HOST,
    ).toBe(" DEV-DB.example.test ");
  });
  it("accepts absent, partial and complete optional R2 settings", () => {
    const empty = {
      R2_ACCESS_KEY_ID: "",
      R2_SECRET_ACCESS_KEY: "",
      R2_ENDPOINT: "",
      R2_BUCKET: "",
    };
    for (const key of Object.keys(empty)) {
      expect(parseEnv({})[key as keyof typeof empty]).toBeUndefined();
      expect(parseEnv(empty)[key as keyof typeof empty]).toBeUndefined();
    }
    expect(parseEnv({ R2_BUCKET: "floor-images" }).R2_BUCKET).toBe(
      "floor-images",
    );
    expect(
      parseEnv({
        R2_ACCESS_KEY_ID: "fake-access",
        R2_SECRET_ACCESS_KEY: "fake-secret",
        R2_ENDPOINT: "https://test.r2.cloudflarestorage.com",
        R2_BUCKET: "floor-images",
      }),
    ).toMatchObject({ R2_BUCKET: "floor-images" });
  });
  it.each(["http://example.invalid", "ftp://example.invalid", "not-a-url"])(
    "rejects the non-HTTPS R2 endpoint %s",
    (R2_ENDPOINT) => {
      expect(() => parseEnv({ R2_ENDPOINT })).toThrow();
    },
  );
  it("accepts supplied database and app URLs", () => {
    expect(
      parseEnv({
        DATABASE_URL: "postgresql://user:password@example.invalid/floor",
        NEXT_PUBLIC_APP_URL: "https://floor.example.invalid",
      }).NEXT_PUBLIC_APP_URL,
    ).toBe("https://floor.example.invalid");
  });
});
