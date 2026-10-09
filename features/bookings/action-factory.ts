import type { ActionDependencies } from "@/lib/actions/create-action";
import type { LiveKitServer } from "@/lib/calls/types";
import { evictCalls } from "@/lib/calls/evict";
import type { DalDatabase, TransactionDatabase } from "@/lib/dal";
import { floorChannel } from "@/lib/realtime/channels";
import { getRealtimePublisher } from "@/lib/realtime/server";
import type { RealtimeItem, RealtimePublisher } from "@/lib/realtime/types";

export type BookingDependencies = Partial<ActionDependencies> & {
  livekit?: LiveKitServer | null;
  database?: DalDatabase & TransactionDatabase;
  now?: () => Date;
  publisher?: Pick<RealtimePublisher, "publish">;
  chatPublisher?: RealtimePublisher;
};

export function evictBookingCalls(
  userIds: readonly string[],
  dependencies: BookingDependencies,
) {
  return Promise.all(
    [...new Set(userIds)].map((userId) =>
      evictCalls(userId, {
        ...dependencies,
        publisher: dependencies.chatPublisher,
      }),
    ),
  );
}

export function bookingActionDependencies(
  dependencies: BookingDependencies,
): Partial<ActionDependencies> {
  return {
    ...(dependencies.getSession ? { getSession: dependencies.getSession } : {}),
    ...(dependencies.logError ? { logError: dependencies.logError } : {}),
  };
}

export async function publishBookingChatEvents(
  events: readonly RealtimeItem[],
  dependencies: BookingDependencies,
) {
  if (!events.length) return;
  try {
    await (dependencies.chatPublisher ?? getRealtimePublisher()).publishMany(
      events,
    );
  } catch {
    (dependencies.logError ?? console.error)(
      "Booking chat publication failed.",
    );
  }
}

export async function publishBookingChange(
  floorId: string,
  spaceId: string,
  dependencies: BookingDependencies,
) {
  try {
    await (dependencies.publisher ?? getRealtimePublisher()).publish(
      floorChannel(floorId),
      { type: "booking.changed", spaceId },
    );
  } catch {
    (dependencies.logError ?? console.error)(
      "Booking realtime publication failed.",
    );
  }
}
