import { describe, expect, it } from "vitest";
import { isSameOrigin } from "@/lib/http/same-origin";

describe("same-origin HTTP writes", () => {
  it.each([
    "https://floor.test",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://192.168.10.5:3000",
    "http://[::1]:3000",
  ])("compares %s to the request URL, not a configured app URL", (origin) => {
    expect(
      isSameOrigin(
        new Request(`${origin}/api/calls/leave`, {
          headers: { Origin: origin },
        }),
      ),
    ).toBe(true);
  });

  it.each([
    null,
    "",
    "null",
    "https://other.test",
    "http://floor.test",
    "https://floor.test:3000",
    "https://floor.test.attacker.test",
    "https://floor.test@attacker.test",
    "https://attacker.test@floor.test",
    "https://floor.test/",
    "https://floor.test/path",
    "https://floor.test?query=1",
    "https://floor.test#hash",
    "https://floor.test https://other.test",
    "not a URL",
  ])("fails closed for the Origin header %s", (origin) => {
    const headers = new Headers();
    if (origin !== null) headers.set("Origin", origin);
    expect(
      isSameOrigin(
        new Request("https://floor.test/api/calls/leave", { headers }),
      ),
    ).toBe(false);
  });

  it("does not trust forwarded or Host headers over the request URL", () => {
    expect(
      isSameOrigin(
        new Request("https://floor.test/api/calls/leave", {
          headers: {
            Origin: "https://attacker.test",
            Host: "attacker.test",
            "X-Forwarded-Host": "attacker.test",
            "X-Forwarded-Proto": "https",
          },
        }),
      ),
    ).toBe(false);
  });

  it.each(["not a URL", "data:text/plain,hello", "file:///tmp/example"])(
    "rejects an invalid or non-HTTP target %s",
    (url) => {
      expect(
        isSameOrigin({ url, headers: new Headers({ Origin: "null" }) }),
      ).toBe(false);
      expect(
        isSameOrigin({
          url,
          headers: new Headers({ Origin: "https://floor.test" }),
        }),
      ).toBe(false);
    },
  );
});
