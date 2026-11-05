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
import {
  insertSeedReports,
  syncSeedChatSpaces,
} from "@/lib/dal/seed-chat-spaces";
import { syncSeedPeople } from "@/lib/dal/seed-people";
import { syncSeedPeople2 } from "@/lib/dal/seed-people-2";
import {
  syncSeedBranchCovers,
  syncSeedSpacePhotos,
} from "@/lib/dal/seed-photos";
import { setSeedDefaultBranches } from "@/lib/dal/seed-schedule";
import { resetSeedDatabase } from "@/lib/dal/seed-reset";
import { loadSeedData } from "./data";
import { loadSeedChat } from "./chat";
import { loadSeedSpaces, type SeedSpacesData } from "./spaces";
import { loadSeedPeople } from "./people";
import { loadSeedPeople2 } from "./people-2";
import { loadSeedPhotos } from "./photos";
import { SeedError } from "./errors";
import { seedMigrations } from "./migrations";
import { loadSeedPlans } from "./seed-plans";
import { applyFloorPlansSeed } from "./floor-plans";
import {
  validateFloorPlansOptions,
  type FloorPlansOptions,
  type FloorPlansReceipt,
} from "./floor-plans-receipt";
import { addSeedBranches } from "./add-branches";
import { selectSeedBranches, validateSeedBranchIds } from "./scope";
import { expandSeedSchedule, loadSeedSchedule } from "./schedule";
import { applySeedSchedule } from "./apply-schedule";

export type SeedResult = {
  counts: Record<string, number>;
  skippedBookings: number;
  accounts: string[];
  branchScope?: { addedBranchIds: string[]; skippedBranchIds: string[] };
  floorPlans?: { applied: boolean; receipt: FloorPlansReceipt };
  reset?: { migrationCount: number; counts: Record<string, number> };
};

/** 지점마다 라운지에 들어가 있는 시드 계정. 공지를 쓰는 운영자가 여기 있어야 한다. */
export function loungeMembersByBranch(spaceChat: SeedSpacesData) {
  return new Map(
    spaceChat.loungeMembers.map((row) => [row.branchId, new Set(row.userKeys)]),
  );
}

export async function runSeed({
  db,
  auth,
  now,
  resetPasswords,
  branchIds,
  floorPlans,
  resetData = false,
}: {
  db?: TransactionDatabase;
  auth?: AuthInstance;
  now: Date;
  resetPasswords: boolean;
  branchIds?: readonly string[];
  floorPlans?: FloorPlansOptions;
  resetData?: boolean;
}): Promise<SeedResult> {
  if (!Number.isFinite(now.getTime()))
    throw new SeedError("시드 기준 시각이 올바르지 않아요.");
  if (floorPlans !== undefined) {
    if (branchIds !== undefined || resetPasswords || resetData)
      throw new SeedError(
        "평면도 전용 모드는 다른 범위·초기화·비밀번호 재설정과 함께 쓸 수 없어요.",
      );
    validateFloorPlansOptions(floorPlans);
  }
  if (resetData && (branchIds !== undefined || resetPasswords))
    throw new SeedError(
      "전체 초기화는 지점 추가·비밀번호 재설정과 함께 실행할 수 없어요.",
    );
  let current = "시드 데이터";
  try {
    const data = loadSeedData();
    // 지점 추가는 별도 평면도 manifest의 범위를 요구하지 않는다.
    const includePlans = floorPlans !== undefined || branchIds === undefined;
    const plans = includePlans
      ? [...data.floorPlans, ...loadSeedPlans(data)]
      : data.floorPlans;
    if (floorPlans !== undefined) {
      current = "평면도 추가 전용 데이터";
      return await withTransaction(
        (database) =>
          applyFloorPlansSeed({ ...floorPlans, data, plans, now }, database),
        db,
      );
    }
    const photos = loadSeedPhotos(data);
    const chat = loadSeedChat(data);
    const spaceChat = loadSeedSpaces(data);
    const people = loadSeedPeople(data);
    const people2 = loadSeedPeople2(data, people);
    current = "한 달치 일정";
    const schedule = expandSeedSchedule(loadSeedSchedule(data), data, now);
    const migrations = resetData ? seedMigrations() : [];
    if (branchIds !== undefined) {
      const ids = validateSeedBranchIds(branchIds, data, resetPasswords);
      const scope = selectSeedBranches(data, photos, ids, schedule, spaceChat);
      return await withTransaction(
        (database) => addSeedBranches(scope, database, now),
        db,
      );
    }
    const instance = auth ?? getAuth();
    return await withTransaction(async (database) => {
      current = "전체 초기화 사전 검사";
      const reset = resetData
        ? await resetSeedDatabase(database, migrations)
        : undefined;
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
      current = "기본 지점";
      await setSeedDefaultBranches(
        data.users.flatMap(({ key, defaultBranchId }) =>
          defaultBranchId
            ? [{ userId: userId(key), branchId: defaultBranchId }]
            : [],
        ),
        database,
      );
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
      current = "라운지와 커뮤니티";
      const spaceChatCounts = await syncSeedChatSpaces(
        spaceChat,
        data.branches.map(({ id }) => id),
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
      current = "신고";
      const reportCount = await insertSeedReports(
        spaceChat.loungeReports.map((report) => {
          const messageId = spaceChatCounts.loungeMessageIds
            .get(report.branchId)
            ?.at(report.messageIndex);
          if (!messageId)
            throw new SeedError("신고 시드가 가리키는 라운지 메시지가 없어요.");
          const author = spaceChat.loungeMessages.filter(
            (row) => row.branchId === report.branchId,
          )[report.messageIndex]!;
          return {
            messageId,
            targetUserId: userId(author.authorKey),
            reporterIds: report.reporterKeys.map(userId),
            reason: report.reason,
            detail: report.detail,
            createdAt: new Date(
              now.getTime() - (author.minutesAgo - 5) * 60_000,
            ),
          };
        }),
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
      let planCount = 0;
      for (const { createdByKey, ...plan } of plans) {
        current = `평면도 ${plan.id}`;
        if (
          await seedDal.putSeedPlan(
            { ...plan, createdBy: userId(createdByKey), publishedAt: now },
            database,
          )
        )
          planCount++;
      }
      current = "예약·점검·공지";
      const applied = await applySeedSchedule(
        {
          schedule,
          data,
          userIds,
          now,
          loungeMemberKeys: loungeMembersByBranch(spaceChat),
        },
        database,
      );
      return {
        counts: {
          ...chatCounts,
          chatSpaces:
            chatCounts.chatSpaces +
            data.branches.length +
            spaceChatCounts.communitySpaces,
          communitySpaces: spaceChatCounts.communitySpaces,
          spaceMembers: spaceChatCounts.spaceMembers,
          ...peopleCounts,
          groupRooms: people2Counts.groupRooms,
          directRooms: peopleCounts.directRooms + people2Counts.directRooms,
          chatMessages:
            chatCounts.chatMessages +
            spaceChatCounts.chatMessages +
            peopleCounts.chatMessages +
            people2Counts.chatMessages +
            applied.chatMessages,
          meetingRooms: applied.meetingRooms,
          reports: reportCount,
          users: data.users.length,
          branches: data.branches.length,
          floors: data.floors.length,
          spaces: data.spaces.length,
          teams: data.teams.length,
          teamMembers: data.teamMembers.length,
          branchStaff: data.branchStaff.length,
          accessGrants: data.accessGrants.length,
          floorPlans: planCount,
          bookings: applied.bookings,
          spaceBlocks: applied.spaceBlocks,
          announcements: applied.announcements,
          notifications: applied.notifications,
          spacePhotos: photos.spacePhotos.length,
          branchCovers: photos.branchCovers.length,
        },
        skippedBookings: applied.skippedBookings,
        accounts: data.users.map(({ email }) => email),
        ...(reset ? { reset } : {}),
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
    if (getPostgresError(error)?.code === "23P01")
      throw new SeedError(
        `${current}: 다른 예약·점검과 겹치는 자리가 있어요. 시드를 되돌렸어요.`,
      );
    if (resetData || floorPlans !== undefined)
      throw new SeedError(
        `${floorPlans !== undefined ? "평면도 추가" : "초기화"} 완료 여부를 확인하지 못했어요. 연결 오류는 커밋 응답 유실일 수 있어요. 자동으로 다시 실행하지 말고 DB와 적용 표식을 확인해 주세요.`,
      );
    throw new SeedError(
      `${current}: 시드를 완료하지 못했어요. 모든 시드 변경을 되돌렸어요.`,
    );
  }
}
