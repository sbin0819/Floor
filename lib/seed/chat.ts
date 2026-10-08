import { z } from "zod";
import chatFile from "@/docs/spec/examples/seed-chat.json";
import type { SeedData } from "@/lib/seed/data";
import { SeedError } from "@/lib/seed/errors";

type ChatSeedReferences = Pick<SeedData, "teams" | "users" | "teamMembers">;

const seedChatSchema = z.strictObject({
  note: z.string(),
  messages: z.array(
    z.strictObject({
      teamId: z.uuid().transform((value) => value.toLowerCase()),
      authorKey: z.string().min(1),
      minutesAgo: z.int().nonnegative(),
      body: z
        .string()
        .trim()
        .refine(
          (value) =>
            Array.from(value).length >= 1 && Array.from(value).length <= 4000,
          "본문은 1–4000자여야 해요.",
        ),
    }),
  ),
});

export function parseSeedChat(input: unknown, seed: ChatSeedReferences) {
  const result = seedChatSchema
    .superRefine((data, context) => {
      const teams = new Set(seed.teams.map(({ id }) => id));
      const users = new Set(seed.users.map(({ key }) => key));
      const members = new Set(
        seed.teamMembers.map(({ teamId, userKey }) => `${teamId}:${userKey}`),
      );
      const previousMinutes = new Map<string, number>();
      data.messages.forEach(({ teamId, authorKey, minutesAgo }, index) => {
        const issue = (field: string, message: string) =>
          context.addIssue({
            code: "custom",
            path: ["messages", index, field],
            message,
          });
        if (!teams.has(teamId)) issue("teamId", "시드에 없는 팀이에요.");
        if (!users.has(authorKey))
          issue("authorKey", "시드에 없는 작성자예요.");
        else if (!members.has(`${teamId}:${authorKey}`))
          issue("authorKey", "작성자가 이 팀의 팀원이 아니에요.");
        const previous = previousMinutes.get(teamId);
        if (previous !== undefined && minutesAgo >= previous)
          issue(
            "minutesAgo",
            "메시지 시각은 팀마다 오래된 것부터 차례로 정해야 해요.",
          );
        previousMinutes.set(teamId, minutesAgo);
      });
    })
    .safeParse(input);
  if (!result.success)
    throw new SeedError(
      `채팅 시드 데이터 검증 실패: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  return { messages: result.data.messages };
}

export type SeedChatData = ReturnType<typeof parseSeedChat>;

export function loadSeedChat(seed: ChatSeedReferences): SeedChatData {
  return parseSeedChat(chatFile, seed);
}
