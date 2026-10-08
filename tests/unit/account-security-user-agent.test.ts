import { describe, expect, it } from "vitest";
import { parseUserAgent } from "@/lib/user-agent";

describe("safe account device descriptions", () => {
  it.each([
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36",
      "Chrome",
      "macOS",
      "desktop",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0",
      "Edge",
      "Windows",
      "desktop",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36 SamsungBrowser/26.0",
      "Samsung Internet",
      "Android",
      "mobile",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E Safari/604.1",
      "Safari",
      "iOS",
      "mobile",
    ],
    [
      "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Version/18.0 Mobile/15E Safari/604.1",
      "Safari",
      "iPadOS",
      "mobile",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18.0 Mobile/15E Safari/604.1",
      "Safari",
      "iPadOS",
      "mobile",
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/130.0",
      "Firefox",
      "Linux",
      "desktop",
    ],
    [
      "Mozilla/5.0 (iPhone) CriOS/130.0 Mobile/15E Safari/604.1",
      "Chrome",
      "iOS",
      "mobile",
    ],
    [
      "Mozilla/5.0 (iPhone) FxiOS/130.0 Mobile/15E Safari/604.1",
      "Firefox",
      "iOS",
      "mobile",
    ],
    [
      "Mozilla/5.0 (iPhone) EdgiOS/130.0 Mobile/15E Safari/604.1",
      "Edge",
      "iOS",
      "mobile",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Safari/537.36 EdgA/130.0",
      "Edge",
      "Android",
      "mobile",
    ],
    [
      "private-agent-<script>secret-ip-192.0.2.8</script>",
      "알 수 없는 브라우저",
      "알 수 없는 기기",
      "desktop",
    ],
    ["Safari/604.1", "알 수 없는 브라우저", "알 수 없는 기기", "desktop"],
    [null, "알 수 없는 브라우저", "알 수 없는 기기", "desktop"],
    [undefined, "알 수 없는 브라우저", "알 수 없는 기기", "desktop"],
  ] as const)("maps %s to fixed labels only", (input, browser, os, device) => {
    expect(parseUserAgent(input)).toEqual({ browser, os, device });
  });
  it("bounds an untrusted header and never echoes it", () => {
    expect(parseUserAgent("x".repeat(4100) + "Chrome/130 Android")).toEqual({
      browser: "알 수 없는 브라우저",
      os: "알 수 없는 기기",
      device: "desktop",
    });
  });
});
