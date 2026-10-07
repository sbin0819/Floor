const invalidCharacter = /[\\\u0000-\u001f\u007f]/;

export function safeNext(
  value: unknown,
  baseUrl = "http://localhost:3000",
): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    invalidCharacter.test(value)
  )
    return "/";
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || invalidCharacter.test(decoded)) return "/";
    const base = new URL(baseUrl);
    const target = new URL(value, base);
    const decodedTarget = new URL(decoded, base);
    if (target.origin !== base.origin || decodedTarget.origin !== base.origin)
      return "/";
    for (const path of [target.pathname, decodedTarget.pathname]) {
      if (path.startsWith("//") || path === "/api" || path.startsWith("/api/"))
        return "/";
    }
    // 로그인 화면을 목적지로 삼으면 이미 로그인한 사용자에게 순환 이동이 생겨요.
    if (
      ["/login", "/signup", "/admin/login"].includes(
        target.pathname.replace(/\/$/, ""),
      )
    )
      return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}
