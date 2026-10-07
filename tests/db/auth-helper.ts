import { createAuth, type AuthInstance } from "@/lib/auth/auth";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { createTestDatabase } from "./helper";

export const authBaseUrl = "http://localhost:3000";
export const authTestSecret =
  "floor-test-auth-secret-0123456789abcdef-0123456789";
export const testPassword = "safe-password-123";

export type SocialIdentity = {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image: string;
};

export function socialIdentity(): SocialIdentity {
  return {
    id: "social-user-1",
    email: "social@example.com",
    emailVerified: true,
    name: "소셜 회원",
    image: "https://example.com/avatar.png",
  };
}

export async function createAuthTestHarness() {
  const database = await createTestDatabase();
  const email = createMemoryEmailSender();
  const identity = socialIdentity();
  const providers = {
    google: {
      clientId: "test-google-client",
      clientSecret: "test-google-secret",
      verifyIdToken: async (token: string) => token === "fixture-token",
      getUserInfo: async () => ({
        user: {
          email: identity.email,
          emailVerified: identity.emailVerified,
          name: identity.name,
          image: identity.image,
        },
        data: {
          sub: identity.id,
          aud: "test-google-client",
          azp: "test-google-client",
          email: identity.email,
          email_verified: identity.emailVerified,
          exp: 4102444800,
          iat: 1700000000,
          iss: "https://accounts.google.com",
          family_name: "회원",
          given_name: "소셜",
          name: identity.name,
          picture: identity.image,
        },
      }),
    },
    github: {
      clientId: "test-github-client",
      clientSecret: "test-github-secret",
      verifyIdToken: async (token: string) => token === "fixture-token",
      getUserInfo: async () => ({
        user: {
          email: identity.email,
          emailVerified: identity.emailVerified,
          name: identity.name,
          image: identity.image,
        },
        data: {
          id: identity.id,
          login: "floor-fixture",
          node_id: "fixture",
          avatar_url: identity.image,
          gravatar_id: "",
          url: "",
          html_url: "",
          followers_url: "",
          following_url: "",
          gists_url: "",
          starred_url: "",
          subscriptions_url: "",
          organizations_url: "",
          repos_url: "",
          events_url: "",
          received_events_url: "",
          type: "User",
          site_admin: false,
          name: identity.name,
          company: "",
          blog: "",
          location: "",
          email: identity.email,
          hireable: false,
          bio: "",
          twitter_username: "",
          public_repos: "0",
          public_gists: "0",
          followers: "0",
          following: "0",
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
          private_gists: "0",
          total_private_repos: "0",
          owned_private_repos: "0",
          disk_usage: "0",
          collaborators: "0",
          two_factor_authentication: false,
          plan: {
            name: "free",
            space: "0",
            private_repos: "0",
            collaborators: "0",
          },
        },
      }),
    },
  };
  const auth = createAuth({
    db: database.db,
    email,
    secret: authTestSecret,
    baseUrl: authBaseUrl,
    providers,
    rateLimit: { enabled: false },
  });
  return { ...database, auth, email, identity };
}

export type AuthTestHarness = Awaited<ReturnType<typeof createAuthTestHarness>>;

export function authRequest(
  auth: AuthInstance,
  path: string,
  body?: unknown,
  cookie?: string,
) {
  return auth.handler(
    new Request(
      new URL(
        path.startsWith("/api/") ? path : `/api/auth${path}`,
        authBaseUrl,
      ),
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          origin: authBaseUrl,
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    ),
  );
}

export function responseCookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

export function emailLink(harness: Pick<AuthTestHarness, "email">): URL {
  const text = harness.email.messages.at(-1)?.text;
  const value = text?.match(/https?:\/\/\S+/)?.[0];
  if (!value) throw new Error("Expected an email link in the memory sender.");
  return new URL(value);
}

export function signup(
  auth: AuthInstance,
  email = "member@example.com",
  password = testPassword,
) {
  return authRequest(auth, "/sign-up/email", {
    name: "  회원 이름  ",
    email,
    password,
  });
}

export async function verifyLastEmail(harness: AuthTestHarness) {
  return harness.auth.handler(new Request(emailLink(harness)));
}

export function login(
  auth: AuthInstance,
  email = "member@example.com",
  password = testPassword,
) {
  return authRequest(auth, "/sign-in/email", { email, password });
}

export function socialLogin(auth: AuthInstance, provider: "google" | "github") {
  return authRequest(auth, "/sign-in/social", {
    provider,
    idToken: { token: "fixture-token" },
    callbackURL: "/",
    errorCallbackURL: "/login",
  });
}
