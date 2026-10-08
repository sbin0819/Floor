import type { BookingCancellationEffects } from "@/features/bookings/cancel-booking-core";
import { publishBookingChange } from "@/features/bookings/action-factory";
import { publishAdminSpaceChange } from "@/features/admin/action-factory";
import { evictCalls } from "@/lib/calls/evict";
import type { LiveKitServer } from "@/lib/calls/types";
import { spaceChannel, userChannel } from "@/lib/realtime/channels";
import type { RealtimePublisher } from "@/lib/realtime/types";
import {
  publishTeamEvents,
  teamNotificationsChanged,
  type TeamManagementDependencies,
} from "./manage-support";

export type TeamRemovalDependencies = TeamManagementDependencies & {
  bookingPublisher?: Pick<RealtimePublisher, "publish">;
  livekit?: LiveKitServer | null;
  evict?: (userId: string) => Promise<void>;
};

export async function publishTeamRemovalEffects(
  input: {
    removedUserIds: readonly string[];
    spaceId: string | null;
    bookings: readonly BookingCancellationEffects[];
    notificationUserIds: readonly string[];
    adminSpaces?: readonly { floorId: string; spaceId: string }[];
  },
  dependencies: TeamRemovalDependencies,
) {
  const safe = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch {
      try {
        (dependencies.logError ?? console.error)(
          "Team post-commit effect failed.",
        );
      } catch {
        /* 이미 커밋한 변경은 로깅 실패에도 성공으로 남는다. */
      }
    }
  };
  const bookingPairs = [
    ...new Map(
      input.bookings.map((row) => [`${row.floorId}:${row.spaceId}`, row]),
    ).values(),
  ];
  const callUserIds = [
    ...new Set([
      ...input.removedUserIds,
      ...input.bookings.flatMap(({ callUserIds }) => callUserIds),
    ]),
  ];
  const realtimeGroups = [
    [...new Set(input.removedUserIds)].map((userId) => ({
      channel: userChannel(userId),
      event: { type: "realtime.reauth" as const },
    })),
    input.spaceId
      ? [
          {
            channel: spaceChannel(input.spaceId),
            event: { type: "space.changed" as const, spaceId: input.spaceId },
          },
        ]
      : [],
    input.bookings.flatMap(({ chatEvents }) => chatEvents),
    teamNotificationsChanged([
      ...input.notificationUserIds,
      ...input.bookings.flatMap(
        ({ notificationUserIds }) => notificationUserIds,
      ),
    ]),
  ];
  await Promise.all([
    ...realtimeGroups.map((events) =>
      safe(() => publishTeamEvents(events, dependencies)),
    ),
    ...callUserIds.map((userId) =>
      safe(() =>
        dependencies.evict
          ? dependencies.evict(userId)
          : evictCalls(userId, dependencies),
      ),
    ),
    ...bookingPairs.map(({ floorId, spaceId }) =>
      safe(() =>
        publishBookingChange(floorId, spaceId, {
          ...dependencies,
          publisher: dependencies.bookingPublisher ?? dependencies.publisher,
        }),
      ),
    ),
    ...(input.adminSpaces ?? []).map(({ floorId, spaceId }) =>
      safe(() =>
        publishAdminSpaceChange(floorId, spaceId, {
          ...dependencies,
          publisher: dependencies.bookingPublisher ?? dependencies.publisher,
        }),
      ),
    ),
  ]);
}
