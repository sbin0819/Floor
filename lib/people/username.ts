const reserved = new Set([
  "everyone",
  "here",
  "admin",
  "floor",
  "system",
  "support",
  "operator",
]);
export const USERNAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export function parseUsername(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{3,20}$/.test(value) && !reserved.has(value)
    ? value
    : null;
}

export function usernameSuggestionBase(email: string): string {
  const base = email
    .split("@")[0]!
    .split("+")[0]!
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, "")
    .slice(0, 20);
  return base.length >= 3 && !reserved.has(base) ? base : "user";
}

export function usernameCandidates(base: string): string[] {
  return Array.from({ length: 999 }, (_, index) => {
    if (index === 0) return base;
    const suffix = String(index + 1);
    return base.slice(0, 20 - suffix.length) + suffix;
  });
}

export function pickUsername(
  candidates: readonly string[],
  taken: ReadonlySet<string>,
): string | null {
  return candidates.find((candidate) => !taken.has(candidate)) ?? null;
}
