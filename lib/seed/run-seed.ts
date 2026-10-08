import { ZodError } from "zod";
import { getPostgresError } from "@/lib/actions/errors";
import {
  createProvisioningAuth,
  getAuth,
  type AuthInstance,
} from "@/lib/auth/auth";
import {
  getUserByEmail,
  withTransaction,
  type TransactionDatabase,
} from "@/lib/dal";
import * as seedDal from "@/lib/dal/seed";
import { syncSeedChat } from "@/lib/dal/seed-chat";
import { syncSeedPeople } from "@/lib/dal/seed-people";
import { syncSeedPeople2 } from "@/lib/dal/seed-people-2";
import { insertSeedMeeting } from "@/lib/dal/seed-meeting";
import {
  syncSeedBranchCovers,
  syncSeedSpacePhotos,
} from "@/lib/dal/seed-photos";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedBookings2 } from "@/lib/seed/bookings-2";
import { loadSeedChat } from "@/lib/seed/chat";
import { loadSeedPeople } from "@/lib/seed/people";
import { loadSeedPeople2 } from "@/lib/seed/people-2";
import { loadSeedMeeting, seedMeetingCreatedAt } from "@/lib/seed/meeting";
import { insertSeedDeskSchedule } from "@/lib/seed/desk-schedule";
import { insertSeedParticipants } from "@/lib/seed/participants";
import { insertSeedReminders } from "@/lib/seed/reminders";
import { SeedError } from "@/lib/seed/errors";
import { loadSeedPhotos } from "@/lib/seed/photos";
import { getOperatingDate } from "@/lib/time/open-hours";
import { zonedDateTime } from "@/lib/time/zoned";
import { addSeedBranches } from "@/lib/seed/add-branches";
import { selectSeedBranches, validateSeedBranchIds } from "@/lib/seed/scope";
import {
  applyBookingRound2,
  validateBookingRound2Options,
  type BookingRound2Options,
} from "@/lib/seed/booking-round2";
import type { BookingRound2Receipt } from "@/lib/seed/booking-round2-receipt";

export type SeedResult = {
  counts: Record<string, number>;
  skippedBookings: number;
  skippedMeetingMessages?: number;
  accounts: string[];
  branchScope?: { addedBranchIds: string[]; skippedBranchIds: string[] };
  bookingRound2?: { applied: boolean; receipt: BookingRound2Receipt };
};

export async function runSeed({
  db,
  auth,
  now,
  resetPasswords,
  branchIds,
  bookingRound2,
}: {
  db?: TransactionDatabase;
  auth?: AuthInstance;
  now: Date;
  resetPasswords: boolean;
  branchIds?: readonly string[];
  bookingRound2?: BookingRound2Options;
}): Promise<SeedResult> {
  if (!Number.isFinite(now.getTime()))
    throw new SeedError("시드 기준 시각이 올바르지 않아요.");
  if (bookingRound2 !== undefined) {
    if (branchIds !== undefined || resetPasswords)
      throw new SeedError(
        "예약 2차 전용 모드는 지점 선택·비밀번호 재설정과 함께 쓸 수 없어요.",
      );
    validateBookingRound2Options(bookingRound2);
  }
  let current = "시드 데이터";
  try {
    const data = loadSeedData();
    const photos = loadSeedPhotos(data);
    const bookingExtras = loadSeedBookings2(data);
    const chat = loadSeedChat(data);
    const people = loadSeedPeople(data);
    const people2 = loadSeedPeople2(data, people);
    const meeting = loadSeedMeeting(data, bookingExtras);
    const meetingPlans = new Map(
      data.bookings.map(({ id }) => {
        const messages = meeting.messages.filter(
          ({ bookingId }) => bookingId === id,
        );
        return [
          id,
          { messages, createdAt: seedMeetingCreatedAt(messages, now) },
        ];
      }),
    );
    if (bookingRound2 !== undefined) {
      current = "예약 2차 추가 데이터";
      return await withTransaction(
        (database) =>
          applyBookingRound2(
            {
              ...bookingRound2,
              data,
              extras: bookingExtras,
              now,
            },
            database,
          ),
        db,
      );
    }
    const attendeeCounts = new Map(
      bookingExtras.attendeeCounts.map(({ bookingId, attendeeCount }) => [
        bookingId,
        attendeeCount,
      ]),
    );
    if (branchIds !== undefined) {
      const ids = validateSeedBranchIds(branchIds, data, resetPasswords);
      const scope = selectSeedBranches(data, photos, ids, bookingExtras);
      return await withTransaction(
        (database) =>
          addSeedBranches(scope, database, now, bookingExtras, meeting),
        db,
      );
    }
    const instance = auth ?? getAuth();
    return await withTransaction(async (database) => {
      const provisioning = await createProvisioningAuth({
        db: database,
        auth: instance,
      });
      const userIds = new Map<string, string>();
      for (const account of data.users) {
        current = `계정 ${account.email}`;
        const existing = await getUserByEmail(account.email, database);
        if (existing && !existing.emailVerified && !resetPasswords)
          throw new SeedError(
            `${current}: 인증되지 않은 기존 계정이에요. 명시적인 --reset-passwords가 필요해요.`,
          );
        const user =
          existing ?? (await provisioning.createVerifiedUser(account));
        userIds.set(account.key, user.id);
        if (!existing || resetPasswords) {
          await provisioning.setPassword(
            user.id,
            await provisioning.hashPassword(account.password),
          );
          if (existing) {
            await provisioning.revokeSessions(user.id);
            await provisioning.verifyEmail(user.id);
          }
        }
      }
      const userId = (key: string) => {
        const id = userIds.get(key);
        if (!id) throw new SeedError("시드 계정 참조를 찾을 수 없어요.");
        return id;
      };
      for (const branch of data.branches) {
        current = `지점 ${branch.id}`;
        await seedDal.upsertSeedBranch(branch, database);
      }
      for (const floor of data.floors) {
        current = `층 ${floor.id}`;
        await seedDal.upsertSeedFloor(floor, database);
      }
      for (const space of [...data.spaces].sort(
        (a, b) => Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)),
      )) {
        current = `공간 ${space.id}`;
        await seedDal.upsertSeedSpace(
          { ...space, archivedAt: null, bookingRules: {} },
          database,
        );
      }
      for (const { createdByKey, ...team } of data.teams) {
        current = `팀 ${team.id}`;
        await seedDal.upsertSeedTeam(
          { ...team, createdBy: userId(createdByKey) },
          database,
        );
      }
      current = "공간과 지점 사진";
      await syncSeedSpacePhotos(
        data.spaces.map(({ id }) => id),
        photos.spacePhotos,
        database,
      );
      await syncSeedBranchCovers(
        data.branches.map(({ id }) => id),
        photos.branchCovers,
        database,
      );
      for (const { userKey, ...member } of data.teamMembers)
        await seedDal.upsertSeedMember(
          { ...member, userId: userId(userKey) },
          database,
        );
      current = "팀 채팅";
      const chatCounts = await syncSeedChat(
        data.teams.map(({ id }) => id),
        chat,
        userIds,
        now,
        database,
      );
      current = "사람과 DM";
      const peopleCounts = await syncSeedPeople(people, userIds, now, database);
      current = "그룹과 메시지 요청";
      const people2Counts = await syncSeedPeople2(
        people2,
        userIds,
        now,
        database,
      );
      for (const { userKey, ...staff } of data.branchStaff)
        await seedDal.upsertSeedStaff(
          { ...staff, userId: userId(userKey) },
          database,
        );
      current = "허용 팀";
      await seedDal.replaceSeedGrants(
        data.floors.map(({ id }) => id),
        data.spaces.map(({ id }) => id),
        data.accessGrants,
        database,
      );
      let plans = 0;
      for (const { createdByKey, ...plan } of data.floorPlans) {
        current = `평면도 ${plan.id}`;
        if (
          await seedDal.putSeedPlan(
            { ...plan, createdBy: userId(createdByKey), publishedAt: now },
            database,
          )
        )
          plans++;
      }
      const branches = new Map(
        data.branches.map((branch) => [branch.id, branch]),
      );
      const floors = new Map(data.floors.map((floor) => [floor.id, floor]));
      const spaces = new Map(data.spaces.map((space) => [space.id, space]));
      const instant = (spaceId: string, offset: number, time: string) => {
        const branch = branches.get(
          floors.get(spaces.get(spaceId)!.floorId)!.branchId,
        )!;
        return zonedDateTime(
          getOperatingDate(now, branch.timezone, branch.openHours, offset),
          time,
          branch.timezone,
        );
      };
      await seedDal.clearSeedSchedule(
        [...data.bookings, ...bookingExtras.deskBookings].map(({ id }) => id),
        [...data.spaceBlocks, ...bookingExtras.deskBlocks].map(({ id }) => id),
        database,
      );
      for (const {
        startDayOffset,
        endDayOffset,
        start,
        end,
        createdByKey,
        ...block
      } of data.spaceBlocks) {
        current = `점검 ${block.id}`;
        await seedDal.insertSeedBlock(
          {
            ...block,
            createdBy: userId(createdByKey),
            during: {
              start: instant(block.spaceId, startDayOffset, start),
              end: instant(block.spaceId, endDayOffset, end),
            },
          },
          database,
        );
      }
      let skippedBookings = 0;
      let skippedMeetingMessages = 0;
      let meetingMessages = 0;
      for (const {
        dayOffset,
        start,
        end,
        userKey,
        cancelledByKey,
        ...booking
      } of data.bookings) {
        current = `예약 ${booking.id}`;
        const meetingPlan = meetingPlans.get(booking.id)!;
        const during = {
          start: instant(booking.spaceId, dayOffset, start),
          end: instant(booking.spaceId, dayOffset, end),
        };
        if (
          booking.status === "confirmed" &&
          (await seedDal.hasSeedBookingOverlap(
            booking.spaceId,
            during,
            database,
          ))
        ) {
          skippedBookings++;
          skippedMeetingMessages += meetingPlan.messages.length;
          continue;
        }
        await seedDal.insertSeedBooking(
          {
            ...booking,
            createdAt: meetingPlan.createdAt,
            attendeeCount: attendeeCounts.get(booking.id) ?? null,
            userId: userId(userKey),
            during,
            cancelledAt: booking.status === "cancelled" ? now : null,
            cancelledBy:
              booking.status === "cancelled" && cancelledByKey
                ? userId(cancelledByKey)
                : null,
          },
          database,
        );
        await insertSeedParticipants(
          booking.id,
          bookingExtras,
          userIds,
          meetingPlan.createdAt,
          database,
        );
        const meetingResult = await insertSeedMeeting(
          {
            bookingId: booking.id,
            bookerId: userId(userKey),
            ...meetingPlan,
            userIds,
            now,
          },
          database,
        );
        meetingMessages += meetingResult.chatMessages;
        await insertSeedReminders({
          booking: { ...booking, during, userId: userId(userKey) },
          data,
          extras: bookingExtras,
          userIds,
          now,
          database,
        });
      }
      const deskResult = await insertSeedDeskSchedule({
        data,
        extras: bookingExtras,
        userIds,
        now,
        database,
      });
      const timeBookings = data.bookings.length - skippedBookings;
      skippedBookings += deskResult.skippedBookings;
      return {
        counts: {
          ...chatCounts,
          ...peopleCounts,
          groupRooms: people2Counts.groupRooms,
          directRooms: peopleCounts.directRooms + people2Counts.directRooms,
          chatMessages:
            chatCounts.chatMessages +
            peopleCounts.chatMessages +
            people2Counts.chatMessages +
            meetingMessages,
          meetingRooms: timeBookings,
          users: data.users.length,
          branches: data.branches.length,
          floors: data.floors.length,
          spaces: data.spaces.length,
          teams: data.teams.length,
          teamMembers: data.teamMembers.length,
          branchStaff: data.branchStaff.length,
          accessGrants: data.accessGrants.length,
          floorPlans: plans,
          bookings: timeBookings + deskResult.bookings,
          spaceBlocks: data.spaceBlocks.length + deskResult.spaceBlocks,
          spacePhotos: photos.spacePhotos.length,
          branchCovers: photos.branchCovers.length,
        },
        skippedBookings,
        skippedMeetingMessages,
        accounts: data.users.map(({ email }) => email),
      };
    }, db);
  } catch (error) {
    if (error instanceof SeedError) throw error;
    if (error instanceof ZodError)
      throw new SeedError(
        `시드 데이터 검증 실패: ${error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
      );
    if (getPostgresError(error)?.code === "23505")
      throw new SeedError(
        `${current}: 다른 행이 같은 고유 값을 사용하고 있어요. 시드를 되돌렸어요.`,
      );
    throw new SeedError(
      `${current}: 시드를 완료하지 못했어요. 모든 시드 변경을 되돌렸어요.`,
    );
  }
}
