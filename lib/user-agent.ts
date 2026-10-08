export type SessionDevice = {
  browser: string;
  os: string;
  device: "mobile" | "desktop";
};

export function parseUserAgent(
  value: string | null | undefined,
): SessionDevice {
  // 헤더 원문을 돌려주지 않고 고정된 이름만 고른다.
  const ua = (value ?? "").slice(0, 4096);
  const browser = /SamsungBrowser\//i.test(ua)
    ? "Samsung Internet"
    : /(?:Edg|EdgA|EdgiOS)\//i.test(ua)
      ? "Edge"
      : /(?:Firefox|FxiOS)\//i.test(ua)
        ? "Firefox"
        : /(?:Chrome|CriOS)\//i.test(ua)
          ? "Chrome"
          : /Version\/[^\s]+.*Safari\//i.test(ua)
            ? "Safari"
            : "알 수 없는 브라우저";
  const os = /iPad|Macintosh.*Mobile\//i.test(ua)
    ? "iPadOS"
    : /iPhone|iPod/i.test(ua)
      ? "iOS"
      : /Android/i.test(ua)
        ? "Android"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/i.test(ua)
            ? "macOS"
            : /Linux/i.test(ua)
              ? "Linux"
              : "알 수 없는 기기";
  return {
    browser,
    os,
    device:
      os === "iPadOS" ||
      os === "iOS" ||
      os === "Android" ||
      /Mobile|Tablet/i.test(ua)
        ? "mobile"
        : "desktop",
  };
}
