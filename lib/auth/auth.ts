import "server-only";

import { queueAfterTransactionHook } from "@better-auth/core/context";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { nameSchema, signupSchema } from "@/features/auth/schema";
import type { DalDatabase, TransactionDatabase } from "@/lib/dal/database";
import { getDb } from "@/lib/db/client";
import {
  authAccounts,
  authSessions,
  authVerifications,
  users,
} from "@/lib/db/schema";
import { canSendEmail, getEmailSender } from "@/lib/email";
import {
  existingAccountEmail,
  passwordResetEmail,
  socialAccountLinkedEmail,
  verificationEmail,
} from "@/lib/email/templates";
import type { EmailSender } from "@/lib/email/types";
import { getEnv } from "@/lib/env";

export const disabledAuthPaths = [
  "/update-user",
  "/change-email",
  "/delete-user",
  "/delete-user/callback",
  "/change-password",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/list-accounts",
  "/link-social",
  "/unlink-account",
  "/get-access-token",
  "/refresh-token",
  "/account-info",
] as const;

type Providers = Pick<
  NonNullable<BetterAuthOptions["socialProviders"]>,
  "google" | "github"
>;
type AuthOptions = {
  db: DalDatabase & TransactionDatabase;
  email: EmailSender;
  secret: string;
  baseUrl: string;
  providers?: Providers;
  /** 테스트에서만 요청 횟수 제한을 끌 수 있다. 실제 인스턴스에는 전달하지 않는다. */
  rateLimit?: { enabled: false };
};

const authSchema = {
  user: users,
  session: authSessions,
  account: authAccounts,
  verification: authVerifications,
};
const logger: NonNullable<BetterAuthOptions["logger"]> = {
  level: "warn",
  log(level) {
    // 라이브러리 메시지와 인자에는 SQL 값이나 토큰이 포함될 수 있다.
    if (level === "error") console.error("[auth] Request failed.");
    else if (level === "warn")
      console.warn("[auth] Configuration or request warning.");
  },
};

async function afterCommitEmail(send: () => Promise<void>): Promise<void> {
  await queueAfterTransactionHook(async () => {
    try {
      await send();
    } catch {
      console.error("[auth] Email delivery failed.");
    }
  });
}

function isSocialProvider(provider: string): provider is "google" | "github" {
  return provider === "google" || provider === "github";
}

export function createAuth(options: AuthOptions) {
  const { db, email, secret, baseUrl, providers = {} } = options;
  // 요청 객체 수명이 끝나면 연결 알림 상태도 함께 해제된다.
  const linkedCredentials = new WeakMap<object, Set<string>>();
  const auth = betterAuth({
    appName: "Floor",
    baseURL: baseUrl,
    secret,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
      transaction: true,
    }),
    advanced: {
      database: { generateId: "uuid" },
      // Better Auth는 테스트 환경에서 기본적으로 origin 검사를 생략한다.
      disableOriginCheck: false,
    },
    logger,
    onAPIError: {
      // 기본 router 오류 처리는 전역 logger도 사용하므로 여기서 함께 차단한다.
      onError() {
        console.error("[auth] Request failed.");
      },
      errorURL: new URL("/login", baseUrl).href,
    },
    disabledPaths: [...disabledAuthPaths],
    ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}),
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    user: {
      fields: { image: "avatarUrl" },
      validateUserInfo({ user, source }) {
        if (source.method === "oauth" && user.emailVerified !== true) {
          return { error: "provider_email_not_verified" };
        }
      },
    },
    socialProviders: providers,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        await afterCommitEmail(() =>
          email.send(passwordResetEmail({ to: user.email, url })),
        );
      },
      async onPasswordReset({ user }) {
        await (
          await auth.$context
        ).internalAdapter.updateUser(user.id, { emailVerified: true });
      },
      async onExistingUserSignUp({ user }) {
        await afterCommitEmail(async () => {
          if (!user.emailVerified) {
            await auth.api.requestPasswordReset({
              body: {
                email: user.email,
                redirectTo: new URL("/reset-password", baseUrl).href,
              },
            });
          } else {
            await email.send(
              existingAccountEmail({
                to: user.email,
                url: new URL("/login", baseUrl).href,
              }),
            );
          }
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      async sendVerificationEmail({ user, token }) {
        const url = new URL("/api/auth/verify-email", baseUrl);
        url.searchParams.set("token", token);
        url.searchParams.set(
          "callbackURL",
          new URL("/login?verified=1", baseUrl).href,
        );
        await afterCommitEmail(() =>
          email.send(verificationEmail({ to: user.email, url: url.href })),
        );
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        const parsed = signupSchema.safeParse(ctx.body);
        if (!parsed.success || Object.hasOwn(ctx.body, "image")) {
          throw new APIError("BAD_REQUEST", {
            code: "INVALID_SIGNUP_INPUT",
            message: "가입 정보를 확인해 주세요",
          });
        }
        return { context: { body: { ...ctx.body, ...parsed.data } } };
      }),
    },
    databaseHooks: {
      user: {
        create: {
          async before(user) {
            const name = (
              user.name.trim() ||
              user.email.split("@")[0] ||
              "회원"
            ).slice(0, 50);
            return { data: { ...user, name, email: user.email.toLowerCase() } };
          },
        },
      },
      account: {
        create: {
          async before(account, context) {
            if (!context || !isSocialProvider(account.providerId)) return;
            const { internalAdapter } = await auth.$context;
            const credential = await internalAdapter.findCredentialAccount(
              account.userId,
            );
            if (!credential) return;
            // 연결 실패 시에도 남의 비밀번호가 다시 살아나지 않는 안전한 정리다.
            await internalAdapter.deleteAccount(credential.id);
            await internalAdapter.deleteUserSessions(account.userId);
            const pending = linkedCredentials.get(context) ?? new Set<string>();
            pending.add(account.userId);
            linkedCredentials.set(context, pending);
          },
          async after(account, context) {
            if (
              !context ||
              !isSocialProvider(account.providerId) ||
              !linkedCredentials.get(context)?.delete(account.userId)
            )
              return;
            const user = await (
              await auth.$context
            ).internalAdapter.findUserById(account.userId);
            if (!user) return;
            const provider = account.providerId;
            await afterCommitEmail(() =>
              email.send(
                socialAccountLinkedEmail({
                  to: user.email,
                  url: new URL("/forgot-password", baseUrl).href,
                  provider,
                }),
              ),
            );
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
  return auth;
}

export type AuthInstance = ReturnType<typeof createAuth>;

// 계정 준비 명령의 외부 트랜잭션에만 연결되며 HTTP API는 노출하지 않는다.
export async function createProvisioningAuth({
  db,
  auth,
}: {
  db: DalDatabase;
  auth: AuthInstance;
}) {
  const context = await auth.$context;
  const provisioning = betterAuth({
    baseURL: auth.options.baseURL,
    secret: context.secret,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
      transaction: false,
    }),
    advanced: { database: { generateId: "uuid" } },
    user: { fields: { image: "avatarUrl" } },
    logger,
  });
  const { internalAdapter } = await provisioning.$context;
  return {
    hashPassword: context.password.hash,
    async createVerifiedUser(input: { email: string; name: string }) {
      const name = nameSchema.parse(input.name);
      return internalAdapter.createUser(
        { name, email: input.email.toLowerCase(), emailVerified: true },
        { method: "admin" },
      );
    },
    async setPassword(userId: string, passwordHash: string) {
      if (await internalAdapter.findCredentialAccount(userId)) {
        await internalAdapter.updatePassword(userId, passwordHash);
      } else {
        await internalAdapter.linkAccount({
          userId,
          accountId: userId,
          providerId: "credential",
          password: passwordHash,
        });
      }
    },
    async revokeSessions(userId: string) {
      await internalAdapter.deleteUserSessions(userId);
    },
    async verifyEmail(userId: string) {
      await internalAdapter.updateUser(userId, { emailVerified: true });
    },
    async listProviders(userId: string) {
      return (await internalAdapter.findAccounts(userId)).map(
        (account) => account.providerId,
      );
    },
  };
}

function configuredProviders(): Providers {
  const env = getEnv();
  return {
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
  };
}

export function getAuthUiOptions(): {
  providers: ("google" | "github")[];
  emailEnabled: boolean;
} {
  const configured = configuredProviders();
  return {
    providers: (["google", "github"] as const).filter((provider) =>
      Boolean(configured[provider]),
    ),
    emailEnabled: canSendEmail(),
  };
}

let authInstance: AuthInstance | undefined;
export function getAuth(): AuthInstance {
  if (authInstance) return authInstance;
  const env = getEnv();
  if (!env.AUTH_SECRET)
    throw new Error("AUTH_SECRET is required when accessing authentication.");
  authInstance = createAuth({
    db: getDb(),
    email: getEmailSender(),
    secret: env.AUTH_SECRET,
    baseUrl: env.NEXT_PUBLIC_APP_URL,
    providers: configuredProviders(),
  });
  return authInstance;
}
