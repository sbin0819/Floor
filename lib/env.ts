import { z } from "zod";

const optionalValue = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);
const envSchema = z
  .object({
    DATABASE_URL: optionalValue,
    AUTH_MODE: z.enum(["", "demo"]).default(""),
    AUTH_SECRET: optionalValue,
    NEXT_PUBLIC_APP_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.url().default("http://localhost:3000"),
    ),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === "demo" && !env.AUTH_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_SECRET"],
        message: "AUTH_MODE=demo에는 AUTH_SECRET이 필요해요.",
      });
    }
  });

export function parseEnv(source: Record<string, unknown>) {
  return envSchema.parse(source);
}
export function getEnv() {
  return parseEnv(process.env);
}
