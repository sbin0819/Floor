import { describe, expect, it } from "vitest";
import inputFile from "@/docs/spec/examples/seed-people-2.json";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedPeople } from "@/lib/seed/people";
import { loadSeedPeople2, parseSeedPeople2 } from "@/lib/seed/people-2";
import { SeedError } from "@/lib/seed/errors";

const seed = loadSeedData();
const people = loadSeedPeople(seed);
type Input = typeof inputFile;
describe("strict group and message-request seed", () => {
  it("loads chosen statuses, eligible groups and unrelated message requests", () => {
    const result = loadSeedPeople2(seed, people);
    expect(result.statuses).toEqual([
      { userKey: "designAdmin", status: "dnd" },
      { userKey: "test6", status: "away" },
      { userKey: "test17", status: "away" },
    ]);
    expect(result.groupDirectMessages).toHaveLength(2);
    expect(result.groupDirectMessages[0]?.messages).toHaveLength(4);
    expect(result.messageRequests).toHaveLength(2);
    expect(result).not.toHaveProperty("note");
  });
  it("permits an unnamed group with only its creation message", () => {
    const file = structuredClone(inputFile);
    const group = {
      ...file.groupDirectMessages[0]!,
      name: undefined,
      messages: [],
    };
    expect(
      parseSeedPeople2({ ...file, groupDirectMessages: [group] }, seed, people)
        .groupDirectMessages[0],
    ).toMatchObject({ name: undefined, messages: [] });
  });
  it("trims a Unicode group name and text without changing the source", () => {
    const file = structuredClone(inputFile);
    file.groupDirectMessages[0]!.name = ` ${"😀".repeat(30)} `;
    file.messageRequests[0]!.messages[0]!.body = ` ${"😀".repeat(4000)}\n`;
    const original = structuredClone(file);
    const result = parseSeedPeople2(file, seed, people);
    expect(result.groupDirectMessages[0]!.name).toBe("😀".repeat(30));
    expect(result.messageRequests[0]!.messages[0]!.body).toBe(
      "😀".repeat(4000),
    );
    expect(file).toEqual(original);
  });
  const invalid: { name: string; change: (file: Input) => void }[] = [
    {
      name: "extra root property",
      change: (file) => Object.assign(file, { extra: true }),
    },
    {
      name: "extra status property",
      change: (file) => Object.assign(file.statuses[0]!, { extra: true }),
    },
    {
      name: "extra group property",
      change: (file) =>
        Object.assign(file.groupDirectMessages[0]!, { extra: true }),
    },
    {
      name: "extra group message property",
      change: (file) =>
        Object.assign(file.groupDirectMessages[0]!.messages[0]!, {
          extra: true,
        }),
    },
    {
      name: "extra request property",
      change: (file) =>
        Object.assign(file.messageRequests[0]!, { extra: true }),
    },
    {
      name: "extra request message property",
      change: (file) =>
        Object.assign(file.messageRequests[0]!.messages[0]!, {
          authorKey: "member",
        }),
    },
    {
      name: "unknown status user",
      change: (file) => {
        file.statuses[0]!.userKey = "missing";
      },
    },
    {
      name: "unknown creator",
      change: (file) => {
        file.groupDirectMessages[0]!.createdBy = "missing";
      },
    },
    {
      name: "unknown member",
      change: (file) => {
        file.groupDirectMessages[0]!.members[1] = "missing";
      },
    },
    {
      name: "unknown request sender",
      change: (file) => {
        file.messageRequests[0]!.from = "missing";
      },
    },
    {
      name: "unknown request recipient",
      change: (file) => {
        file.messageRequests[0]!.to = "missing";
      },
    },
    {
      name: "duplicate status",
      change: (file) => {
        file.statuses.push(file.statuses[0]!);
      },
    },
    {
      name: "offline stored status",
      change: (file) => {
        file.statuses[0]!.status = "offline";
      },
    },
    {
      name: "duplicate group member",
      change: (file) => {
        file.groupDirectMessages[0]!.members.push("both");
      },
    },
    {
      name: "two group members",
      change: (file) => {
        file.groupDirectMessages[0]!.members.pop();
      },
    },
    {
      name: "eleven group members",
      change: (file) => {
        file.groupDirectMessages[0]!.members = Array(11).fill("both");
      },
    },
    {
      name: "creator missing from members",
      change: (file) => {
        file.groupDirectMessages[0]!.members[0] = "member";
      },
    },
    {
      name: "unrelated group member",
      change: (file) => {
        file.groupDirectMessages[0]!.members[1] = "growthAdmin";
      },
    },
    {
      name: "nonmember author",
      change: (file) => {
        file.groupDirectMessages[0]!.messages[0]!.authorKey = "member";
      },
    },
    {
      name: "31 character name",
      change: (file) => {
        file.groupDirectMessages[0]!.name = "😀".repeat(31);
      },
    },
    {
      name: "text at group creation",
      change: (file) => {
        file.groupDirectMessages[0]!.messages[0]!.minutesAgo = 600;
      },
    },
    {
      name: "unordered group messages",
      change: (file) => {
        file.groupDirectMessages[0]!.messages[1]!.minutesAgo = 599;
      },
    },
    {
      name: "negative creation time",
      change: (file) => {
        file.groupDirectMessages[0]!.minutesAgo = -1;
      },
    },
    {
      name: "fractional timestamp",
      change: (file) => {
        file.messageRequests[0]!.messages[0]!.minutesAgo = 1.5;
      },
    },
    {
      name: "self request",
      change: (file) => {
        file.messageRequests[0]!.to = "growthAdmin";
      },
    },
    {
      name: "same-team request",
      change: (file) => {
        file.messageRequests[0]!.to = "both";
      },
    },
    {
      name: "accepted-friend request",
      change: (file) => {
        file.messageRequests[0]!.from = "member";
      },
    },
    {
      name: "repeated reversed pair",
      change: (file) => {
        const row = file.messageRequests[0]!;
        file.messageRequests.push({ ...row, from: row.to, to: row.from });
      },
    },
    {
      name: "no request message",
      change: (file) => {
        file.messageRequests[0]!.messages = [];
      },
    },
    {
      name: "four request messages",
      change: (file) => {
        file.messageRequests[0]!.messages = [120, 119, 118, 117].map(
          (minutesAgo) => ({ minutesAgo, body: "hello" }),
        );
      },
    },
    {
      name: "unordered request messages",
      change: (file) => {
        file.messageRequests[0]!.messages.push({
          minutesAgo: 120,
          body: "same instant",
        });
      },
    },
    {
      name: "blank body",
      change: (file) => {
        file.messageRequests[0]!.messages[0]!.body = " \n ";
      },
    },
    {
      name: "overlong body",
      change: (file) => {
        file.groupDirectMessages[0]!.messages[0]!.body = "😀".repeat(4001);
      },
    },
  ];
  it.each(invalid)("rejects $name before writes", ({ change }) => {
    const file = structuredClone(inputFile);
    change(file);
    expect(() => parseSeedPeople2(file, seed, people)).toThrow(SeedError);
  });
  it("rejects a requested pair already specified by the prior DM source", () => {
    const prior = {
      ...people,
      directMessages: [
        ...people.directMessages,
        {
          users: ["growthAdmin", "designMember"] as [string, string],
          messages: [],
        },
      ],
    };
    expect(() => parseSeedPeople2(inputFile, seed, prior)).toThrow(SeedError);
  });
});
