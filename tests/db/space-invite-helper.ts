import { chatSpaceMembers, chatSpaces } from "@/lib/db/schema";
import { chatNow, seedChatActors } from "./chat-helper";
import type { TestDatabase } from "./helper";

export async function seedInviteActors(database: TestDatabase) {
  const actors = await seedChatActors(database);
  const [space] = await database.db
    .insert(chatSpaces)
    .values({
      kind: "community",
      name: "가상 커뮤니티",
      createdBy: actors.admin.userId,
      iconColor: "purple",
    })
    .returning();
  await database.db.insert(chatSpaceMembers).values(
    [
      { userId: actors.admin.userId, role: "owner" as const },
      { userId: actors.member.userId, role: "member" as const },
      { userId: actors.operator.userId, role: "admin" as const },
    ].map((member) => ({
      ...member,
      spaceId: space!.id,
      joinedAt: chatNow,
      statusChangedAt: chatNow,
    })),
  );
  return { ...actors, communityId: space!.id };
}
export type InviteActors = Awaited<ReturnType<typeof seedInviteActors>>;
