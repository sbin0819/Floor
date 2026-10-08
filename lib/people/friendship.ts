import type { PersonRelation } from "@/features/people/types";

export const FRIEND_DAY_MS = 24 * 60 * 60 * 1000;
export const FRIEND_DECLINE_MS = 30 * FRIEND_DAY_MS;

export type FriendshipState = {
  status: "pending" | "accepted" | "declined" | "cancelled";
  requestedBy: string;
  statusChangedAt: Date;
};

export function relationOf(
  row: FriendshipState | null,
  me: string,
  now: Date,
  blocks?: { byMe: boolean; byThem: boolean },
): PersonRelation {
  if (blocks?.byMe) return "blocked";
  if (blocks?.byThem) return "none";
  if (!row) return "none";
  if (row.status === "accepted") return "friend";
  if (row.status === "pending")
    return row.requestedBy === me ? "outgoing" : "incoming";
  if (
    row.status === "declined" &&
    row.requestedBy === me &&
    row.statusChangedAt.getTime() > now.getTime() - FRIEND_DECLINE_MS
  )
    return "outgoing";
  return "none";
}
