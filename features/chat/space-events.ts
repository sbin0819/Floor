import { spaceChannel, userChannel } from "@/lib/realtime/channels";
import { getRealtimePublisher } from "@/lib/realtime/server";
import type { RealtimeItem } from "@/lib/realtime/types";
import type { ChatActionDependencies } from "./action-factory";

export const spaceChanged = (spaceId: string): RealtimeItem => ({
  channel: spaceChannel(spaceId),
  event: { type: "space.changed", spaceId },
});
export const reauthorize = (userId: string): RealtimeItem => ({
  channel: userChannel(userId),
  event: { type: "realtime.reauth" },
});
export async function publishSpaceEvents(
  events: readonly RealtimeItem[],
  dependencies: ChatActionDependencies,
) {
  if (!events.length) return;
  try {
    await (dependencies.publisher ?? getRealtimePublisher()).publishMany(
      events,
    );
  } catch {
    (dependencies.logError ?? console.error)(
      "Space realtime publication failed.",
    );
  }
}
