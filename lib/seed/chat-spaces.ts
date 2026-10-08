import { createHash } from "node:crypto";
import type { DalDatabase } from "@/lib/dal/database";
import {
  inspectChatSpacesSeedCapacity,
  insertChatSpacesSeedBundle,
  lockChatSpacesSeedTargets,
  prepareChatSpacesSeedDatabase,
  readChatSpacesSeedState,
  type ChatSpacesSeedBundle,
  type ChatSpacesSeedState,
} from "@/lib/dal/seed-chat-spaces-additive";
import { preflightChatSpacesMigrations } from "@/lib/dal/seed-chat-spaces-audit";
import type { SeedData } from "./data";
import { seedCommunityVoiceId, type SeedSpacesData } from "./spaces";
import {
  hashChatSpacesValue,
  validateChatSpacesOptions,
  type ChatSpacesOptions,
  type ChatSpacesReceipt,
} from "./chat-spaces-receipt";
import type { SeedResult } from "./run-seed";
import { SeedError } from "./errors";

function stop(message: string): never {
  throw new SeedError(
    `스페이스 추가: ${message} 자동으로 복구하거나 덮어쓰지 않았어요.`,
  );
}

export function seedChatSpacesMessageId(
  namespaceId: string,
  name: string,
): string {
  const bytes = createHash("sha1")
    .update(Buffer.from(namespaceId.replaceAll("-", ""), "hex"))
    .update(name)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function chatSpacesSeedManifest(data: SeedData, spaces: SeedSpacesData) {
  // 이 전용 모드는 승인한 1개 라운지 + 1개 커뮤니티의 추가량만 허용한다.
  if (
    data.branches.length !== 5 ||
    spaces.loungeMembers.length !== 1 ||
    spaces.loungeMembers[0]!.userKeys.length !== 3 ||
    spaces.loungeMessages.length !== 2 ||
    spaces.communities.length !== 1 ||
    spaces.communities[0]!.channels.length !== 2 ||
    spaces.communities[0]!.messages.length !== 4
  )
    stop("승인한 스페이스 추가 범위와 원본이 달라요.");
  const community = spaces.communities[0]!;
  if (1 + community.adminKeys.length + community.memberKeys.length !== 3)
    stop("커뮤니티 멤버 범위가 달라요.");
  const keys = [
    ...new Set([
      ...spaces.loungeMembers.flatMap((row) => row.userKeys),
      community.ownerKey,
      ...community.adminKeys,
      ...community.memberKeys,
    ]),
  ].sort();
  const accounts = keys.map((key) => {
    const account = data.users.find((row) => row.key === key);
    if (!account) stop("원본 계정 참조가 없어요.");
    return { key, email: account.email };
  });
  const loungeMessages = spaces.loungeMessages.map((entry, index) => ({
    ...entry,
    id: seedChatSpacesMessageId(
      entry.branchId,
      `floor:seed:chat-spaces:v1:lounge-message:${index}`,
    ),
  }));
  const communityMessages = community.channels.flatMap((channel) =>
    community.messages
      .filter((entry) => entry.channel === channel.name)
      .map((entry, index) => ({
        ...entry,
        roomId: channel.id,
        id: seedChatSpacesMessageId(
          community.id,
          `floor:seed:chat-spaces:v1:community-message:${channel.id}:${index}`,
        ),
      })),
  );
  const roomIds = [
    ...community.channels.map((row) => row.id),
    seedCommunityVoiceId(community.id),
  ];
  const messageIds = [...loungeMessages, ...communityMessages].map(
    (row) => row.id,
  );
  const fixedIds = [community.id, ...roomIds, ...messageIds];
  if (new Set(fixedIds).size !== fixedIds.length)
    stop("고정 식별자가 서로 겹쳐요.");
  const branchIds = data.branches.map((row) => row.id).sort();
  return {
    keys,
    accounts,
    branchIds,
    community,
    roomIds,
    messageIds,
    loungeMessages,
    communityMessages,
    references: {
      branchIds,
      fixedIds,
      userEmails: accounts.map((row) => row.email),
    },
    hash: hashChatSpacesValue({
      version: 1,
      algorithm: "uuid-v5-sha1-chat-spaces-v1",
      branchIds,
      spaces,
      accounts,
    }),
  };
}
type Manifest = ReturnType<typeof chatSpacesSeedManifest>;
type Lounge = ChatSpacesReceipt["lounges"][number];

function firstLounges(
  manifest: Manifest,
  state: ChatSpacesSeedState,
  spaces: SeedSpacesData,
): Lounge[] {
  const result: Lounge[] = [];
  for (const branchId of manifest.branchIds) {
    const space = state.spaceRows.find((row) => row.branchId === branchId);
    if (
      !space ||
      space.kind !== "branch" ||
      space.teamId !== null ||
      space.deletedAt !== null
    )
      stop("기존 지점 라운지를 확인할 수 없어요.");
    const rooms = state.roomRows.filter((row) => row.spaceId === space.id);
    for (const expected of [
      { kind: "text", name: "라운지", adminOnly: false, voiceCapacity: null },
      { kind: "text", name: "공지", adminOnly: true, voiceCapacity: null },
      {
        kind: "voice",
        name: "라운지-음성",
        adminOnly: false,
        voiceCapacity: 10,
      },
    ]) {
      const matches = rooms.filter((row) => row.name === expected.name);
      if (
        matches.length !== 1 ||
        matches[0]!.kind !== expected.kind ||
        matches[0]!.archivedAt !== null ||
        matches[0]!.adminOnly !== expected.adminOnly ||
        matches[0]!.voiceCapacity !== expected.voiceCapacity
      )
        stop("기존 라운지의 기본 채널 구성이 달라요.");
    }
    if (spaces.loungeMembers.some((row) => row.branchId === branchId)) {
      if (
        rooms.length !== 3 ||
        rooms.some((row) => row.lastSeq !== 0 || row.lastMessageAt !== null)
      )
        stop("대상 라운지에 이미 대화나 채널 변경 흔적이 있어요.");
      result.push({
        branchId,
        spaceId: space.id,
        roomId: rooms.find((row) => row.name === "라운지")!.id,
      });
    }
  }
  if (result.length !== spaces.loungeMembers.length)
    stop("대상 라운지 참조가 일치하지 않아요.");
  return result;
}

function firstAccounts(manifest: Manifest, state: ChatSpacesSeedState) {
  return new Map(
    manifest.accounts.map((account) => {
      const user = state.userRows.find((row) => row.email === account.email);
      if (!user?.emailVerified) stop("필요한 기존 인증 완료 계정이 없어요.");
      return [account.key, user.id];
    }),
  );
}

function checkNoTrace(manifest: Manifest, state: ChatSpacesSeedState) {
  const fixed = new Set(manifest.references.fixedIds);
  if (
    state.spaceRows.some((row) => fixed.has(row.id)) ||
    state.roomRows.some((row) => fixed.has(row.id)) ||
    state.messageRows.length
  )
    stop("고정 식별자의 기존 데이터나 부분 적용 흔적이 있어요.");
}

function buildBundle(
  manifest: Manifest,
  spaces: SeedSpacesData,
  lounges: Lounge[],
  ids: ReadonlyMap<string, string>,
  now: Date,
): ChatSpacesSeedBundle {
  const user = (key: string) => {
    const id = ids.get(key);
    if (!id) stop("완료 기록의 계정 식별자가 일치하지 않아요.");
    return id;
  };
  const instant = (minutesAgo: number, offset = 0) => {
    const date = new Date(now.getTime() - minutesAgo * 60_000 + offset);
    if (!Number.isFinite(date.getTime()))
      stop("기준 시각에서 메시지 시각을 계산할 수 없어요.");
    return date;
  };
  const joined = (
    key: string,
    entries: readonly { authorKey: string; minutesAgo: number }[],
  ) => {
    const authored = entries.filter((row) => row.authorKey === key);
    return authored.length
      ? instant(Math.max(...authored.map((row) => row.minutesAgo)), -1)
      : now;
  };
  const community = manifest.community;
  const createdAt = instant(
    Math.max(...community.messages.map((row) => row.minutesAgo)),
    -1,
  );
  const lounge = lounges[0]!;
  const messageRows = [
    ...manifest.loungeMessages.map((row, index) => ({
      id: row.id,
      clientId: row.id,
      roomId: lounge.roomId,
      seq: index + 1,
      authorId: user(row.authorKey),
      kind: "text" as const,
      body: row.body,
      createdAt: instant(row.minutesAgo),
    })),
    ...community.channels.flatMap((channel) =>
      manifest.communityMessages
        .filter((row) => row.roomId === channel.id)
        .map((row, index) => ({
          id: row.id,
          clientId: row.id,
          roomId: channel.id,
          seq: index + 1,
          authorId: user(row.authorKey),
          kind: "text" as const,
          body: row.body,
          createdAt: instant(row.minutesAgo),
        })),
    ),
  ];
  const lastByAuthor = new Map(
    messageRows.map((row) => [`${row.roomId}:${row.authorId}`, row]),
  );
  const rooms = community.channels.map((channel) => {
    const entries = messageRows.filter((row) => row.roomId === channel.id);
    return {
      id: channel.id,
      spaceId: community.id,
      kind: "text" as const,
      name: channel.name,
      createdAt,
      lastSeq: entries.length,
      lastMessageAt: entries.at(-1)?.createdAt ?? null,
    };
  });
  const memberRows = [
    { key: community.ownerKey, role: "owner" as const },
    ...community.adminKeys.map((key) => ({ key, role: "admin" as const })),
    ...community.memberKeys.map((key) => ({ key, role: "member" as const })),
  ];
  const loungeLast = messageRows
    .filter((row) => row.roomId === lounge.roomId)
    .at(-1)!;
  return {
    spaces: [
      {
        id: community.id,
        kind: "community",
        name: community.name,
        iconColor: community.iconColor,
        createdBy: user(community.ownerKey),
        createdAt,
      },
    ],
    rooms: [
      ...rooms,
      {
        id: seedCommunityVoiceId(community.id),
        spaceId: community.id,
        kind: "voice",
        name: "음성",
        voiceCapacity: 10,
        createdAt,
        lastSeq: 0,
        lastMessageAt: null,
      },
    ],
    members: [
      ...spaces.loungeMembers[0]!.userKeys.map((key) => {
        const at = joined(key, spaces.loungeMessages);
        return {
          spaceId: lounge.spaceId,
          userId: user(key),
          role: "member" as const,
          status: "active" as const,
          joinedAt: at,
          statusChangedAt: at,
          createdAt: at,
        };
      }),
      ...memberRows.map(({ key, role }) => {
        const at = joined(key, community.messages);
        return {
          spaceId: community.id,
          userId: user(key),
          role,
          status: "active" as const,
          joinedAt: at,
          statusChangedAt: at,
          createdAt: at,
        };
      }),
    ],
    messages: messageRows,
    reads: [...lastByAuthor.values()].map((row) => ({
      roomId: row.roomId,
      userId: row.authorId,
      lastReadSeq: row.seq,
      muted: false,
      updatedAt: now,
      createdAt: row.createdAt,
    })),
    lounge: {
      id: lounge.roomId,
      spaceId: lounge.spaceId,
      lastSeq: loungeLast.seq,
      lastMessageAt: loungeLast.createdAt,
    },
  };
}

function anchors(
  manifest: Manifest,
  state: ChatSpacesSeedState,
  lounges: Lounge[],
) {
  const spaceIds = [
    manifest.community.id,
    ...lounges.map((row) => row.spaceId),
  ];
  const roomIds = [...manifest.roomIds, ...lounges.map((row) => row.roomId)];
  const sorted = <T extends { id: string }>(rows: T[]) =>
    rows.sort((a, b) => a.id.localeCompare(b.id));
  return {
    spaces: sorted(
      state.spaceRows
        .filter((row) => spaceIds.includes(row.id))
        .map(({ id, kind, branchId, createdBy, createdAtRaw }) => ({
          id,
          kind,
          branchId,
          createdBy,
          createdAt: createdAtRaw,
        })),
    ),
    rooms: sorted(
      state.roomRows
        .filter((row) => roomIds.includes(row.id))
        .map(({ id, kind, spaceId, createdAtRaw }) => ({
          id,
          kind,
          spaceId,
          createdAt: createdAtRaw,
        })),
    ),
    messages: sorted(
      state.messageRows
        .filter((row) => manifest.messageIds.includes(row.id))
        .map(({ id, roomId, seq, authorId, kind, clientId, createdAtRaw }) => ({
          id,
          roomId,
          seq,
          authorId,
          kind,
          clientId,
          createdAt: createdAtRaw,
        })),
    ),
  };
}

function verifyReceipt(
  manifest: Manifest,
  state: ChatSpacesSeedState,
  spaces: SeedSpacesData,
  receipt: ChatSpacesReceipt,
) {
  if (
    receipt.manifestHash !== manifest.hash ||
    receipt.lounges.length !== spaces.loungeMembers.length ||
    receipt.lounges.some(
      (row) =>
        !spaces.loungeMembers.some(
          (expected) => expected.branchId === row.branchId,
        ),
    )
  )
    stop("완료 기록의 원본 범위가 달라요.");
  const ids = new Map<string, string>();
  for (const expected of [
    ...manifest.loungeMessages,
    ...manifest.communityMessages,
  ]) {
    const row = state.messageRows.find((row) => row.id === expected.id);
    if (
      !row?.authorId ||
      (ids.has(expected.authorKey) &&
        ids.get(expected.authorKey) !== row.authorId)
    )
      stop("완료 메시지의 작성자 식별자가 달라요.");
    ids.set(expected.authorKey, row.authorId);
  }
  const expected = buildBundle(
    manifest,
    spaces,
    receipt.lounges,
    ids,
    new Date(receipt.appliedAt),
  );
  for (const lounge of receipt.lounges) {
    const space = state.spaceRows.find((row) => row.id === lounge.spaceId);
    const room = state.roomRows.find((row) => row.id === lounge.roomId);
    if (
      space?.kind !== "branch" ||
      space.branchId !== lounge.branchId ||
      room?.kind !== "text" ||
      room.spaceId !== lounge.spaceId
    )
      stop("완료 라운지의 부모 관계가 달라요.");
  }
  for (const row of expected.spaces) {
    const stored = state.spaceRows.find((item) => item.id === row.id);
    if (
      !stored ||
      stored.kind !== row.kind ||
      stored.createdBy !== row.createdBy ||
      stored.createdAt.getTime() !== row.createdAt!.getTime()
    )
      stop("완료 커뮤니티의 식별 정보가 달라요.");
  }
  for (const row of expected.rooms) {
    const stored = state.roomRows.find((item) => item.id === row.id);
    if (
      !stored ||
      stored.kind !== row.kind ||
      stored.spaceId !== row.spaceId ||
      stored.createdAt.getTime() !== row.createdAt!.getTime()
    )
      stop("완료 채널의 식별 정보가 달라요.");
  }
  for (const row of expected.messages) {
    const stored = state.messageRows.find((item) => item.id === row.id);
    if (
      !stored ||
      stored.roomId !== row.roomId ||
      stored.seq !== row.seq ||
      stored.authorId !== row.authorId ||
      stored.kind !== row.kind ||
      stored.clientId !== row.clientId ||
      stored.createdAt.getTime() !== row.createdAt!.getTime()
    )
      stop("완료 메시지의 식별 정보가 달라요.");
  }
  const captured = anchors(manifest, state, receipt.lounges);
  if (
    captured.spaces.length !== 2 ||
    captured.rooms.length !== 4 ||
    captured.messages.length !== 6 ||
    hashChatSpacesValue(captured) !== receipt.bundleHash
  )
    stop("완료 묶음이 없거나 불변 식별 정보가 달라요.");
}

export async function applyChatSpacesSeed(
  input: ChatSpacesOptions & {
    data: SeedData;
    spaces: SeedSpacesData;
    now: Date;
  },
  database: DalDatabase,
): Promise<SeedResult> {
  const receipt = validateChatSpacesOptions(input);
  if (
    !Number.isFinite(input.now.getTime()) ||
    (receipt && new Date(receipt.appliedAt) > input.now)
  )
    stop("완료 기록이나 기준 시각이 올바르지 않아요.");
  const manifest = chatSpacesSeedManifest(input.data, input.spaces);
  await prepareChatSpacesSeedDatabase(input.databaseName, database);
  if ((await preflightChatSpacesMigrations(database)) !== 0)
    stop("먼저 저장소의 최신 마이그레이션을 적용해 주세요.");
  const references = receipt
    ? { ...manifest.references, userEmails: [] }
    : manifest.references;
  let state = await readChatSpacesSeedState(references, database);
  if (receipt) {
    verifyReceipt(manifest, state, input.spaces, receipt);
    return {
      counts: {},
      accounts: [],
      skippedBookings: 0,
      chatSpaces: { applied: false, receipt },
    };
  }
  const lounges = firstLounges(manifest, state, input.spaces);
  const ids = firstAccounts(manifest, state);
  checkNoTrace(manifest, state);
  await lockChatSpacesSeedTargets([...ids.values()], lounges[0]!, database);
  state = await readChatSpacesSeedState(references, database);
  const currentLounges = firstLounges(manifest, state, input.spaces);
  const currentIds = firstAccounts(manifest, state);
  if (
    hashChatSpacesValue(lounges) !== hashChatSpacesValue(currentLounges) ||
    hashChatSpacesValue([...ids]) !== hashChatSpacesValue([...currentIds])
  )
    stop("잠금 뒤 라운지나 계정 참조가 바뀌었어요.");
  checkNoTrace(manifest, state);
  const capacity = await inspectChatSpacesSeedCapacity(
    [...ids.values()],
    lounges[0]!.spaceId,
    database,
  );
  if (!capacity.pristine)
    stop("대상 라운지에 기존 소속·대화·읽음 등 사용 흔적이 있어요.");
  const bundle = buildBundle(manifest, input.spaces, lounges, ids, input.now);
  for (const row of capacity.memberships) {
    const added = bundle.members.filter(
      (member) => member.userId === row.id,
    ).length;
    const owned = bundle.members.filter(
      (member) => member.userId === row.id && member.role === "owner",
    ).length;
    if (row.joined + added > 100 || row.owned + owned > 10)
      stop("기존 계정의 스페이스 가입 또는 커뮤니티 소유 한도를 넘어요.");
  }
  await insertChatSpacesSeedBundle(bundle, database);
  const applied = await readChatSpacesSeedState(
    { ...references, userEmails: [] },
    database,
  );
  const completed: ChatSpacesReceipt = {
    version: 1,
    mode: "chat-spaces",
    targetHash: input.targetHash,
    manifestHash: manifest.hash,
    appliedAt: input.now.toISOString(),
    bundleHash: hashChatSpacesValue(anchors(manifest, applied, lounges)),
    lounges,
  };
  verifyReceipt(manifest, applied, input.spaces, completed);
  return {
    counts: {
      communitySpaces: 1,
      chatRooms: 3,
      spaceMembers: 6,
      chatMessages: 6,
      chatRoomReads: 6,
    },
    accounts: [],
    skippedBookings: 0,
    chatSpaces: { applied: true, receipt: completed },
  };
}
