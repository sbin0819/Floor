import { z } from "zod";

export const userStatusSchema = z.enum(["online", "away", "dnd"]);
export type UserStatus = z.infer<typeof userStatusSchema>;
export const statusPresenceSchema = z.strictObject({
  status: userStatusSchema,
  auto: z.boolean(),
});
export type StatusPresence = z.infer<typeof statusPresenceSchema>;
export type PresenceStatus = UserStatus | "offline" | "unknown";
export const STATUS_IDLE_MS = 10 * 60_000;

export function effectiveStatus(
  selected: UserStatus,
  lastActivityAt: number,
  hiddenSince: number | null,
  now: number,
): StatusPresence {
  if (selected !== "online") return { status: selected, auto: false };
  const inactive = now - lastActivityAt >= STATUS_IDLE_MS;
  const hidden = hiddenSince !== null && now - hiddenSince >= STATUS_IDLE_MS;
  return inactive || hidden
    ? { status: "away", auto: true }
    : { status: "online", auto: false };
}

export function aggregatePresence(
  values: readonly unknown[],
  sharesSpace: boolean,
  complete: boolean,
): PresenceStatus {
  if (!sharesSpace) return "unknown";
  const valid = values.flatMap((value) => {
    const parsed = statusPresenceSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
  if (valid.some(({ status }) => status === "dnd")) return "dnd";
  if (valid.some(({ status, auto }) => status === "away" && !auto))
    return "away";
  if (valid.some(({ status }) => status === "online")) return "online";
  if (valid.some(({ status }) => status === "away")) return "away";
  return complete ? "offline" : "unknown";
}

export function statusLabel(status: PresenceStatus) {
  return {
    online: "온라인",
    away: "자리 비움",
    dnd: "방해 금지",
    offline: "오프라인",
    unknown: "",
  }[status];
}

export function presenceSortGroup(status: PresenceStatus) {
  return status === "unknown" ? 2 : status === "offline" ? 1 : 0;
}
