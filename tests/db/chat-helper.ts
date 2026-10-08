import { chatRooms, teamMembers, teams, users } from "@/lib/db/schema";
import { createTeamSpace } from "@/lib/dal/chat-write";
import type { Session } from "@/lib/auth/types";
import type { TestDatabase } from "./helper";

export const chatNow = new Date("2026-10-08T03:00:00Z");
export async function seedChatActors(database: TestDatabase) {
  const actor = (name: string): Session => ({
    userId: crypto.randomUUID(),
    name,
    email: `${crypto.randomUUID()}@example.test`,
  });
  const admin = actor("관리자");
  const member = actor("팀원");
  const outsider = actor("외부인");
  const operator = actor("운영자");
  await database.db
    .insert(users)
    .values(
      [admin, member, outsider, operator].map(({ userId, ...user }) => ({
        id: userId,
        ...user,
      })),
    );
  const [team] = await database.db
    .insert(teams)
    .values({ name: "가상 채팅팀", createdBy: admin.userId })
    .returning();
  const [otherTeam] = await database.db
    .insert(teams)
    .values({ name: "다른 채팅팀", createdBy: outsider.userId })
    .returning();
  await database.db.insert(teamMembers).values([
    {
      teamId: team!.id,
      userId: admin.userId,
      role: "admin",
      createdAt: new Date("2026-10-01T00:00:00Z"),
    },
    {
      teamId: team!.id,
      userId: member.userId,
      createdAt: new Date("2026-10-01T00:00:00Z"),
    },
    {
      teamId: otherTeam!.id,
      userId: outsider.userId,
      createdAt: new Date("2026-10-01T00:00:00Z"),
    },
  ]);
  const space = await createTeamSpace(team!.id, database.db);
  const otherSpace = await createTeamSpace(otherTeam!.id, database.db);
  const [secondRoom] = await database.db
    .insert(chatRooms)
    .values({ kind: "text", spaceId: space.spaceId, name: "자료" })
    .returning();
  return {
    admin,
    member,
    outsider,
    operator,
    teamId: team!.id,
    otherTeamId: otherTeam!.id,
    ...space,
    otherSpace,
    secondRoomId: secondRoom!.id,
  };
}
export type ChatActors = Awaited<ReturnType<typeof seedChatActors>>;
