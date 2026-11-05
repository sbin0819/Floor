import "server-only";

// 지점 추가 전용이다. 기존 행의 UPDATE/DELETE나 충돌 무시는 허용하지 않는다.
import { inArray, or, sql } from "drizzle-orm";
import type { DalDatabase } from "./database";
import { createBranchLounge } from "./chat-write";
import {
  accessGrants,
  bookings,
  branches,
  branchStaff,
  floorPlans,
  floors,
  spaceBlocks,
  spacePhotos,
  spaces,
  teams,
  users,
} from "@/lib/db/schema";
import type { SeedBranchScope } from "@/lib/seed/scope";

export async function readSeedScopeRows(
  { data, schedule }: SeedBranchScope,
  db: DalDatabase,
) {
  const teamIds = [
    ...new Set([
      ...schedule.bookings.flatMap(({ teamId }) => (teamId ? [teamId] : [])),
      ...data.accessGrants.map(({ teamId }) => teamId),
    ]),
  ];
  const [
    branchRows,
    floorRows,
    spaceRows,
    bookingRows,
    blockRows,
    planRows,
    grantRows,
    staffRows,
    userRows,
    teamRows,
    photoRows,
  ] = await Promise.all([
    data.branches.length
      ? db
          .select({
            id: branches.id,
            name: branches.name,
            hasCover: sql<boolean>`${branches.coverPhotoPath} is not null and ${branches.coverPhotoAlt} is not null`,
          })
          .from(branches)
          .where(
            or(
              inArray(
                branches.id,
                data.branches.map(({ id }) => id),
              ),
              inArray(
                sql`lower(${branches.name})`,
                data.branches.map(({ name }) => name.toLowerCase()),
              ),
            ),
          )
      : [],
    data.floors.length
      ? db
          .select({ id: floors.id, branchId: floors.branchId })
          .from(floors)
          .where(
            inArray(
              floors.id,
              data.floors.map(({ id }) => id),
            ),
          )
      : [],
    data.spaces.length
      ? db
          .select({
            id: spaces.id,
            floorId: spaces.floorId,
            parentId: spaces.parentId,
          })
          .from(spaces)
          .where(
            inArray(
              spaces.id,
              data.spaces.map(({ id }) => id),
            ),
          )
      : [],
    schedule.bookingIds.length
      ? db
          .select({ id: bookings.id, spaceId: bookings.spaceId })
          .from(bookings)
          .where(inArray(bookings.id, schedule.bookingIds))
      : [],
    schedule.blockIds.length
      ? db
          .select({ id: spaceBlocks.id, spaceId: spaceBlocks.spaceId })
          .from(spaceBlocks)
          .where(inArray(spaceBlocks.id, schedule.blockIds))
      : [],
    data.floorPlans.length
      ? db
          .select({ id: floorPlans.id, floorId: floorPlans.floorId })
          .from(floorPlans)
          .where(
            inArray(
              floorPlans.id,
              data.floorPlans.map(({ id }) => id),
            ),
          )
      : [],
    data.accessGrants.length
      ? db
          .select({
            id: accessGrants.id,
            targetType: accessGrants.targetType,
            targetId: accessGrants.targetId,
            teamId: accessGrants.teamId,
          })
          .from(accessGrants)
          .where(
            inArray(
              accessGrants.id,
              data.accessGrants.map(({ id }) => id),
            ),
          )
      : [],
    data.branches.length
      ? db
          .select({
            branchId: branchStaff.branchId,
            userId: branchStaff.userId,
          })
          .from(branchStaff)
          .where(
            inArray(
              branchStaff.branchId,
              data.branches.map(({ id }) => id),
            ),
          )
      : [],
    data.users.length
      ? db
          .select({
            id: users.id,
            email: users.email,
            emailVerified: users.emailVerified,
          })
          .from(users)
          .where(
            inArray(
              users.email,
              data.users.map(({ email }) => email),
            ),
          )
      : [],
    teamIds.length
      ? db
          .select({ id: teams.id })
          .from(teams)
          .where(inArray(teams.id, teamIds))
      : [],
    data.spaces.length
      ? db
          .select({
            spaceId: spacePhotos.spaceId,
            sortOrder: spacePhotos.sortOrder,
          })
          .from(spacePhotos)
          .where(
            inArray(
              spacePhotos.spaceId,
              data.spaces.map(({ id }) => id),
            ),
          )
      : [],
  ]);
  return {
    branchRows,
    floorRows,
    spaceRows,
    bookingRows,
    blockRows,
    planRows,
    grantRows,
    staffRows,
    userRows,
    teamRows,
    teamIds,
    photoRows,
  };
}

export async function insertSeedBranchStructure(
  { data, photos }: SeedBranchScope,
  userIds: ReadonlyMap<string, string>,
  db: DalDatabase,
) {
  const covers = new Map(
    photos.branchCovers.map((cover) => [cover.branchId, cover]),
  );
  if (data.branches.length)
    await db.insert(branches).values(
      data.branches.map((branch) => ({
        ...branch,
        coverPhotoPath: covers.get(branch.id)?.path ?? null,
        coverPhotoAlt: covers.get(branch.id)?.alt ?? null,
      })),
    );
  if (data.floors.length) await db.insert(floors).values(data.floors);
  for (const branch of data.branches) await createBranchLounge(branch.id, db);
  const remaining = new Map(data.spaces.map((space) => [space.id, space]));
  while (remaining.size) {
    const ready = [...remaining.values()].filter(
      ({ parentId }) => parentId === null || !remaining.has(parentId),
    );
    if (!ready.length) throw new Error("Invalid seed space hierarchy");
    await db.insert(spaces).values(ready);
    for (const { id } of ready) remaining.delete(id);
  }
  if (data.branchStaff.length)
    await db.insert(branchStaff).values(
      data.branchStaff.map(({ userKey, ...staff }) => ({
        ...staff,
        userId: userIds.get(userKey)!,
      })),
    );
  if (data.accessGrants.length)
    await db.insert(accessGrants).values(data.accessGrants);
  if (photos.spacePhotos.length)
    await db.insert(spacePhotos).values(photos.spacePhotos);
}
