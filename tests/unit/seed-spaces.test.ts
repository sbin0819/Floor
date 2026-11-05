import { describe, expect, it } from "vitest";
import file from "@/docs/spec/examples/seed-spaces.json";
import { loadSeedData } from "@/lib/seed/data";
import { SeedError } from "@/lib/seed/errors";
import {
  loadSeedSpaces,
  parseSeedSpaces,
  seedCommunityVoiceId,
  selectSeedLounges,
} from "@/lib/seed/spaces";

const seed = loadSeedData();
type Input = typeof file;

describe("strict lounge and community seed", () => {
  it("derives the same UUID v5 voice channel from the community ID", () => {
    const id = file.communities[0]!.id;
    const voice = seedCommunityVoiceId(id);
    expect(voice).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(seedCommunityVoiceId(id.toUpperCase())).toBe(voice);
    expect(seedCommunityVoiceId(crypto.randomUUID())).not.toBe(voice);
    expect(() => seedCommunityVoiceId("not-a-uuid")).toThrow();
  });
  it("loads every lounge with the operator, the spam report and two communities without the documentation note", () => {
    const data = loadSeedSpaces(seed);
    expect(data.loungeMembers).toHaveLength(seed.branches.length);
    for (const lounge of data.loungeMembers)
      expect(lounge.userKeys).toContain("admin");
    expect(data.loungeMembers[0]?.userKeys).toHaveLength(11);
    expect(data.loungeMessages).toHaveLength(20);
    expect(data.loungeReports).toEqual([
      expect.objectContaining({ messageIndex: 4, reason: "spam" }),
    ]);
    expect(data.communities).toHaveLength(2);
    expect(data.communities[0]?.channels).toHaveLength(2);
    expect(data.communities[0]?.messages).toHaveLength(7);
    expect(data).not.toHaveProperty("note");
  });
  it("allows empty scenarios and an owner-only community without messages", () => {
    expect(
      parseSeedSpaces(
        { note: "", loungeMembers: [], loungeMessages: [], communities: [] },
        seed,
      ),
    ).toEqual({
      loungeMembers: [],
      loungeMessages: [],
      loungeReports: [],
      communities: [],
    });
    const raw = structuredClone(file);
    Object.assign(raw.communities[0]!, {
      adminKeys: [],
      memberKeys: [],
      messages: [],
    });
    expect(parseSeedSpaces(raw, seed).communities[0]?.messages).toEqual([]);
  });
  it("counts body and community name length as Unicode code points", () => {
    const raw = structuredClone(file);
    raw.communities[0]!.name = ` ${"😀".repeat(30)} `;
    raw.loungeMessages[0]!.body = ` ${"😀".repeat(4000)} `;
    expect(parseSeedSpaces(raw, seed).loungeMessages[0]?.body).toBe(
      "😀".repeat(4000),
    );
    expect(raw.loungeMessages[0]!.body.startsWith(" ")).toBe(true);
  });
  it("selects lounge data only and never includes communities", () => {
    const data = loadSeedSpaces(seed);
    const gangnam = file.loungeMembers[0]!.branchId;
    expect(selectSeedLounges(data, [gangnam])).toEqual({
      loungeMembers: data.loungeMembers.filter(
        ({ branchId }) => branchId === gangnam,
      ),
      loungeMessages: data.loungeMessages.filter(
        ({ branchId }) => branchId === gangnam,
      ),
      loungeReports: data.loungeReports.filter(
        ({ branchId }) => branchId === gangnam,
      ),
      communities: [],
    });
    expect(selectSeedLounges(data, [])).toEqual({
      loungeMembers: [],
      loungeMessages: [],
      loungeReports: [],
      communities: [],
    });
  });

  const invalid: { name: string; change: (raw: Input) => void }[] = [
    {
      name: "default voice ID used by a text channel",
      change: (raw) => {
        raw.communities[0]!.channels[0]!.id = seedCommunityVoiceId(
          raw.communities[0]!.id,
        );
      },
    },
    {
      name: "default voice name used by a text channel",
      change: (raw) => {
        raw.communities[0]!.channels[1]!.name = "음성";
      },
    },
    {
      name: "unknown root key",
      change: (raw) => {
        Object.assign(raw, { extra: true });
      },
    },
    {
      name: "unknown lounge key",
      change: (raw) => {
        Object.assign(raw.loungeMembers[0]!, { extra: true });
      },
    },
    {
      name: "unknown lounge message key",
      change: (raw) => {
        Object.assign(raw.loungeMessages[0]!, { extra: true });
      },
    },
    {
      name: "unknown community key",
      change: (raw) => {
        Object.assign(raw.communities[0]!, { extra: true });
      },
    },
    {
      name: "unknown channel key",
      change: (raw) => {
        Object.assign(raw.communities[0]!.channels[0]!, { extra: true });
      },
    },
    {
      name: "unknown community message key",
      change: (raw) => {
        Object.assign(raw.communities[0]!.messages[0]!, { extra: true });
      },
    },
    {
      name: "unknown lounge branch",
      change: (raw) => {
        raw.loungeMembers[0]!.branchId = crypto.randomUUID();
      },
    },
    {
      name: "unknown lounge user",
      change: (raw) => {
        raw.loungeMembers[0]!.userKeys.push("missing");
      },
    },
    {
      name: "duplicate lounge branch",
      change: (raw) => {
        raw.loungeMembers.push(raw.loungeMembers[0]!);
      },
    },
    {
      name: "duplicate lounge member",
      change: (raw) => {
        raw.loungeMembers[0]!.userKeys.push("member");
      },
    },
    {
      name: "unknown message branch",
      change: (raw) => {
        raw.loungeMessages[0]!.branchId = crypto.randomUUID();
      },
    },
    {
      name: "nonmember lounge author",
      change: (raw) => {
        raw.loungeMessages[0]!.authorKey = "test6";
      },
    },
    {
      name: "unordered lounge message",
      change: (raw) => {
        raw.loungeMessages[1]!.minutesAgo = 240;
      },
    },
    {
      name: "negative message time",
      change: (raw) => {
        raw.loungeMessages[0]!.minutesAgo = -1;
      },
    },
    {
      name: "fractional message time",
      change: (raw) => {
        raw.loungeMessages[0]!.minutesAgo = 0.5;
      },
    },
    {
      name: "empty message",
      change: (raw) => {
        raw.loungeMessages[0]!.body = "  ";
      },
    },
    {
      name: "long message",
      change: (raw) => {
        raw.loungeMessages[0]!.body = "😀".repeat(4001);
      },
    },
    {
      name: "duplicate community",
      change: (raw) => {
        raw.communities.push(structuredClone(raw.communities[0]!));
      },
    },
    {
      name: "unknown owner",
      change: (raw) => {
        raw.communities[0]!.ownerKey = "missing";
      },
    },
    {
      name: "overlapping roles",
      change: (raw) => {
        raw.communities[0]!.adminKeys.push("member");
      },
    },
    {
      name: "duplicate member",
      change: (raw) => {
        raw.communities[0]!.memberKeys.push("both");
      },
    },
    {
      name: "unknown color",
      change: (raw) => {
        raw.communities[0]!.iconColor = "red";
      },
    },
    {
      name: "long community name",
      change: (raw) => {
        raw.communities[0]!.name = "😀".repeat(31);
      },
    },
    {
      name: "empty community name",
      change: (raw) => {
        raw.communities[0]!.name = "  ";
      },
    },
    {
      name: "missing default channel",
      change: (raw) => {
        raw.communities[0]!.channels[0]!.name = "다른-채널";
      },
    },
    {
      name: "empty channels",
      change: (raw) => {
        raw.communities[0]!.channels = [];
      },
    },
    {
      name: "duplicate channel ID",
      change: (raw) => {
        raw.communities[0]!.channels[1]!.id =
          raw.communities[0]!.channels[0]!.id;
      },
    },
    {
      name: "duplicate channel name",
      change: (raw) => {
        raw.communities[0]!.channels[1]!.name = "일반";
      },
    },
    {
      name: "non-normalized channel name",
      change: (raw) => {
        raw.communities[0]!.channels[1]!.name = " NEW Channel ";
      },
    },
    {
      name: "decomposed Korean channel name",
      change: (raw) => {
        raw.communities[0]!.channels[1]!.name = "공유".normalize("NFD");
      },
    },
    {
      name: "nonmember community author",
      change: (raw) => {
        raw.communities[0]!.messages[0]!.authorKey = "admin";
      },
    },
    {
      name: "unknown message channel",
      change: (raw) => {
        raw.communities[0]!.messages[0]!.channel = "없는-채널";
      },
    },
    {
      name: "unordered community message",
      change: (raw) => {
        raw.communities[0]!.messages[1]!.minutesAgo = 2880;
      },
    },
  ];
  it.each(invalid)("rejects $name", ({ change }) => {
    const raw = structuredClone(file);
    change(raw);
    expect(() => parseSeedSpaces(raw, seed)).toThrow(SeedError);
  });
});
