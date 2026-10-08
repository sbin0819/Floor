import { z } from "zod";
import peopleFile from "@/docs/spec/examples/seed-people-2.json";
import { messageBodySchema } from "@/features/chat/schema";
import type { SeedData } from "./data";
import { SeedError } from "./errors";
import type { SeedPeopleData } from "./people";

type References = Pick<SeedData, "users" | "teamMembers">;
const key = z.string().min(1);
const minutesAgo = z.int().nonnegative();
const message = z.strictObject({ minutesAgo, body: messageBodySchema });
const schema = z.strictObject({
  note: z.string(),
  statuses: z.array(
    z.strictObject({ userKey: key, status: z.enum(["online", "away", "dnd"]) }),
  ),
  groupDirectMessages: z.array(
    z.strictObject({
      name: z
        .string()
        .trim()
        .refine((value) => [...value].length <= 30)
        .optional(),
      createdBy: key,
      members: z.array(key).min(3).max(10),
      minutesAgo,
      messages: z.array(message.extend({ authorKey: key })),
    }),
  ),
  messageRequests: z.array(
    z.strictObject({
      from: key,
      to: key,
      messages: z.array(message).min(1).max(3),
    }),
  ),
});
const pairKey = (a: string, b: string) => JSON.stringify([a, b].sort());

export function parseSeedPeople2(
  input: unknown,
  seed: References,
  people: SeedPeopleData,
) {
  const result = schema
    .superRefine((data, context) => {
      const users = new Set(seed.users.map(({ key }) => key));
      const accepted = new Set(
        people.friendships
          .filter(({ status }) => status === "accepted")
          .map(({ requestedBy, to }) => pairKey(requestedBy, to)),
      );
      const directPairs = new Set(
        people.directMessages.map(({ users }) => pairKey(...users)),
      );
      const issue = (path: (string | number)[], message: string) =>
        context.addIssue({ code: "custom", path, message });
      const exists = (userKey: string, path: (string | number)[]) => {
        if (!users.has(userKey)) issue(path, "시드에 없는 사용자예요.");
      };
      const related = (a: string, b: string) => {
        const teams = new Set(
          seed.teamMembers
            .filter(({ userKey }) => userKey === a)
            .map(({ teamId }) => teamId),
        );
        return (
          accepted.has(pairKey(a, b)) ||
          seed.teamMembers.some(
            ({ userKey, teamId }) => userKey === b && teams.has(teamId),
          )
        );
      };
      const statusUsers = new Set<string>();
      data.statuses.forEach(({ userKey }, index) => {
        exists(userKey, ["statuses", index, "userKey"]);
        if (statusUsers.has(userKey))
          issue(["statuses", index], "한 사람의 상태가 두 번 있어요.");
        statusUsers.add(userKey);
      });
      data.groupDirectMessages.forEach((group, index) => {
        const path = ["groupDirectMessages", index];
        exists(group.createdBy, [...path, "createdBy"]);
        const members = new Set(group.members);
        if (members.size !== group.members.length)
          issue([...path, "members"], "그룹 멤버가 겹쳐요.");
        if (!members.has(group.createdBy))
          issue([...path, "members"], "만든 사람이 멤버에 있어야 해요.");
        group.members.forEach((member, memberIndex) => {
          exists(member, [...path, "members", memberIndex]);
          if (member !== group.createdBy && !related(group.createdBy, member))
            issue(
              [...path, "members", memberIndex],
              "만든 사람의 친구나 같은 팀만 넣을 수 있어요.",
            );
        });
        let previous = group.minutesAgo;
        group.messages.forEach(({ authorKey, minutesAgo }, messageIndex) => {
          if (!members.has(authorKey))
            issue(
              [...path, "messages", messageIndex, "authorKey"],
              "그룹 멤버만 작성할 수 있어요.",
            );
          if (minutesAgo >= previous)
            issue(
              [...path, "messages", messageIndex, "minutesAgo"],
              "만든 뒤 오래된 메시지부터 차례로 정해야 해요.",
            );
          previous = minutesAgo;
        });
      });
      const requestPairs = new Set<string>();
      data.messageRequests.forEach((request, index) => {
        const path = ["messageRequests", index];
        exists(request.from, [...path, "from"]);
        exists(request.to, [...path, "to"]);
        const pair = pairKey(request.from, request.to);
        if (request.from === request.to || related(request.from, request.to))
          issue(path, "친구도 같은 팀도 아닌 서로 다른 사람이어야 해요.");
        if (directPairs.has(pair) || requestPairs.has(pair))
          issue(path, "같은 DM이나 메시지 요청이 이미 있어요.");
        requestPairs.add(pair);
        let previous = Number.POSITIVE_INFINITY;
        request.messages.forEach(({ minutesAgo }, messageIndex) => {
          if (minutesAgo >= previous)
            issue(
              [...path, "messages", messageIndex, "minutesAgo"],
              "오래된 메시지부터 차례로 정해야 해요.",
            );
          previous = minutesAgo;
        });
      });
    })
    .safeParse(input);
  if (!result.success)
    throw new SeedError(
      `사람 2차 시드 데이터 검증 실패: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  const { statuses, groupDirectMessages, messageRequests } = result.data;
  return { statuses, groupDirectMessages, messageRequests };
}

export type SeedPeople2Data = ReturnType<typeof parseSeedPeople2>;
export function loadSeedPeople2(seed: References, people: SeedPeopleData) {
  return parseSeedPeople2(peopleFile, seed, people);
}
