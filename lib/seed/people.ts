import { z } from "zod";
import peopleFile from "@/docs/spec/examples/seed-people.json";
import { messageBodySchema } from "@/features/chat/schema";
import { parseUsername } from "@/lib/people/username";
import type { SeedData } from "./data";
import { SeedError } from "./errors";

type PeopleSeedReferences = Pick<SeedData, "users" | "teamMembers">;
const key = z.string().min(1);
const minutesAgo = z.int().nonnegative();
const seedPeopleSchema = z.strictObject({
  note: z.string(),
  usernames: z.array(z.strictObject({ userKey: key, username: z.string() })),
  friendships: z.array(
    z.strictObject({
      requestedBy: key,
      to: key,
      status: z.enum(["pending", "accepted"]),
      minutesAgo,
    }),
  ),
  directMessages: z.array(
    z.strictObject({
      users: z.tuple([key, key]),
      messages: z
        .array(
          z.strictObject({
            authorKey: key,
            minutesAgo,
            body: messageBodySchema,
          }),
        )
        .min(1),
    }),
  ),
});

const pairKey = (first: string, second: string) =>
  JSON.stringify([first, second].sort());

export function parseSeedPeople(input: unknown, seed: PeopleSeedReferences) {
  const result = seedPeopleSchema
    .superRefine((data, context) => {
      const users = new Set(seed.users.map(({ key }) => key));
      const usernames = new Set<string>();
      const namedUsers = new Set<string>();
      const pairs = new Set<string>();
      const accepted = new Set<string>();
      const directPairs = new Set<string>();
      const issue = (path: (string | number)[], message: string) =>
        context.addIssue({ code: "custom", path, message });
      const userExists = (userKey: string, path: (string | number)[]) => {
        if (!users.has(userKey)) issue(path, "시드에 없는 사용자예요.");
      };
      data.usernames.forEach(({ userKey, username }, index) => {
        userExists(userKey, ["usernames", index, "userKey"]);
        if (parseUsername(username) !== username)
          issue(
            ["usernames", index, "username"],
            "정규화된 올바른 사용자 이름이어야 해요.",
          );
        if (usernames.has(username))
          issue(["usernames", index, "username"], "사용자 이름이 겹쳐요.");
        if (namedUsers.has(userKey))
          issue(
            ["usernames", index, "userKey"],
            "한 사람에게 이름이 두 번 있어요.",
          );
        usernames.add(username);
        namedUsers.add(userKey);
      });
      data.friendships.forEach(({ requestedBy, to, status }, index) => {
        userExists(requestedBy, ["friendships", index, "requestedBy"]);
        userExists(to, ["friendships", index, "to"]);
        if (requestedBy === to)
          issue(
            ["friendships", index, "to"],
            "자기 자신에게 친구 요청을 할 수 없어요.",
          );
        const pair = pairKey(requestedBy, to);
        if (pairs.has(pair))
          issue(["friendships", index], "같은 친구 관계가 두 번 있어요.");
        pairs.add(pair);
        if (status === "accepted") accepted.add(pair);
      });
      data.directMessages.forEach((direct, index) => {
        const [first, second] = direct.users;
        userExists(first, ["directMessages", index, "users", 0]);
        userExists(second, ["directMessages", index, "users", 1]);
        if (first === second)
          issue(
            ["directMessages", index, "users"],
            "DM의 두 사람은 달라야 해요.",
          );
        const pair = pairKey(first, second);
        if (directPairs.has(pair))
          issue(["directMessages", index, "users"], "같은 DM이 두 번 있어요.");
        directPairs.add(pair);
        const firstTeams = new Set(
          seed.teamMembers
            .filter(({ userKey }) => userKey === first)
            .map(({ teamId }) => teamId),
        );
        const sameTeam = seed.teamMembers.some(
          ({ teamId, userKey }) => userKey === second && firstTeams.has(teamId),
        );
        if (!accepted.has(pair) && !sameTeam)
          issue(
            ["directMessages", index, "users"],
            "친구나 같은 팀 사이에만 DM을 만들 수 있어요.",
          );
        let previous = Number.POSITIVE_INFINITY;
        direct.messages.forEach(({ authorKey, minutesAgo }, messageIndex) => {
          const path = ["directMessages", index, "messages", messageIndex];
          userExists(authorKey, [...path, "authorKey"]);
          if (!direct.users.includes(authorKey))
            issue([...path, "authorKey"], "DM 참여자만 작성할 수 있어요.");
          if (minutesAgo >= previous)
            issue(
              [...path, "minutesAgo"],
              "DM 시각은 오래된 것부터 차례로 정해야 해요.",
            );
          previous = minutesAgo;
        });
      });
    })
    .safeParse(input);
  if (!result.success)
    throw new SeedError(
      `사람 시드 데이터 검증 실패: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  const { usernames, friendships, directMessages } = result.data;
  return { usernames, friendships, directMessages };
}

export type SeedPeopleData = ReturnType<typeof parseSeedPeople>;
export function loadSeedPeople(seed: PeopleSeedReferences): SeedPeopleData {
  return parseSeedPeople(peopleFile, seed);
}
