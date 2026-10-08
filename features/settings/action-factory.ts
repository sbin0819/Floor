import {
  createAction,
  type ActionDependencies,
} from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { isAllowedAvatarPhoto, toAvatar } from "@/lib/avatar";
import { createAccountSecurity } from "@/lib/auth/account-security";
import {
  withTransaction,
  type DalDatabase,
  type TransactionDatabase,
} from "@/lib/dal/database";
import * as settings from "@/lib/dal/settings";
import {
  createMemoryRateLimiter,
  type RateLimiter,
} from "@/lib/rate-limit/memory";
import { getRealtimePublisher } from "@/lib/realtime/server";
import { userChannel } from "@/lib/realtime/channels";
import type { RealtimePublisher } from "@/lib/realtime/types";
import {
  changePasswordSchema,
  emptySettingsInput,
  revokeSessionSchema,
  updateAvatarSchema,
  updateNameSchema,
  updatePreferencesSchema,
} from "./schema";

const passwordLimiter = createMemoryRateLimiter();
export type SettingsActionDependencies = Partial<ActionDependencies> & {
  database?: DalDatabase & TransactionDatabase;
  now?: () => Date;
  security?: ReturnType<typeof createAccountSecurity>;
  limiter?: RateLimiter;
  publisher?: RealtimePublisher;
};
export function createSettingsActions(
  dependencies: SettingsActionDependencies = {},
) {
  const security = dependencies.security ?? createAccountSecurity();
  const now = () => dependencies.now?.() ?? new Date();
  async function reauthenticate(userId: string) {
    try {
      await (dependencies.publisher ?? getRealtimePublisher()).publish(
        userChannel(userId),
        { type: "realtime.reauth" },
      );
    } catch {
      console.error("Account realtime refresh failed.");
    }
  }
  return {
    updateName: createAction(
      {
        input: updateNameSchema,
        authorize: "none",
        async handler({ session, input }) {
          return withTransaction(async (tx) => {
            const row = await settings.saveProfileSettings(
              session.userId,
              { name: input.name },
              now(),
              tx,
            );
            if (!row) throw new ActionError("NOT_FOUND");
            return { name: row.name };
          }, dependencies.database);
        },
      },
      dependencies,
    ),
    updateAvatar: createAction(
      {
        input: updateAvatarSchema,
        authorize: "none",
        async handler({ session, input }) {
          // 인증 어댑터는 별도 연결을 쓰므로 앱 트랜잭션 안에서 기다리지 않는다.
          // 연결 해제는 공개하지 않으며 사진 주소는 사용자 잠금 뒤 다시 확인한다.
          const providers =
            input.photo === true
              ? await security.listMyProviders(session.userId)
              : [];
          return withTransaction(async (tx) => {
            const row = await settings.lockProfileSettings(session.userId, tx);
            if (!row) throw new ActionError("NOT_FOUND");
            if (input.photo === true) {
              if (
                !row.avatarUrl ||
                !isAllowedAvatarPhoto(row.avatarUrl) ||
                !providers.some(
                  (provider) => provider === "google" || provider === "github",
                )
              )
                throw new ActionError("INVALID_INPUT");
            }
            const saved = await settings.saveProfileSettings(
              session.userId,
              {
                ...(input.color !== undefined
                  ? { avatarColor: input.color }
                  : {}),
                ...(input.photo !== undefined
                  ? { avatarPhoto: input.photo }
                  : {}),
              },
              now(),
              tx,
            );
            if (!saved) throw new ActionError("NOT_FOUND");
            return { avatar: toAvatar(saved), photo: saved.avatarPhoto };
          }, dependencies.database);
        },
      },
      dependencies,
    ),
    changePassword: createAction(
      {
        input: changePasswordSchema,
        authorize: "none",
        async handler({ session, input }) {
          const rate = (dependencies.limiter ?? passwordLimiter).consume(
            `password:${session.userId}`,
            5,
            600_000,
          );
          if (!rate.allowed)
            throw new ActionError("LIMIT_EXCEEDED", {
              message: "password_attempts",
            });
          await security.changeMyPassword({
            currentPassword: input.currentPassword,
            newPassword: input.newPassword,
            revokeOtherSessions: input.revokeOtherSessions,
          });
          if (input.revokeOtherSessions) await reauthenticate(session.userId);
          return {};
        },
      },
      dependencies,
    ),
    revokeSession: createAction(
      {
        input: revokeSessionSchema,
        authorize: "none",
        async handler({ session, input }) {
          await security.revokeMySession(session.userId, input.sessionId);
          await reauthenticate(session.userId);
          return {};
        },
      },
      dependencies,
    ),
    revokeOtherSessions: createAction(
      {
        input: emptySettingsInput,
        authorize: "none",
        async handler({ session }) {
          await security.revokeMyOtherSessions(session.userId);
          await reauthenticate(session.userId);
          return {};
        },
      },
      dependencies,
    ),
    updatePreferences: createAction(
      {
        input: updatePreferencesSchema,
        authorize: "none",
        async handler({ session, input }) {
          const row = await settings.savePreferences(
            session.userId,
            input,
            now(),
            dependencies.database,
          );
          if (!row) throw new ActionError("NOT_FOUND");
          return row;
        },
      },
      dependencies,
    ),
  };
}
