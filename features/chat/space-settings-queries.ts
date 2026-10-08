import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { readSpaceSettings } from "@/lib/dal/chat-space-settings";
import type { ChatQueryDependencies } from "./query-factory";

export function createSpaceSettingsQueries(
  dependencies: ChatQueryDependencies = {},
) {
  return {
    async getSpaceSettings(spaceId: string) {
      const session = await (dependencies.requireSession ?? requireSession)();
      if (!z.uuid().safeParse(spaceId).success) return null;
      return readSpaceSettings(session.userId, spaceId, dependencies.database);
    },
  };
}
export async function getSpaceSettings(spaceId: string) {
  return createSpaceSettingsQueries().getSpaceSettings(spaceId);
}
export type SpaceSettings = NonNullable<
  Awaited<ReturnType<typeof getSpaceSettings>>
>;
