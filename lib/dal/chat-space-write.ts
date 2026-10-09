import "server-only";

import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { ActionError } from "@/lib/actions/result";
import {
  branches,
  chatRooms,
  chatSpaceInvites,
  chatSpaceMembers,
  chatSpaces,
  notifications,
} from "@/lib/db/schema";
import type { SpaceIconColor } from "@/features/chat/space-schema";
import { activeSpaceMembership, spaceRoleOf } from "./chat-access";
import { createBranchLounge } from "./chat-write";
import type { DalDatabase } from "./database";

export async function lockChatSpace(
  spaceId: string,
  userId: string,
  database: DalDatabase,
) {
  const [space] = await database
    .select()
    .from(chatSpaces)
    .where(and(eq(chatSpaces.id, spaceId), isNull(chatSpaces.deletedAt)))
    .for("update");
  if (!space) throw new ActionError("NOT_FOUND");
  const members = await database
    .select()
    .from(chatSpaceMembers)
    .where(eq(chatSpaceMembers.spaceId, spaceId))
    .orderBy(asc(chatSpaceMembers.userId))
    .for("update");
  const role = await spaceRoleOf(userId, spaceId, database);
  if (!role) throw new ActionError("NOT_FOUND");
  return { space, members, role };
}

export async function requireSpaceJoinCapacity(
  userId: string,
  database: DalDatabase,
) {
  const [row] = await database
    .select({ count: count() })
    .from(chatSpaces)
    .where(
      and(
        sql`${chatSpaces.kind} in ('branch', 'community')`,
        activeSpaceMembership(userId),
      ),
    );
  if ((row?.count ?? 0) >= 100)
    throw new ActionError("LIMIT_EXCEEDED", { message: "space_join_count" });
}

export async function insertCommunity(
  input: { userId: string; name: string; iconColor: SpaceIconColor; now: Date },
  database: DalDatabase,
) {
  const [owned] = await database
    .select({ count: count() })
    .from(chatSpaces)
    .innerJoin(chatSpaceMembers, eq(chatSpaces.id, chatSpaceMembers.spaceId))
    .where(
      and(
        eq(chatSpaces.kind, "community"),
        isNull(chatSpaces.deletedAt),
        eq(chatSpaceMembers.userId, input.userId),
        eq(chatSpaceMembers.role, "owner"),
        eq(chatSpaceMembers.status, "active"),
      ),
    );
  if ((owned?.count ?? 0) >= 10)
    throw new ActionError("LIMIT_EXCEEDED", { message: "space_count" });
  await requireSpaceJoinCapacity(input.userId, database);
  const [space] = await database
    .insert(chatSpaces)
    .values({
      kind: "community",
      name: input.name,
      iconColor: input.iconColor,
      createdBy: input.userId,
      createdAt: input.now,
    })
    .returning({ id: chatSpaces.id });
  if (!space) throw new ActionError("INTERNAL");
  await database.insert(chatSpaceMembers).values({
    spaceId: space.id,
    userId: input.userId,
    role: "owner",
    status: "active",
    joinedAt: input.now,
    statusChangedAt: input.now,
    createdAt: input.now,
  });
  const rooms = await database
    .insert(chatRooms)
    .values([
      {
        kind: "text",
        spaceId: space.id,
        name: "일반",
        createdAt: input.now,
      },
      {
        kind: "voice",
        spaceId: space.id,
        name: "음성",
        voiceCapacity: 10,
        createdAt: input.now,
      },
    ])
    .returning({ id: chatRooms.id, kind: chatRooms.kind });
  const room = rooms.find(({ kind }) => kind === "text");
  if (!room) throw new ActionError("INTERNAL");
  return { spaceId: space.id, roomId: room.id };
}

export async function joinBranchLounge(
  branchId: string,
  userId: string,
  now: Date,
  database: DalDatabase,
) {
  const [branch] = await database
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.id, branchId));
  if (!branch) throw new ActionError("NOT_FOUND");
  const { spaceId } = await createBranchLounge(branchId, database);
  return joinExistingBranchLounge({ branchId, spaceId, userId, now }, database);
}

export async function joinExistingBranchLounge(
  {
    branchId,
    spaceId,
    userId,
    now,
  }: {
    branchId: string;
    spaceId: string;
    userId: string;
    now: Date;
  },
  database: DalDatabase,
) {
  const [space] = await database
    .select({ id: chatSpaces.id })
    .from(chatSpaces)
    .where(
      and(
        eq(chatSpaces.id, spaceId),
        eq(chatSpaces.branchId, branchId),
        eq(chatSpaces.kind, "branch"),
        isNull(chatSpaces.deletedAt),
      ),
    )
    .for("update");
  if (!space) throw new ActionError("NOT_FOUND");
  const [member] = await database
    .select()
    .from(chatSpaceMembers)
    .where(
      and(
        eq(chatSpaceMembers.spaceId, spaceId),
        eq(chatSpaceMembers.userId, userId),
      ),
    )
    .for("update");
  if (member?.status === "active") return { spaceId, changed: false };
  if (member) throw new ActionError("NOT_FOUND");
  await requireSpaceJoinCapacity(userId, database);
  await database.insert(chatSpaceMembers).values({
    spaceId,
    userId,
    role: "member",
    status: "active",
    joinedAt: now,
    statusChangedAt: now,
    createdAt: now,
  });
  return { spaceId, changed: true };
}

export async function deleteSpaceMembership(
  spaceId: string,
  userId: string,
  database: DalDatabase,
) {
  const rows = await database
    .delete(chatSpaceMembers)
    .where(
      and(
        eq(chatSpaceMembers.spaceId, spaceId),
        eq(chatSpaceMembers.userId, userId),
        eq(chatSpaceMembers.status, "active"),
      ),
    )
    .returning({ userId: chatSpaceMembers.userId });
  if (!rows.length) throw new ActionError("NOT_FOUND");
}

export function updateCommunity(
  spaceId: string,
  values: { name?: string; iconColor?: SpaceIconColor },
  database: DalDatabase,
) {
  return database
    .update(chatSpaces)
    .set(values)
    .where(and(eq(chatSpaces.id, spaceId), isNull(chatSpaces.deletedAt)));
}

export async function updateSpaceRole(
  spaceId: string,
  userId: string,
  role: "owner" | "admin" | "member",
  now: Date,
  database: DalDatabase,
) {
  const rows = await database
    .update(chatSpaceMembers)
    .set({ role, statusChangedAt: now })
    .where(
      and(
        eq(chatSpaceMembers.spaceId, spaceId),
        eq(chatSpaceMembers.userId, userId),
        eq(chatSpaceMembers.status, "active"),
      ),
    )
    .returning({ userId: chatSpaceMembers.userId });
  if (!rows.length) throw new ActionError("NOT_FOUND");
}

export async function softDeleteCommunity(
  spaceId: string,
  now: Date,
  database: DalDatabase,
) {
  const rows = await database
    .update(chatSpaces)
    .set({ deletedAt: now })
    .where(
      and(
        eq(chatSpaces.id, spaceId),
        eq(chatSpaces.kind, "community"),
        isNull(chatSpaces.deletedAt),
      ),
    )
    .returning({ id: chatSpaces.id });
  if (!rows.length) throw new ActionError("NOT_FOUND");
  await database
    .update(chatSpaceInvites)
    .set({ revokedAt: now })
    .where(
      and(
        eq(chatSpaceInvites.spaceId, spaceId),
        isNull(chatSpaceInvites.revokedAt),
      ),
    );
  await database
    .delete(notifications)
    .where(
      and(
        eq(notifications.type, "space_invite"),
        sql`${notifications.data}->>'inviteCode' in (select code from ${chatSpaceInvites} where ${chatSpaceInvites.spaceId} = ${spaceId})`,
      ),
    );
}
