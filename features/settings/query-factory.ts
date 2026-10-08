import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import { createAccountSecurity } from "@/lib/auth/account-security";
import { ActionError } from "@/lib/actions/result";
import { isAllowedAvatarPhoto, toAvatar } from "@/lib/avatar";
import { readProfileSettings, readPreferences } from "@/lib/dal/settings";
import { listBranches } from "@/lib/dal/branches";
import { readPersonProfile } from "@/lib/dal/people-read";
import { listTakenUsernames } from "@/lib/dal/people-username";
import type { DalDatabase } from "@/lib/dal/database";
import {
  usernameCandidates,
  usernameSuggestionBase,
} from "@/lib/people/username";
import { makeUsernameSettings } from "@/features/people/username";
import type {
  ProfileSettings,
  AccountSettings,
  PreferenceSettings,
} from "./types";

export type SettingsQueryDependencies = {
  database?: DalDatabase;
  requireSession?: () => Promise<Session>;
  now?: () => Date;
  security?: Pick<
    ReturnType<typeof createAccountSecurity>,
    "listMyProviders" | "listMySessions"
  >;
};
export function createSettingsQueries(
  dependencies: SettingsQueryDependencies = {},
) {
  const session = dependencies.requireSession ?? requireSession;
  const security = dependencies.security ?? createAccountSecurity();
  const database = dependencies.database;
  return {
    async getProfileSettings(): Promise<ProfileSettings> {
      const me = await session();
      const now = dependencies.now?.() ?? new Date();
      const candidates = usernameCandidates(usernameSuggestionBase(me.email));
      const [row, providers, profile, taken] = await Promise.all([
        readProfileSettings(me.userId, database),
        security.listMyProviders(me.userId),
        readPersonProfile(me.userId, me.userId, now, database),
        listTakenUsernames(candidates, database),
      ]);
      if (!row || !profile) throw new ActionError("NOT_FOUND");
      const photoUrl =
        row.avatarUrl && isAllowedAvatarPhoto(row.avatarUrl)
          ? row.avatarUrl
          : null;
      const photoProvider =
        photoUrl && providers.includes("google")
          ? "google"
          : photoUrl && providers.includes("github")
            ? "github"
            : null;
      return {
        userId: row.id,
        name: row.name,
        avatar: toAvatar(row),
        photo: row.avatarPhoto,
        photoProvider,
        photoUrl: photoProvider ? photoUrl : null,
        usernameSettings: makeUsernameSettings(row, candidates, taken, now),
        preview: {
          ...profile,
          isMe: true,
          relation: null,
          canDirectMessage: false,
        },
      };
    },
    async getAccountSettings(): Promise<AccountSettings> {
      const me = await session();
      const [row, providers, sessions] = await Promise.all([
        readProfileSettings(me.userId, database),
        security.listMyProviders(me.userId),
        security.listMySessions(me.userId),
      ]);
      if (!row) throw new ActionError("NOT_FOUND");
      return {
        email: row.email,
        emailVerified: row.emailVerified,
        providers,
        sessions,
      };
    },
    async getPreferences(): Promise<PreferenceSettings> {
      const me = await session();
      const [row, branches] = await Promise.all([
        readPreferences(me.userId, database),
        listBranches(database),
      ]);
      if (!row) throw new ActionError("NOT_FOUND");
      return { ...row, branches };
    },
  };
}
