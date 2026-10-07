import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth/safe-next";

describe("safeNext", () => {
  it.each([
    undefined,
    null,
    [],
    "",
    "relative",
    "/\\evil.com",
    "/%5Cevil.com",
    "/\t/evil.com",
    "https://evil.com",
    "//evil.com",
    "/api/auth/sign-out",
    "/api",
    "/%61pi/auth/sign-out",
    "/public/../api/auth/sign-out",
    "/%2fexample.com",
    "/%00",
    "/%0a",
    "/bad%",
    "/login",
    "/signup?next=/",
    "/admin/login",
  ])("falls back for unsafe destination %s", (value) => {
    expect(safeNext(value, "https://floor.example.test")).toBe("/");
  });
  it.each([
    "/",
    "/teams/start",
    "/invite/abc?x=1",
    "/admin",
    "/teams/start?q=팀#results",
  ])("keeps local destination %s", (value) => {
    const url = new URL(value, "https://floor.example.test");
    expect(safeNext(value, "https://floor.example.test")).toBe(
      `${url.pathname}${url.search}${url.hash}`,
    );
  });
});
