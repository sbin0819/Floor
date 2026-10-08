export function isSameOrigin(
  request: Pick<Request, "url" | "headers">,
): boolean {
  const origin = request.headers.get("Origin");
  if (!origin || origin === "null") return false;
  try {
    const target = new URL(request.url);
    return (
      (target.protocol === "https:" || target.protocol === "http:") &&
      origin === target.origin
    );
  } catch {
    return false;
  }
}
