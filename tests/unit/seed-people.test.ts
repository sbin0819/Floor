import { describe, expect, it } from "vitest";
import peopleFile from "@/docs/spec/examples/seed-people.json";
import { loadSeedData } from "@/lib/seed/data";
import { SeedError } from "@/lib/seed/errors";
import { loadSeedPeople, parseSeedPeople } from "@/lib/seed/people";

const seed = loadSeedData();
type PeopleFile = typeof peopleFile;
describe("strict people seed data", () => {
  it("loads a name for everyone but the operator, friendships in both states and valid direct conversations", () => {
    const result = loadSeedPeople(seed);
    expect(result.usernames).toHaveLength(peopleFile.usernames.length);
    expect(result.usernames.length).toBeGreaterThanOrEqual(15);
    expect(
      result.friendships.filter(({ status }) => status === "accepted"),
    ).toHaveLength(5);
    expect(
      result.friendships.filter(({ status }) => status === "pending"),
    ).toHaveLength(3);
    expect(result.directMessages).toHaveLength(5);
    expect(
      result.directMessages.flatMap(({ messages }) => messages),
    ).toHaveLength(12);
    expect(result).not.toHaveProperty("note");
    expect(result.usernames.some(({ userKey }) => userKey === "admin")).toBe(
      false,
    );
  });
  it("uses source friendship or shared team membership, independent of conversation order", () => {
    const input = structuredClone(peopleFile);
    input.directMessages.reverse();
    input.directMessages[0]!.users.reverse();
    expect(parseSeedPeople(input, seed).directMessages).toHaveLength(
      peopleFile.directMessages.length,
    );
  });
  it("counts Unicode code points, trims bodies and does not change the source object", () => {
    const input = structuredClone(peopleFile);
    input.directMessages[0]!.messages[0]!.body = `  ${"😀".repeat(4000)}\n`;
    const original = structuredClone(input);
    expect(
      parseSeedPeople(input, seed).directMessages[0]!.messages[0]!.body,
    ).toBe("😀".repeat(4000));
    expect(input).toEqual(original);
  });
  it("permits no people data while retaining a strict root shape", () => {
    expect(
      parseSeedPeople(
        { note: "empty", usernames: [], friendships: [], directMessages: [] },
        seed,
      ),
    ).toEqual({ usernames: [], friendships: [], directMessages: [] });
  });
  const invalid: { name: string; change: (file: PeopleFile) => void }[] = [
    {
      name: "extra root field",
      change: (file) => Object.assign(file, { extra: true }),
    },
    {
      name: "extra username field",
      change: (file) => Object.assign(file.usernames[0]!, { extra: true }),
    },
    {
      name: "extra friendship field",
      change: (file) => Object.assign(file.friendships[0]!, { extra: true }),
    },
    {
      name: "extra direct field",
      change: (file) => Object.assign(file.directMessages[0]!, { extra: true }),
    },
    {
      name: "extra message field",
      change: (file) =>
        Object.assign(file.directMessages[0]!.messages[0]!, { extra: true }),
    },
    {
      name: "unknown named user",
      change: (file) => {
        file.usernames[0]!.userKey = "missing";
      },
    },
    {
      name: "unknown requester",
      change: (file) => {
        file.friendships[0]!.requestedBy = "missing";
      },
    },
    {
      name: "unknown recipient",
      change: (file) => {
        file.friendships[0]!.to = "missing";
      },
    },
    {
      name: "unknown direct participant",
      change: (file) => {
        file.directMessages[0]!.users[0] = "missing";
      },
    },
    {
      name: "unknown author",
      change: (file) => {
        file.directMessages[0]!.messages[0]!.authorKey = "missing";
      },
    },
    {
      name: "nonparticipant author",
      change: (file) => {
        file.directMessages[0]!.messages[0]!.authorKey = "growthAdmin";
      },
    },
    {
      name: "duplicate username",
      change: (file) => {
        file.usernames[1]!.username = file.usernames[0]!.username;
      },
    },
    {
      name: "duplicate named user",
      change: (file) => {
        file.usernames[1]!.userKey = file.usernames[0]!.userKey;
      },
    },
    {
      name: "noncanonical username",
      change: (file) => {
        file.usernames[0]!.username = "Haeun";
      },
    },
    {
      name: "reserved username",
      change: (file) => {
        file.usernames[0]!.username = "everyone";
      },
    },
    {
      name: "self friendship",
      change: (file) => {
        file.friendships[0]!.to = file.friendships[0]!.requestedBy;
      },
    },
    {
      name: "duplicate reversed friendship",
      change: (file) => {
        const first = file.friendships[0]!;
        file.friendships.push({
          ...first,
          requestedBy: first.to,
          to: first.requestedBy,
        });
      },
    },
    {
      name: "unsupported friendship state",
      change: (file) => {
        file.friendships[0]!.status = "declined";
      },
    },
    {
      name: "same direct participant",
      change: (file) => {
        file.directMessages[0]!.users[1] = file.directMessages[0]!.users[0]!;
      },
    },
    {
      name: "third direct participant",
      change: (file) => {
        file.directMessages[0]!.users.push("both");
      },
    },
    {
      name: "duplicate reversed direct pair",
      change: (file) => {
        const first = structuredClone(file.directMessages[0]!);
        first.users.reverse();
        file.directMessages.push(first);
      },
    },
    {
      name: "pending relation without shared team",
      change: (file) => {
        file.friendships[0]!.status = "pending";
      },
    },
    {
      name: "empty conversation without a joined-at anchor",
      change: (file) => {
        file.directMessages[0]!.messages = [];
      },
    },
    {
      name: "out-of-order messages",
      change: (file) => {
        file.directMessages[0]!.messages[1]!.minutesAgo = 2001;
      },
    },
    {
      name: "equal message timestamps",
      change: (file) => {
        file.directMessages[0]!.messages[1]!.minutesAgo = 2000;
      },
    },
    {
      name: "negative friendship minutes",
      change: (file) => {
        file.friendships[0]!.minutesAgo = -1;
      },
    },
    {
      name: "fractional message minutes",
      change: (file) => {
        file.directMessages[0]!.messages[0]!.minutesAgo = 0.5;
      },
    },
    {
      name: "blank body",
      change: (file) => {
        file.directMessages[0]!.messages[0]!.body = " \n ";
      },
    },
    {
      name: "4001 code points",
      change: (file) => {
        file.directMessages[0]!.messages[0]!.body = "😀".repeat(4001);
      },
    },
  ];
  it.each(invalid)("rejects $name with SeedError", ({ change }) => {
    const input = structuredClone(peopleFile);
    change(input);
    expect(() => parseSeedPeople(input, seed)).toThrow(SeedError);
  });
});
