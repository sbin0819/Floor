import { describe, expect, it } from "vitest";
import { z } from "zod";

import seedFile from "@/docs/spec/examples/seed.json";
import spacesFile from "@/docs/spec/examples/gangnam-7f.spaces.json";
import planFile from "@/docs/spec/examples/gangnam-7f.plan.json";
import { loadSeedData, parseSeedData } from "@/lib/seed/data";

function files() {
  return {
    seed: structuredClone(seedFile),
    spaces: structuredClone(spacesFile),
    plan: structuredClone(planFile),
  };
}

function first<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("Missing fixture row.");
  return row;
}

const missingId = "00000000-0000-4000-8000-000000000001";
type Files = ReturnType<typeof files>;
type InvalidCase = {
  name: string;
  change: (input: Files) => void;
  path: (string | number)[];
};

describe("seed data", () => {
  it("loads only the three source files with the required counts", () => {
    const data = loadSeedData();
    expect(data.branches).toHaveLength(2);
    expect(data.floors).toHaveLength(5);
    expect(data.spaces).toHaveLength(47);
    expect(data.users).toHaveLength(6);
    expect(data.teams).toHaveLength(2);
    expect(data.teamMembers).toHaveLength(5);
    expect(data.branchStaff).toHaveLength(2);
    expect(data.accessGrants).toHaveLength(2);
    expect(data.floorPlans).toHaveLength(1);
    expect(data.bookings).toHaveLength(9);
    expect(
      data.bookings.filter((row) => row.status === "confirmed"),
    ).toHaveLength(8);
    expect(data.spaceBlocks).toHaveLength(1);
    expect(first(data.floorPlans).document).toEqual(planFile);
    expect(data.users).toEqual(seedFile.users);
  });

  it("merges 7F source rows and replaces their amenities without metadata", () => {
    const data = loadSeedData();
    const overrides = new Map(
      seedFile.gangnam7fAmenities.map((row) => [row.spaceId, row.amenities]),
    );
    for (const source of spacesFile.spaces) {
      expect(data.spaces.find((row) => row.id === source.id)).toEqual({
        ...source,
        amenities: overrides.get(source.id) ?? [],
      });
    }
    for (const row of data.floors) expect(row).not.toHaveProperty("source");
    for (const row of data.accessGrants)
      expect(row).not.toHaveProperty("source");
    for (const row of data.floorPlans)
      expect(row).not.toHaveProperty("documentFile");
    expect(data).not.toHaveProperty("note");
    expect(data).not.toHaveProperty("gangnam7fAmenities");
  });

  it("does not mutate source JSON and returns independently parsed arrays", () => {
    const input = files();
    const before = structuredClone(input);
    const data = parseSeedData(input);
    first(data.users).name = "변경한 이름";
    first(data.spaces).amenities.push("monitor");
    expect(input).toEqual(before);
    expect(loadSeedData().users).toEqual(seedFile.users);
  });

  it("accepts the next midnight as a booking end", () => {
    const input = files();
    first(input.seed.bookings).start = "23:30";
    first(input.seed.bookings).end = "24:00";
    expect(first(parseSeedData(input).bookings).end).toBe("24:00");
  });

  it.each(["김", "가".repeat(50)])(
    "uses the auth name bounds for %s",
    (name) => {
      const input = files();
      first(input.seed.users).name = name;
      expect(first(parseSeedData(input).users).name).toBe(name);
    },
  );

  it.each<InvalidCase>([
    {
      name: "unknown root seed field",
      change: ({ seed }) => {
        Object.assign(seed, { unknown: true });
      },
      path: ["seed"],
    },
    {
      name: "unknown nested branch field",
      change: ({ seed }) => {
        Object.assign(first(seed.branches), { unknown: true });
      },
      path: ["seed", "branches", 0],
    },
    {
      name: "unknown source space field",
      change: ({ spaces }) => {
        Object.assign(first(spaces.spaces), { unknown: true });
      },
      path: ["spaces", "spaces", 0],
    },
    {
      name: "unknown floor plan field",
      change: ({ plan }) => {
        Object.assign(first(plan.walls), { unknown: true });
      },
      path: ["plan", "walls", 0],
    },
    {
      name: "missing floor branch",
      change: ({ seed }) => {
        first(seed.floors).branchId = missingId;
      },
      path: ["seed", "floors", 0, "branchId"],
    },
    {
      name: "missing space floor",
      change: ({ seed }) => {
        first(seed.spaces).floorId = missingId;
      },
      path: ["seed", "spaces", 0, "floorId"],
    },
    {
      name: "missing parent space",
      change: ({ spaces }) => {
        first(spaces.spaces).parentId = missingId;
      },
      path: ["spaces", "spaces", 0, "parentId"],
    },
    {
      name: "self-referencing parent",
      change: ({ spaces }) => {
        first(spaces.spaces).parentId = first(spaces.spaces).id;
      },
      path: ["spaces", "spaces", 0, "parentId"],
    },
    {
      name: "missing booking space",
      change: ({ seed }) => {
        first(seed.bookings).spaceId = missingId;
      },
      path: ["seed", "bookings", 0, "spaceId"],
    },
    {
      name: "missing booking user",
      change: ({ seed }) => {
        first(seed.bookings).userKey = "missing";
      },
      path: ["seed", "bookings", 0, "userKey"],
    },
    {
      name: "missing booking team",
      change: ({ seed }) => {
        first(seed.bookings).teamId = missingId;
      },
      path: ["seed", "bookings", 0, "teamId"],
    },
    {
      name: "missing booking canceller",
      change: ({ seed }) => {
        first(seed.bookings).cancelledByKey = "missing";
      },
      path: ["seed", "bookings", 0, "cancelledByKey"],
    },
    {
      name: "missing creator",
      change: ({ seed }) => {
        first(seed.spaceBlocks).createdByKey = "missing";
      },
      path: ["seed", "spaceBlocks", 0, "createdByKey"],
    },
    {
      name: "missing membership team",
      change: ({ seed }) => {
        first(seed.teamMembers).teamId = missingId;
      },
      path: ["seed", "teamMembers", 0, "teamId"],
    },
    {
      name: "missing operator branch",
      change: ({ seed }) => {
        first(seed.branchStaff).branchId = missingId;
      },
      path: ["seed", "branchStaff", 0, "branchId"],
    },
    {
      name: "missing allowed team",
      change: ({ seed }) => {
        first(seed.accessGrants).teamId = missingId;
      },
      path: ["seed", "accessGrants", 0, "teamId"],
    },
    {
      name: "missing grant target",
      change: ({ seed }) => {
        first(seed.accessGrants).targetId = missingId;
      },
      path: ["seed", "accessGrants", 0, "targetId"],
    },
    {
      name: "invalid amenities",
      change: ({ seed }) => {
        first(seed.spaces).amenities = [
          ...first(seed.spaces).amenities,
          "unknown",
        ];
      },
      path: ["seed", "spaces", 0, "amenities", 1],
    },
    {
      name: "invalid opening hours",
      change: ({ seed }) => {
        first(seed.branches).openHours.mon.open = "08:15";
      },
      path: ["seed", "branches", 0, "openHours", "mon", "open"],
    },
    {
      name: "invalid timezone",
      change: ({ seed }) => {
        first(seed.branches).timezone = "invalid/timezone";
      },
      path: ["seed", "branches", 0, "timezone"],
    },
    {
      name: "unaligned booking",
      change: ({ seed }) => {
        first(seed.bookings).start = "10:15";
      },
      path: ["seed", "bookings", 0, "start"],
    },
    {
      name: "malformed clock",
      change: ({ seed }) => {
        first(seed.bookings).start = "not-a-time";
      },
      path: ["seed", "bookings", 0, "start"],
    },
    {
      name: "empty booking range",
      change: ({ seed }) => {
        first(seed.bookings).end = first(seed.bookings).start;
      },
      path: ["seed", "bookings", 0, "end"],
    },
    {
      name: "reversed maintenance range",
      change: ({ seed }) => {
        first(seed.spaceBlocks).startDayOffset = 2;
      },
      path: ["seed", "spaceBlocks", 0, "end"],
    },
    {
      name: "plan reference to another floor",
      change: ({ seed, plan }) => {
        first(plan.spaces).spaceId = first(seed.spaces).id;
      },
      path: ["plan", "spaces", 0, "spaceId"],
    },
    {
      name: "unknown document file",
      change: ({ seed }) => {
        first(seed.floorPlans).documentFile = "other.json";
      },
      path: ["seed", "floorPlans", 0, "documentFile"],
    },
    {
      name: "source team name disagreement",
      change: ({ spaces }) => {
        first(spaces.teams).name = "다른 팀";
      },
      path: ["spaces", "teams", 0],
    },
    {
      name: "source branch disagreement",
      change: ({ spaces }) => {
        spaces.branch.name = "다른 지점";
      },
      path: ["spaces", "branch"],
    },
    {
      name: "source floor disagreement",
      change: ({ spaces }) => {
        spaces.floor.level = 9;
      },
      path: ["spaces", "floor"],
    },
    {
      name: "duplicate user key",
      change: ({ seed }) => {
        seed.users.push({
          ...first(seed.users),
          email: "another@example.test",
        });
      },
      path: ["seed", "users", 6, "key"],
    },
    {
      name: "duplicate space across source files",
      change: ({ seed, spaces }) => {
        first(seed.spaces).id = first(spaces.spaces).id;
      },
      path: ["spaces", "spaces", 0, "id"],
    },
    {
      name: "mismatched amenity override name",
      change: ({ seed }) => {
        first(seed.gangnam7fAmenities).name = "없는 공간";
      },
      path: ["seed", "gangnam7fAmenities", 0, "spaceId"],
    },
  ])("rejects $name with a useful item path", ({ change, path }) => {
    const input = files();
    change(input);
    try {
      parseSeedData(input);
      expect.fail("Invalid seed data must not be accepted.");
    } catch (error) {
      expect(error).toBeInstanceOf(z.ZodError);
      if (!(error instanceof z.ZodError)) throw error;
      expect(error.issues.map((issue) => issue.path)).toContainEqual(path);
    }
  });
});
