import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import {
  readLoungeMembers,
  readSpaceMembers,
  type SpaceMember,
} from "@/lib/dal/chat-space-members";
import type { ChatQueryDependencies } from "./query-factory";
import type { SpaceIconColor } from "./space-schema";

export type { SpaceMember };
export type SpaceMembersView = {
  space: {
    id: string;
    kind: "team" | "branch" | "community";
    name: string;
    iconColor: SpaceIconColor;
    role: "member" | "admin" | "owner";
  };
  memberCount: number;
} & (
  | { view: "limited"; admins: SpaceMember[] }
  | { view: "full"; members: SpaceMember[]; banned: SpaceMember[] }
);
export function createSpaceMemberQueries(
  dependencies: ChatQueryDependencies = {},
) {
  return {
    async getSpaceMembers(spaceId: string): Promise<SpaceMembersView | null> {
      const session = await (dependencies.requireSession ?? requireSession)();
      if (!z.uuid().safeParse(spaceId).success) return null;
      const row = await readSpaceMembers(
        session.userId,
        spaceId,
        dependencies.database,
      );
      if (!row) return null;
      const { id, kind, name, iconColor, role } = row;
      const base = {
        space: { id, kind, name, iconColor, role },
        memberCount: row.memberCount,
      };
      if (row.kind === "branch") {
        const people = await readLoungeMembers(
          session.userId,
          row,
          dependencies.database,
        );
        if (!people) return null;
        const members: SpaceMember[] = [],
          banned: SpaceMember[] = [];
        for (const { status, ...person } of people)
          (status === "active" ? members : banned).push(person);
        return role === "member"
          ? { ...base, view: "limited", admins: members }
          : { ...base, view: "full", members, banned };
      }
      const members: SpaceMember[] = [],
        banned: SpaceMember[] = [];
      for (const { status, ...person } of row.people ?? [])
        (status === "active" ? members : banned).push(person);
      return { ...base, view: "full", members, banned };
    },
  };
}
export async function getSpaceMembers(spaceId: string) {
  return createSpaceMemberQueries().getSpaceMembers(spaceId);
}
