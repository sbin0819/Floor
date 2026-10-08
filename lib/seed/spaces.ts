import { z } from "zod";
import spacesFile from "@/docs/spec/examples/seed-spaces.json";
import {
  normalizeChannelName,
  spaceIconColors,
  spaceNameSchema,
} from "@/features/chat/space-schema";
import type { SeedData } from "./data";
import { SeedError } from "./errors";

const id = z.uuid().transform((value) => value.toLowerCase());
const userKey = z.string().min(1);
const body = z
  .string()
  .trim()
  .refine((value) => {
    const length = Array.from(value).length;
    return length >= 1 && length <= 4000;
  }, "본문은 1–4000자여야 해요.");
const channelName = z.string().refine((value) => {
  try {
    return normalizeChannelName(value) === value;
  } catch {
    return false;
  }
}, "채널 이름은 정규화된 이름이어야 해요.");
const seedSpacesSchema = z.strictObject({
  note: z.string(),
  loungeMembers: z.array(
    z.strictObject({ branchId: id, userKeys: z.array(userKey) }),
  ),
  loungeMessages: z.array(
    z.strictObject({
      branchId: id,
      authorKey: userKey,
      minutesAgo: z.int().nonnegative(),
      body,
    }),
  ),
  communities: z.array(
    z.strictObject({
      id,
      name: spaceNameSchema,
      iconColor: z.enum(spaceIconColors),
      ownerKey: userKey,
      adminKeys: z.array(userKey),
      memberKeys: z.array(userKey),
      channels: z
        .array(z.strictObject({ id, name: channelName }))
        .min(1)
        .max(50),
      messages: z.array(
        z.strictObject({
          channel: channelName,
          authorKey: userKey,
          minutesAgo: z.int().nonnegative(),
          body,
        }),
      ),
    }),
  ),
});

export function parseSeedSpaces(
  input: unknown,
  seed: Pick<SeedData, "users" | "branches">,
) {
  const parsed = seedSpacesSchema
    .superRefine((data, context) => {
      const users = new Set(seed.users.map(({ key }) => key));
      const branches = new Set(seed.branches.map(({ id }) => id));
      const issue = (path: (string | number)[], message: string) =>
        context.addIssue({ code: "custom", path, message });
      const checkUsers = (keys: string[], path: (string | number)[]) => {
        if (new Set(keys).size !== keys.length)
          issue(path, "멤버가 중복되거나 역할이 겹쳐요.");
        if (keys.some((key) => !users.has(key)))
          issue(path, "시드에 없는 사용자예요.");
      };
      const lounges = new Map<string, Set<string>>();
      data.loungeMembers.forEach((row, index) => {
        const path = ["loungeMembers", index];
        if (!branches.has(row.branchId))
          issue([...path, "branchId"], "시드에 없는 지점이에요.");
        if (lounges.has(row.branchId))
          issue([...path, "branchId"], "라운지 멤버 목록이 중복돼요.");
        checkUsers(row.userKeys, [...path, "userKeys"]);
        lounges.set(row.branchId, new Set(row.userKeys));
      });
      const previous = new Map<string, number>();
      data.loungeMessages.forEach((row, index) => {
        const path = ["loungeMessages", index];
        if (!branches.has(row.branchId))
          issue([...path, "branchId"], "시드에 없는 지점이에요.");
        if (!lounges.get(row.branchId)?.has(row.authorKey))
          issue([...path, "authorKey"], "작성자가 라운지 멤버가 아니에요.");
        const prior = previous.get(row.branchId);
        if (prior !== undefined && row.minutesAgo >= prior)
          issue(
            [...path, "minutesAgo"],
            "라운지마다 오래된 메시지부터 정해야 해요.",
          );
        previous.set(row.branchId, row.minutesAgo);
      });
      const spaceIds = new Set<string>();
      const roomIds = new Set<string>();
      data.communities.forEach((community, index) => {
        const path = ["communities", index];
        if (spaceIds.has(community.id))
          issue([...path, "id"], "커뮤니티 ID가 중복돼요.");
        spaceIds.add(community.id);
        const keys = [
          community.ownerKey,
          ...community.adminKeys,
          ...community.memberKeys,
        ];
        checkUsers(keys, path);
        if (keys.length > 200) issue(path, "커뮤니티 멤버는 200명까지예요.");
        const members = new Set(keys);
        const channels = new Set<string>();
        if (community.channels[0]?.name !== "일반")
          issue([...path, "channels", 0, "name"], "첫 채널은 일반이어야 해요.");
        community.channels.forEach((channel, channelIndex) => {
          if (roomIds.has(channel.id))
            issue(
              [...path, "channels", channelIndex, "id"],
              "채널 ID가 중복돼요.",
            );
          if (channels.has(channel.name))
            issue(
              [...path, "channels", channelIndex, "name"],
              "채널 이름이 중복돼요.",
            );
          roomIds.add(channel.id);
          channels.add(channel.name);
        });
        const previous = new Map<string, number>();
        community.messages.forEach((row, messageIndex) => {
          const messagePath = [...path, "messages", messageIndex];
          if (!channels.has(row.channel))
            issue([...messagePath, "channel"], "커뮤니티에 없는 채널이에요.");
          if (!members.has(row.authorKey))
            issue(
              [...messagePath, "authorKey"],
              "작성자가 커뮤니티 멤버가 아니에요.",
            );
          const prior = previous.get(row.channel);
          if (prior !== undefined && row.minutesAgo >= prior)
            issue(
              [...messagePath, "minutesAgo"],
              "채널마다 오래된 메시지부터 정해야 해요.",
            );
          previous.set(row.channel, row.minutesAgo);
        });
      });
    })
    .safeParse(input);
  if (!parsed.success)
    throw new SeedError(
      `스페이스 시드 데이터 검증 실패: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  const { loungeMembers, loungeMessages, communities } = parsed.data;
  return { loungeMembers, loungeMessages, communities };
}

export type SeedSpacesData = ReturnType<typeof parseSeedSpaces>;

export function loadSeedSpaces(
  seed: Pick<SeedData, "users" | "branches">,
): SeedSpacesData {
  return parseSeedSpaces(spacesFile, seed);
}

export function selectSeedLounges(
  data: SeedSpacesData,
  branchIds: readonly string[],
): SeedSpacesData {
  const selected = new Set(branchIds);
  return {
    loungeMembers: data.loungeMembers.filter(({ branchId }) =>
      selected.has(branchId),
    ),
    loungeMessages: data.loungeMessages.filter(({ branchId }) =>
      selected.has(branchId),
    ),
    communities: [],
  };
}
