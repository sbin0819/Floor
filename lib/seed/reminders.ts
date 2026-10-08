import {
  buildReminderNotifications,
  notificationBookingSnapshot,
} from "@/features/notifications/builders";
import type { DalDatabase } from "@/lib/dal";
import { insertNotifications } from "@/lib/dal/notifications";
import type { SeedBookings2Data } from "./bookings-2";
import type { SeedData } from "./data";
import { SeedError } from "./errors";

export async function insertSeedReminders({
  booking,
  data,
  extras,
  userIds,
  now,
  database,
}: {
  booking: {
    id: string;
    spaceId: string;
    userId: string;
    during: { start: Date; end: Date };
    title: string | null;
    status: "confirmed" | "cancelled";
  };
  data: SeedData;
  extras?: SeedBookings2Data;
  userIds: ReadonlyMap<string, string>;
  now: Date;
  database: DalDatabase;
}) {
  if (booking.status !== "confirmed") return;
  const space = data.spaces.find(({ id }) => id === booking.spaceId);
  if (!space || space.type === "desk") return;
  const floor = data.floors.find(({ id }) => id === space.floorId);
  const branch = data.branches.find(({ id }) => id === floor?.branchId);
  if (!floor || !branch)
    throw new SeedError("미리 알림 시드의 공간 위치를 찾을 수 없어요.");
  const participants =
    extras?.participants.find(({ bookingId }) => bookingId === booking.id)
      ?.userKeys ?? [];
  const recipients = participants.map((key) => {
    const id = userIds.get(key);
    if (!id) throw new SeedError("미리 알림 시드의 참석자를 찾을 수 없어요.");
    return id;
  });
  await insertNotifications(
    buildReminderNotifications(
      notificationBookingSnapshot({ booking, space, floor, branch }),
      [booking.userId, ...recipients],
      now,
    ),
    database,
  );
}
