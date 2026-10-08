import { ActionError } from "@/lib/actions/result";
import type { DalDatabase } from "@/lib/dal";
import { getTeamMember } from "@/lib/dal/teams-read";
import { lockTeam } from "@/lib/dal/teams-write";
import { lockTeamMembers } from "@/lib/dal/teams-manage";
import {
  lockBookingUsers,
  type BookingUserLock,
} from "@/lib/dal/booking-participants";
import { can } from "@/lib/permissions/can";
import { getRealtimePublisher } from "@/lib/realtime/server";
import { userChannel } from "@/lib/realtime/channels";
import type { RealtimeItem, RealtimePublisher } from "@/lib/realtime/types";
import type { TeamActionDependencies } from "./action-factory";

export type TeamManagementDependencies = TeamActionDependencies & {
  now?: () => Date;
  publisher?: RealtimePublisher;
};
type Member = { userId: string; role: "admin" | "member" };

export function assertTeamAuthority(
  userId: string,
  teamId: string,
  member: Member | null | undefined,
  manager: boolean,
) {
  if (!member) throw new ActionError("NOT_FOUND");
  if (
    manager &&
    !can(
      {
        userId,
        teams: [{ teamId, role: member.role }],
        staffBranchIds: [],
        roleSettings: {},
      },
      "team.manage_members",
      { teamId },
    )
  )
    throw new ActionError("FORBIDDEN");
}

export async function authorizeManagedTeam(
  userId: string,
  teamId: string,
  manager: boolean,
  database?: DalDatabase,
) {
  const member = await getTeamMember(teamId, userId, database);
  assertTeamAuthority(
    userId,
    teamId,
    member ? { userId, role: member.role } : null,
    manager,
  );
  return true;
}

export async function lockManagedTeam(
  input: {
    actorId: string;
    teamId: string;
    manager: boolean;
    users: readonly BookingUserLock[];
  },
  database: DalDatabase,
) {
  if (!(await lockBookingUsers(input.users, database)))
    throw new ActionError("NOT_FOUND");
  const team = await lockTeam(input.teamId, database);
  if (!team) throw new ActionError("NOT_FOUND");
  const members = await lockTeamMembers(team.id, database);
  assertTeamAuthority(
    input.actorId,
    team.id,
    members.find(({ userId }) => userId === input.actorId),
    input.manager,
  );
  return { team, members };
}

export const teamNotificationsChanged = (
  userIds: readonly string[],
): RealtimeItem[] =>
  [...new Set(userIds)].map((userId) => ({
    channel: userChannel(userId),
    event: { type: "notifications.changed" },
  }));

export async function publishTeamEvents(
  events: readonly RealtimeItem[],
  dependencies: TeamManagementDependencies,
) {
  if (!events.length) return;
  try {
    await (dependencies.publisher ?? getRealtimePublisher()).publishMany(
      events,
    );
  } catch {
    try {
      (dependencies.logError ?? console.error)(
        "Team realtime publication failed.",
      );
    } catch {
      // 발행과 로깅 실패가 이미 커밋한 변경의 성공을 뒤집지 않는다.
    }
  }
}
