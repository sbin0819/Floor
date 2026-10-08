import { headers } from "next/headers";
import { isAPIError } from "better-auth/api";
import type { Session as AuthSession, Where } from "better-auth";
import { ActionError } from "@/lib/actions/result";
import { getAuth, type AuthInstance } from "@/lib/auth/auth";
import { getCurrentSessionId } from "@/lib/auth/session";
import { parseUserAgent, type SessionDevice } from "@/lib/user-agent";

export type AccountSession = SessionDevice & {
  id: string;
  createdAt: string;
  updatedAt: string;
  current: boolean;
};
export type AccountProvider = "credential" | "google" | "github";
export type ChangeMyPasswordInput = {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions: boolean;
};
type Dependencies = {
  auth?: AuthInstance;
  headers?: () => Promise<Headers>;
  currentSessionId?: () => Promise<string | null>;
  now?: () => Date;
};
type PrivateSession = Pick<
  AuthSession,
  | "id"
  | "userId"
  | "token"
  | "userAgent"
  | "createdAt"
  | "updatedAt"
  | "expiresAt"
>;

export function createAccountSecurity(deps: Dependencies = {}) {
  const auth = () => deps.auth ?? getAuth();
  const requestHeaders = deps.headers ?? headers;
  const now = deps.now ?? (() => new Date());
  const currentId =
    deps.currentSessionId ??
    (deps.auth || deps.headers
      ? async () =>
          (await auth().api.getSession({ headers: await requestHeaders() }))
            ?.session.id ?? null
      : getCurrentSessionId);

  async function activeSessions(userId: string): Promise<PrivateSession[]> {
    const { adapter } = await auth().$context;
    const where: Where[] = [
      { field: "userId", value: userId },
      { field: "expiresAt", operator: "gt", value: now() },
    ];
    // 1.7.7의 internalAdapter.listSessions는 기본 100개 제한을 바꿀 수 없다.
    // 동일한 Better Auth 어댑터에 명시적 한도를 주어 오래된 기기도 빠뜨리지 않는다.
    const count = await adapter.count({ model: "session", where });
    if (count === 0) return [];
    return adapter.findMany<PrivateSession>({
      model: "session",
      where,
      limit: count,
      select: [
        "id",
        "userId",
        "token",
        "userAgent",
        "createdAt",
        "updatedAt",
        "expiresAt",
      ],
      sortBy: { field: "updatedAt", direction: "desc" },
    });
  }

  async function ownSessions(userId: string) {
    const [sessions, sessionId] = await Promise.all([
      activeSessions(userId),
      currentId(),
    ]);
    if (!sessionId || !sessions.some((session) => session.id === sessionId))
      throw new ActionError("UNAUTHENTICATED");
    return { sessions, sessionId };
  }

  return {
    async changeMyPassword(input: ChangeMyPasswordInput): Promise<void> {
      try {
        // nextCookies 플러그인이 새 쿠키를 Server Action 응답에 전달한다.
        // Better Auth의 반환값에는 토큰이 있으므로 경계 밖으로 돌려주지 않는다.
        await auth().api.changePassword({
          body: input,
          headers: await requestHeaders(),
        });
      } catch (error) {
        if (isAPIError(error)) {
          if (error.body?.code === "INVALID_PASSWORD")
            throw new ActionError("PASSWORD_INCORRECT");
          if (error.body?.code === "CREDENTIAL_ACCOUNT_NOT_FOUND")
            throw new ActionError("FORBIDDEN");
          if (error.statusCode === 401)
            throw new ActionError("UNAUTHENTICATED");
        }
        // 인증 오류에 입력·토큰이 섞여 있어도 일반 액션 경계에 원문을 넘기지 않는다.
        throw new ActionError("INTERNAL");
      }
    },
    async listMySessions(userId: string): Promise<AccountSession[]> {
      const { sessions, sessionId } = await ownSessions(userId);
      return sessions
        .sort(
          (a, b) =>
            Number(b.id === sessionId) - Number(a.id === sessionId) ||
            b.updatedAt.getTime() - a.updatedAt.getTime(),
        )
        .map((session) => ({
          id: session.id,
          ...parseUserAgent(session.userAgent),
          createdAt: session.createdAt.toISOString(),
          updatedAt: session.updatedAt.toISOString(),
          current: session.id === sessionId,
        }));
    },
    async listMyProviders(userId: string): Promise<AccountProvider[]> {
      const { internalAdapter } = await auth().$context;
      const providers = new Set(
        (await internalAdapter.findAccounts(userId)).map(
          ({ providerId }) => providerId,
        ),
      );
      return (["credential", "google", "github"] as const).filter((provider) =>
        providers.has(provider),
      );
    },
    async revokeMySession(userId: string, targetId: string): Promise<void> {
      const { sessions, sessionId } = await ownSessions(userId);
      if (targetId === sessionId) throw new ActionError("INVALID_INPUT");
      const target = sessions.find(({ id }) => id === targetId);
      if (!target) throw new ActionError("NOT_FOUND");
      await (await auth().$context).internalAdapter.deleteSession(target.token);
    },
    async revokeMyOtherSessions(userId: string): Promise<void> {
      const { sessions, sessionId } = await ownSessions(userId);
      const { internalAdapter } = await auth().$context;
      await Promise.all(
        sessions
          .filter(({ id }) => id !== sessionId)
          .map(({ token }) => internalAdapter.deleteSession(token)),
      );
    },
  };
}

export const {
  changeMyPassword,
  listMySessions,
  listMyProviders,
  revokeMySession,
  revokeMyOtherSessions,
} = createAccountSecurity();
