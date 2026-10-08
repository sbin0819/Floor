import { z } from "zod";

const optionalValue = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);
const envSchema = z
  .object({
    DATABASE_URL: optionalValue,
    SEED_ALLOW_HOST: optionalValue,
    ABLY_API_KEY: optionalValue,
    LIVEKIT_URL: optionalValue,
    LIVEKIT_API_KEY: optionalValue,
    LIVEKIT_API_SECRET: optionalValue,
    FILE_STORAGE: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.enum(["local", "disabled"]).optional(),
    ),
    FILE_STORAGE_DIR: optionalValue,
    AUTH_SECRET: optionalValue.refine(
      (value) =>
        value === undefined || new TextEncoder().encode(value).length >= 32,
      "AUTH_SECRET은 32바이트 이상이어야 해요.",
    ),
    GOOGLE_CLIENT_ID: optionalValue,
    GOOGLE_CLIENT_SECRET: optionalValue,
    GITHUB_CLIENT_ID: optionalValue,
    GITHUB_CLIENT_SECRET: optionalValue,
    NEXT_PUBLIC_APP_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.url().default("http://localhost:3000"),
    ),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  })
  .superRefine((env, ctx) => {
    for (const provider of ["GOOGLE", "GITHUB"] as const) {
      const idKey = `${provider}_CLIENT_ID` as const;
      const secretKey = `${provider}_CLIENT_SECRET` as const;
      if (Boolean(env[idKey]) !== Boolean(env[secretKey])) {
        ctx.addIssue({
          code: "custom",
          path: [env[idKey] ? secretKey : idKey],
          message: `${provider} 설정 두 개를 모두 입력해 주세요.`,
        });
      }
    }
  });

export function parseEnv(source: Record<string, unknown>) {
  return envSchema.parse(source);
}
export function getEnv() {
  return parseEnv(process.env);
}
