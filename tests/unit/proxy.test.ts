import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch as unstable_doesProxyMatch } from "next/experimental/testing/server";
import { config, proxy } from "@/proxy";

describe("optimistic route protection", () => {
  it.each([
    "/",
    "/teams/start",
    "/invite/token",
    "/admin",
    "/admin/branches",
    "/branches",
    "/branches/branch/floors/floor",
    "/bookings",
    "/bookings/11111111-1111-4111-8111-111111111111/edit",
    "/booking",
    "/notifications",
    "/messages",
    "/messages/new",
    "/dm/11111111-1111-4111-8111-111111111111",
    "/m/11111111-1111-4111-8111-111111111111",
    "/friends",
    "/settings",
    "/s/11111111-1111-4111-8111-111111111111",
    "/s/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222",
  ])("matches protected route %s", (url) => {
    expect(unstable_doesProxyMatch({ config, nextConfig: {}, url })).toBe(true);
  });
  it.each([
    "/login",
    "/signup",
    "/verify-email",
    "/forgot-password",
    "/reset-password",
    "/api/auth/sign-in/email",
    "/api/participants/search",
    "/api/notifications",
    "/api/realtime/token",
    "/api/uploads/11111111-1111-4111-8111-111111111111",
    "/api/people/search",
    "/api/people/11111111-1111-4111-8111-111111111111",
    "/favicon.ico",
    "/_next/static/test.js",
  ])("does not touch public route %s", (url) => {
    expect(unstable_doesProxyMatch({ config, nextConfig: {}, url })).toBe(
      false,
    );
  });
  it("preserves path and query when sending an anonymous visitor to login", () => {
    const response = proxy(
      new NextRequest("https://floor.example.test/invite/token?x=1"),
    );
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/invite/token?x=1");
  });
  it.each(["/bookings", "/bookings/11111111-1111-4111-8111-111111111111/edit"])(
    "sends anonymous booking route %s to login",
    (pathname) => {
      const response = proxy(
        new NextRequest(`https://floor.example.test${pathname}`),
      );
      const location = new URL(response.headers.get("location")!);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe(pathname);
    },
  );
  it("uses the operator login without redirecting that login itself", () => {
    expect(
      proxy(new NextRequest("https://floor.example.test/admin")).headers.get(
        "location",
      ),
    ).toBe("https://floor.example.test/admin/login");
    expect(
      proxy(
        new NextRequest("https://floor.example.test/admin/login"),
      ).headers.get("location"),
    ).toBeNull();
  });
  it.each(["better-auth.session_token", "__Secure-better-auth.session_token"])(
    "does not validate the %s cookie in the proxy",
    (name) => {
      const request = new NextRequest("https://floor.example.test/", {
        headers: { cookie: `${name}=expired-or-forged` },
      });
      expect(proxy(request).headers.get("location")).toBeNull();
    },
  );
});
