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
    expect(data.branches).toHaveLength(5);
    expect(data.floors).toHaveLength(11);
    expect(data.spaces).toHaveLength(71);
    expect(data.users).toHaveLength(21);
    expect(data.teams).toHaveLength(2);
    expect(data.teamMembers).toHaveLength(5);
    expect(data.branchStaff).toHaveLength(5);
    expect(data.accessGrants).toHaveLength(2);
    expect(data.floorPlans).toHaveLength(1);
    expect(data.bookings).toHaveLength(21);
    expect(
      data.bookings.filter((row) => row.status === "confirmed"),
    ).toHaveLength(17);
    expect(
      data.bookings.filter((row) => row.status === "cancelled"),
    ).toHaveLength(4);
    expect(data.spaceBlocks).toHaveLength(4);
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

  it.each([
    [
      "홍대점",
      "30f94644-2de6-54db-93bd-0a1f5ad55cdd",
      [2, 3],
      "09:00",
      "22:00",
      { open: "10:00", close: "20:00" },
    ],
    [
      "여의도점",
      "34db02c8-7a13-5ca1-aae8-d7bcb74189f4",
      [10, 11],
      "08:00",
      "21:00",
      null,
    ],
    [
      "판교점",
      "bfc43c7c-c340-5a15-99ea-ccd4f4fca60e",
      [4, 5],
      "08:00",
      "22:00",
      { open: "09:00", close: "18:00" },
    ],
  ] as const)(
    "adds only public space fixtures and existing actors in %s",
    (name, branchId, levels, open, close, saturday) => {
      const data = loadSeedData();
      const branch = data.branches.find(({ id }) => id === branchId)!;
      expect(branch.name).toBe(name);
      expect(branch.address).toContain("가상");
      expect(branch.timezone).toBe("Asia/Seoul");
      for (const day of ["mon", "tue", "wed", "thu", "fri"] as const)
        expect(branch.openHours[day]).toEqual({ open, close });
      expect(branch.openHours.sat).toEqual(saturday);
      expect(branch.openHours.sun).toBeNull();
      const floors = data.floors.filter((floor) => floor.branchId === branchId);
      expect(floors.map(({ level }) => level)).toEqual(levels);
      expect(floors.map(({ sortOrder }) => sortOrder)).toEqual([0, 1]);
      expect(floors.every(({ access }) => access === "everyone")).toBe(true);
      const floorIds = new Set(floors.map(({ id }) => id));
      const spaces = data.spaces.filter((space) => floorIds.has(space.floorId));
      expect(spaces).toHaveLength(8);
      expect(spaces.filter(({ bookable }) => bookable)).toHaveLength(6);
      expect(spaces.filter(({ type }) => type === "meeting_room")).toHaveLength(
        3,
      );
      expect(spaces.filter(({ type }) => type === "phone_booth")).toHaveLength(
        2,
      );
      expect(spaces.filter(({ type }) => type === "seminar")).toHaveLength(1);
      expect(spaces.filter(({ type }) => type === "lounge")).toHaveLength(2);
      expect(
        spaces.every(
          ({ access, parentId }) => access === null && parentId === null,
        ),
      ).toBe(true);
      const spaceIds = new Set(spaces.map(({ id }) => id));
      const bookings = data.bookings.filter(({ spaceId }) =>
        spaceIds.has(spaceId),
      );
      expect(bookings).toHaveLength(4);
      expect(
        bookings.filter(({ status }) => status === "confirmed"),
      ).toHaveLength(3);
      expect(
        bookings.filter(({ status }) => status === "cancelled"),
      ).toHaveLength(1);
      expect(bookings.every(({ teamId }) => teamId === null)).toBe(true);
      expect(
        data.spaceBlocks.filter(({ spaceId }) => spaceIds.has(spaceId)),
      ).toHaveLength(1);
      expect(
        data.branchStaff.filter((staff) => staff.branchId === branchId),
      ).toEqual([{ branchId, userKey: "admin" }]);
      expect(data.floorPlans.some(({ floorId }) => floorIds.has(floorId))).toBe(
        false,
      );
      expect(
        data.accessGrants.some(
          ({ targetId }) => floorIds.has(targetId) || spaceIds.has(targetId),
        ),
      ).toBe(false);
    },
  );

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
      path: ["seed", "users", 21, "key"],
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
