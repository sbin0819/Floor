import type { ActionDependencies } from "@/lib/actions/create-action";
import type { DalDatabase, TransactionDatabase } from "@/lib/dal";
import { floorChannel } from "@/lib/realtime/channels";
import { noopRealtime } from "@/lib/realtime/noop";
import type { RealtimePublisher } from "@/lib/realtime/types";

export type BookingDependencies = Partial<ActionDependencies> & {
  database?: DalDatabase & TransactionDatabase;
  now?: () => Date;
  publisher?: Pick<RealtimePublisher, "publish">;
};

export function bookingActionDependencies(
  dependencies: BookingDependencies,
): Partial<ActionDependencies> {
  return {
    ...(dependencies.getSession ? { getSession: dependencies.getSession } : {}),
    ...(dependencies.logError ? { logError: dependencies.logError } : {}),
  };
}

export async function publishBookingChange(
  floorId: string,
  spaceId: string,
  dependencies: BookingDependencies,
) {
  try {
    await (dependencies.publisher ?? noopRealtime).publish(
      floorChannel(floorId),
      { type: "booking.changed", spaceId },
    );
  } catch {
    (dependencies.logError ?? console.error)(
      "Booking realtime publication failed.",
    );
  }
}
