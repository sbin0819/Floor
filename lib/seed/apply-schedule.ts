import {
  buildBookingNotifications,
  buildBranchAnnouncementNotifications,
  buildReminderNotifications,
  notificationBookingSnapshot,
  type NotificationWrite,
} from "@/features/notifications/builders";
import {
  systemMessageText,
  type SystemMessageData,
} from "@/features/chat/system-messages";
import type { DalDatabase } from "@/lib/dal";
import {
  clearSeedSchedule,
  findSeedNoticeRooms,
  insertSeedAnnouncements,
  insertSeedBlocks,
  insertSeedBookings,
  insertSeedMeetingRooms,
  insertSeedNotifications,
  insertSeedParticipants,
  listForeignConfirmedBookings,
  readSeedUserNames,
  type SeedAnnouncementInput,
  type SeedMeetingRoomInput,
} from "@/lib/dal/seed-schedule";
import type { SeedData } from "./data";
import { SeedError } from "./errors";
import type { ExpandedBooking, ExpandedSchedule } from "./schedule";

export type ScheduleCounts = {
  bookings: number;
  skippedBookings: number;
  spaceBlocks: number;
  meetingRooms: number;
  chatMessages: number;
  announcements: number;
  notifications: number;
};

const HOUR = 60 * 60_000;
const READ_AFTER_DAYS = 3;

type Range = { start: number; end: number };
const overlaps = (a: Range, b: Range) => a.start < b.end && b.start < a.end;
const rangeOf = (during: { start: Date; end: Date }): Range => ({
  start: during.start.getTime(),
  end: during.end.getTime(),
});

/**
 * 펼친 일정을 DB에 넣는다. 자기 id의 행을 먼저 지우고, 시드 밖의 확정 예약과 겹치는 자리는 건너뛴다.
 * 회의 채널·참석자·미리 알림·취소 알림·공지까지 같은 트랜잭션에서 묶어 넣는다.
 */
export async function applySeedSchedule(
  {
    schedule,
    data,
    userIds,
    now,
    loungeMemberKeys,
  }: {
    schedule: ExpandedSchedule;
    data: SeedData;
    userIds: ReadonlyMap<string, string>;
    now: Date;
    /** 지점마다 라운지에 들어가 있는 시드 계정. 공지를 쓰는 운영자가 여기 있어야 한다. */
    loungeMemberKeys: ReadonlyMap<string, ReadonlySet<string>>;
  },
  database: DalDatabase,
): Promise<ScheduleCounts> {
  const userId = (key: string) => {
    const id = userIds.get(key);
    if (!id) throw new SeedError(`일정 시드가 참조하는 계정(${key})이 없어요.`);
    return id;
  };
  const spaces = new Map(data.spaces.map((row) => [row.id, row]));
  const floors = new Map(data.floors.map((row) => [row.id, row]));
  const branches = new Map(data.branches.map((row) => [row.id, row]));
  const snapshotOf = (booking: ExpandedBooking) => {
    const space = spaces.get(booking.spaceId);
    const floor = floors.get(booking.floorId);
    const branch = branches.get(booking.branchId);
    if (!space || !floor || !branch)
      throw new SeedError("일정 시드의 공간 위치를 찾을 수 없어요.");
    const area = space.parentId ? spaces.get(space.parentId) : undefined;
    return notificationBookingSnapshot({
      booking: { id: booking.id, during: booking.during, title: booking.title },
      space,
      floor,
      branch,
      areaName: booking.isDesk ? area?.name : undefined,
    });
  };

  await clearSeedSchedule(schedule, database);

  // 점검
  await insertSeedBlocks(
    schedule.blocks.map((block) => ({
      id: block.id,
      spaceId: block.spaceId,
      during: block.during,
      reason: block.reason,
      createdBy: userId(block.createdByKey),
      createdAt: block.createdAt,
    })),
    database,
  );

  // 시드 밖의 확정 예약과 겹치는 자리는 넣지 않는다 (겹침 제약은 DB가 최종 방어선이다).
  const seedUserIds = [...userIds.values()];
  const foreign = schedule.bookings.length
    ? await listForeignConfirmedBookings(
        {
          spaceIds: [
            ...new Set(schedule.bookings.map(({ spaceId }) => spaceId)),
          ],
          userIds: seedUserIds,
          window: {
            start: new Date(
              Math.min(
                ...schedule.bookings.map((row) => row.during.start.getTime()),
              ),
            ),
            end: new Date(
              Math.max(
                ...schedule.bookings.map((row) => row.during.end.getTime()),
              ),
            ),
          },
        },
        database,
      )
    : [];
  const foreignBySpace = new Map<string, Range[]>();
  const foreignDeskByUser = new Map<string, Range[]>();
  for (const row of foreign) {
    const range = rangeOf(row.during);
    foreignBySpace.set(row.spaceId, [
      ...(foreignBySpace.get(row.spaceId) ?? []),
      range,
    ]);
    if (row.isDesk)
      foreignDeskByUser.set(row.userId, [
        ...(foreignDeskByUser.get(row.userId) ?? []),
        range,
      ]);
  }
  let skippedBookings = 0;
  const accepted = schedule.bookings.filter((booking) => {
    if (booking.status !== "confirmed") return true;
    const range = rangeOf(booking.during);
    const conflict =
      (foreignBySpace.get(booking.spaceId) ?? []).some((other) =>
        overlaps(other, range),
      ) ||
      (booking.isDesk &&
        (foreignDeskByUser.get(userId(booking.userKey)) ?? []).some((other) =>
          overlaps(other, range),
        ));
    if (conflict) skippedBookings += 1;
    return !conflict;
  });

  const names = await readSeedUserNames(seedUserIds, database);
  const nameOf = (key: string) => {
    const name = names.get(userId(key));
    if (!name)
      throw new SeedError(`일정 시드의 계정(${key})이 준비되지 않았어요.`);
    return name;
  };

  await insertSeedBookings(
    accepted.map((booking) => ({
      id: booking.id,
      spaceId: booking.spaceId,
      userId: userId(booking.userKey),
      teamId: booking.teamId,
      during: booking.during,
      title: booking.title,
      attendeeCount: booking.attendeeCount,
      status: booking.status,
      cancelledAt: booking.cancelledAt,
      cancelledBy: booking.cancelledByKey
        ? userId(booking.cancelledByKey)
        : null,
      cancelKind: booking.cancelKind,
      cancelReason: booking.cancelReason,
      createdAt: booking.createdAt,
    })),
    database,
  );
  await insertSeedParticipants(
    accepted.flatMap((booking) =>
      booking.participantKeys.map((key) => ({
        bookingId: booking.id,
        userId: userId(key),
        createdAt: booking.createdAt,
      })),
    ),
    database,
  );

  // 회의 채널: 만든 시스템 메시지, 대화, 취소 시스템 메시지를 시각순으로 번호를 매긴다.
  const rooms: SeedMeetingRoomInput[] = accepted
    .filter((booking) => !booking.isDesk)
    .map((booking) => {
      const created: SystemMessageData = {
        type: "booking_created",
        actorName: nameOf(booking.userKey),
      };
      const entries: SeedMeetingRoomInput["messages"] = [
        {
          authorId: null,
          kind: "system",
          body: systemMessageText(created),
          systemData: created,
          createdAt: booking.createdAt,
        },
        ...booking.messages.map((message) => ({
          authorId: userId(message.authorKey),
          kind: "text" as const,
          body: message.body,
          systemData: null,
          createdAt: message.at,
        })),
      ];
      const readers: SeedMeetingRoomInput["readers"] = [
        { userId: userId(booking.userKey), seq: 1, at: booking.createdAt },
      ];
      if (
        booking.status === "cancelled" &&
        booking.cancelledAt &&
        booking.cancelledByKey
      ) {
        const cancelled: SystemMessageData = {
          type: "booking_cancelled",
          actorName: nameOf(booking.cancelledByKey),
          ...(booking.cancelKind && booking.cancelReason
            ? { cancelKind: booking.cancelKind, reason: booking.cancelReason }
            : {}),
        };
        entries.push({
          authorId: null,
          kind: "system",
          body: systemMessageText(cancelled),
          systemData: cancelled,
          createdAt: booking.cancelledAt,
        });
        entries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        readers.push({
          userId: userId(booking.cancelledByKey),
          seq: entries.length,
          at: booking.cancelledAt,
        });
      }
      return {
        bookingId: booking.id,
        createdAt: booking.createdAt,
        messages: entries,
        readers,
      };
    });
  const meeting = await insertSeedMeetingRooms(rooms, database);

  // 알림: 참석자 초대, 취소, 미리 알림. 3일보다 오래된 것은 읽은 것으로 넣는다.
  const readAt = (scheduledFor: Date) =>
    now.getTime() - scheduledFor.getTime() > READ_AFTER_DAYS * 24 * HOUR
      ? new Date(scheduledFor.getTime() + 2 * HOUR)
      : null;
  const notificationRows: (NotificationWrite & { readAt: Date | null })[] = [];
  const addNotifications = (rows: NotificationWrite[]) => {
    for (const row of rows)
      notificationRows.push({ ...row, readAt: readAt(row.scheduledFor) });
  };
  for (const booking of accepted) {
    if (booking.isDesk && booking.status === "confirmed") continue;
    const snapshot = snapshotOf(booking);
    const owner = {
      id: userId(booking.userKey),
      name: nameOf(booking.userKey),
    };
    const participants = booking.participantKeys.map(userId);
    if (participants.length)
      addNotifications(
        buildBookingNotifications({
          type: "booking_invited",
          booking: snapshot,
          actor: owner,
          userIds: participants,
          now: booking.createdAt,
        }),
      );
    if (
      booking.status === "cancelled" &&
      booking.cancelledAt &&
      booking.cancelledByKey
    ) {
      addNotifications(
        buildBookingNotifications({
          type: "booking_cancelled",
          booking: snapshot,
          actor: {
            id: userId(booking.cancelledByKey),
            name: nameOf(booking.cancelledByKey),
          },
          userIds: [owner.id, ...participants],
          now: booking.cancelledAt,
          ...(booking.cancelKind && booking.cancelReason
            ? {
                cancellation: {
                  kind: booking.cancelKind,
                  reason: booking.cancelReason,
                },
              }
            : {}),
        }),
      );
      continue;
    }
    addNotifications(
      buildReminderNotifications(snapshot, [owner.id, ...participants], now),
    );
  }

  // 공지: 라운지 # 공지 채널에 글을 쓰고, 받는 사람에게 알림을 남긴다.
  const noticeRooms = await findSeedNoticeRooms(
    [...new Set(schedule.announcements.map(({ branchId }) => branchId))],
    database,
  );
  const announcementInputs: SeedAnnouncementInput[] = [];
  for (const announcement of [...schedule.announcements].sort(
    (a, b) => a.at.getTime() - b.at.getTime(),
  )) {
    const branch = branches.get(announcement.branchId);
    const room = noticeRooms.get(announcement.branchId);
    if (!branch || !room)
      throw new SeedError("공지 시드의 지점 라운지 # 공지 채널이 없어요.");
    if (
      !loungeMemberKeys.get(announcement.branchId)?.has(announcement.authorKey)
    )
      throw new SeedError(
        `공지를 쓰는 운영자(${announcement.authorKey})가 ${branch.name} 라운지 멤버가 아니에요.`,
      );
    const seq = room.nextSeq;
    room.nextSeq += 1;
    const recipients = announcement.recipientKeys.map(userId);
    announcementInputs.push({
      id: announcement.id,
      branchId: announcement.branchId,
      authorId: userId(announcement.authorKey),
      title: announcement.title,
      body: announcement.body,
      audience: announcement.audience,
      recipientCount: recipients.length,
      at: announcement.at,
      lounge: { roomId: room.roomId, seq },
    });
    addNotifications(
      buildBranchAnnouncementNotifications({
        branchName: branch.name,
        title: announcement.title,
        body: announcement.body,
        announcementId: announcement.id,
        actorId: userId(announcement.authorKey),
        userIds: recipients,
        now: announcement.at,
      }),
    );
  }
  const announced = await insertSeedAnnouncements(announcementInputs, database);
  await insertSeedNotifications(notificationRows, database);

  return {
    bookings: accepted.length,
    skippedBookings,
    spaceBlocks: schedule.blocks.length,
    meetingRooms: meeting.meetingRooms,
    chatMessages: meeting.chatMessages + announced.chatMessages,
    announcements: announced.announcements,
    notifications: notificationRows.length,
  };
}
