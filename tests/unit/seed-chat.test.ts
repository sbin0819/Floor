import { describe, expect, it } from "vitest";
import chatFile from "@/docs/spec/examples/seed-chat.json";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedChat, parseSeedChat } from "@/lib/seed/chat";
import { SeedError } from "@/lib/seed/errors";

const seed = loadSeedData();
type ChatFile = typeof chatFile;

describe("strict chat seed data", () => {
  it("loads a conversation for every team without changing the original seed contract", () => {
    const data = loadSeedChat(seed);
    expect(data.messages).toHaveLength(chatFile.messages.length);
    for (const team of seed.teams)
      expect(
        data.messages.filter(({ teamId }) => teamId === team.id).length,
      ).toBeGreaterThanOrEqual(2);
    expect(
      data.messages.filter(({ teamId }) => teamId === seed.teams[0]!.id),
    ).toHaveLength(8);
    expect(data).not.toHaveProperty("note");
    expect(seed).not.toHaveProperty("messages");
  });

  it("checks chronological order independently for interleaved teams", () => {
    const input = structuredClone(chatFile);
    // 디자인팀 메시지와 그로스팀 메시지를 번갈아 두어도 팀마다 시각 순서만 본다.
    const design = input.messages.filter(
      ({ teamId }) => teamId === seed.teams[0]!.id,
    );
    const growth = input.messages.filter(
      ({ teamId }) => teamId === seed.teams[1]!.id,
    );
    input.messages = [design[0]!, growth[0]!, design[1]!, growth[1]!];
    expect(parseSeedChat(input, seed).messages).toHaveLength(4);
  });

  it("allows an empty conversation and counts Unicode code points without mutating input", () => {
    expect(parseSeedChat({ ...chatFile, messages: [] }, seed)).toEqual({
      messages: [],
    });
    const input = structuredClone(chatFile);
    input.messages[0]!.body = `  ${"😀".repeat(4000)}\n`;
    const before = structuredClone(input);
    expect(parseSeedChat(input, seed).messages[0]!.body).toBe(
      "😀".repeat(4000),
    );
    expect(input).toEqual(before);
  });

  const invalidCases: { name: string; change: (input: ChatFile) => void }[] = [
    {
      name: "unknown root field",
      change: (input) => Object.assign(input, { extra: true }),
    },
    {
      name: "unknown message field",
      change: (input) => Object.assign(input.messages[0]!, { extra: true }),
    },
    {
      name: "unknown team",
      change: (input) => {
        input.messages[0]!.teamId = crypto.randomUUID();
      },
    },
    {
      name: "malformed team id",
      change: (input) => {
        input.messages[0]!.teamId = "missing";
      },
    },
    {
      name: "unknown author",
      change: (input) => {
        input.messages[0]!.authorKey = "missing";
      },
    },
    {
      name: "author outside the team",
      change: (input) => {
        input.messages[0]!.authorKey = "growthAdmin";
      },
    },
    {
      name: "later time before earlier time",
      change: (input) => {
        input.messages[1]!.minutesAgo = 1501;
      },
    },
    {
      name: "equal message times in the same team",
      change: (input) => {
        input.messages[1]!.minutesAgo = 1500;
      },
    },
    {
      name: "negative minutes",
      change: (input) => {
        input.messages[0]!.minutesAgo = -1;
      },
    },
    {
      name: "fractional minutes",
      change: (input) => {
        input.messages[0]!.minutesAgo = 1500.5;
      },
    },
    {
      name: "blank body",
      change: (input) => {
        input.messages[0]!.body = " \n ";
      },
    },
    {
      name: "4001 code points",
      change: (input) => {
        input.messages[0]!.body = "😀".repeat(4001);
      },
    },
  ];
  it.each(invalidCases)("rejects $name with SeedError", ({ change }) => {
    const input = structuredClone(chatFile);
    change(input);
    expect(() => parseSeedChat(input, seed)).toThrow(SeedError);
  });
});
