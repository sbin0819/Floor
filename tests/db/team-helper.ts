import { sql } from "drizzle-orm";
import type { Session } from "@/lib/auth/types";
import { branches, teamMembers, teams, users } from "@/lib/db/schema";
import type { TestDatabase } from "./helper";

export async function seedTeamActors(database: TestDatabase) {
  await database.db.execute(sql`TRUNCATE TABLE users, branches CASCADE`);
  const actor = (name: string): Session => ({
    userId: crypto.randomUUID(),
    name,
    email: `${name}@example.test`,
  });
  const actors = {
    owner: actor("owner"),
    otherOwner: actor("other-owner"),
    member: actor("member"),
    outsider: actor("outsider"),
    unverified: actor("unverified"),
    operator: actor("operator"),
  };
  await database.db.insert(users).values(
    Object.values(actors).map((session) => ({
      id: session.userId,
      name: session.name,
      email: session.email,
      emailVerified: session !== actors.unverified,
    })),
  );
  const branchId = crypto.randomUUID();
  await database.db
    .insert(branches)
    .values({ id: branchId, name: "가상 지점" });
  return { ...actors, branchId };
}

export type TeamActors = Awaited<ReturnType<typeof seedTeamActors>>;

export async function seedTeam(
  database: TestDatabase,
  owner: Session,
  name = "가상 팀",
) {
  const [team] = await database.db
    .insert(teams)
    .values({
      name,
      createdBy: owner.userId,
      headcount: 5,
      contactPhone: "01012345678",
    })
    .returning();
  if (!team) throw new Error("Expected a fixture team.");
  await database.db.insert(teamMembers).values({
    teamId: team.id,
    userId: owner.userId,
    role: "admin",
    title: "팀장",
  });
  return team;
}
