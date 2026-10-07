import { describe, expect, it } from "vitest";
import {
  adminSpaceTypes,
  archiveSpaceSchema,
  createFloorSchema,
  createSpaceSchema,
  requiredOpenHoursSchema,
  restoreSpaceSchema,
  setFloorAccessSchema,
  setSpaceAccessSchema,
  updateBranchSchema,
  updateFloorSchema,
  updateSpaceSchema,
} from "@/features/admin/schema";
import { amenityKeys } from "@/lib/spaces/amenities";
import { dayKeys } from "@/lib/time/open-hours";

const id = "abcdefab-1234-4abc-9def-123456789abc";
const openHours = {
  mon: { open: "09:00", close: "22:00" },
  tue: null,
  wed: null,
  thu: null,
  fri: null,
  sat: null,
  sun: null,
};
const branch = {
  branchId: id,
  name: "테스트점",
  address: "가상로 1",
  openHours,
};
const floor = { branchId: id, level: 7, name: "7F" };
const floorUpdate = { floorId: id, level: 7, name: "7F", sortOrder: 0 };
const spaceFields = {
  name: "회의실",
  capacity: 4,
  bookable: true,
  amenities: ["monitor"],
};
const space = { floorId: id, type: "meeting_room", ...spaceFields };
const spaceUpdate = { spaceId: id, ...spaceFields };
const floorAccess = { floorId: id, access: "teams", teamIds: [id] };
const spaceAccess = { spaceId: id, access: "teams", teamIds: [id] };

const contracts = [
  {
    name: "updateBranch",
    schema: updateBranchSchema,
    input: branch,
    idKey: "branchId",
  },
  {
    name: "createFloor",
    schema: createFloorSchema,
    input: floor,
    idKey: "branchId",
  },
  {
    name: "updateFloor",
    schema: updateFloorSchema,
    input: floorUpdate,
    idKey: "floorId",
  },
  {
    name: "createSpace",
    schema: createSpaceSchema,
    input: space,
    idKey: "floorId",
  },
  {
    name: "updateSpace",
    schema: updateSpaceSchema,
    input: spaceUpdate,
    idKey: "spaceId",
  },
  {
    name: "archiveSpace",
    schema: archiveSpaceSchema,
    input: { spaceId: id },
    idKey: "spaceId",
  },
  {
    name: "restoreSpace",
    schema: restoreSpaceSchema,
    input: { spaceId: id },
    idKey: "spaceId",
  },
  {
    name: "setFloorAccess",
    schema: setFloorAccessSchema,
    input: floorAccess,
    idKey: "floorId",
  },
  {
    name: "setSpaceAccess",
    schema: setSpaceAccessSchema,
    input: spaceAccess,
    idKey: "spaceId",
  },
];

describe("strict admin action contracts", () => {
  it.each(contracts)(
    "accepts the exact $name contract and rejects unknown keys",
    ({ schema, input }) => {
      expect(schema.safeParse(input).success).toBe(true);
      expect(schema.safeParse({ ...input, unexpected: true }).success).toBe(
        false,
      );
      expect(schema.safeParse({ ...input, userId: id }).success).toBe(false);
    },
  );
  it.each(contracts)(
    "requires every documented $name field",
    ({ schema, input }) => {
      for (const key of Object.keys(input)) {
        const omitted = { ...input };
        Reflect.deleteProperty(omitted, key);
        expect(schema.safeParse(omitted).success).toBe(false);
      }
    },
  );
  it.each(contracts)(
    "validates and canonicalizes $name UUIDs",
    ({ schema, input, idKey }) => {
      expect(schema.safeParse({ ...input, [idKey]: "invalid" }).success).toBe(
        false,
      );
      expect(
        schema.parse({ ...input, [idKey]: id.toUpperCase() }),
      ).toHaveProperty(idKey, id);
    },
  );
  it.each(contracts.slice(0, 7))(
    "forbids protected values in $name",
    ({ schema, input }) => {
      for (const key of [
        "parentId",
        "access",
        "archivedAt",
        "timezone",
        "bookingRules",
      ])
        expect(schema.safeParse({ ...input, [key]: null }).success).toBe(false);
    },
  );
  it.each(["type", "floorId", "branchId"])(
    "forbids %s in updateSpace",
    (key) => {
      expect(
        updateSpaceSchema.safeParse({
          ...spaceUpdate,
          [key]: key === "type" ? "lounge" : id,
        }).success,
      ).toBe(false);
    },
  );
  it.each(contracts.slice(0, 5))(
    "rejects a PostgreSQL-incompatible NUL in $name text before database access",
    ({ schema, input }) => {
      for (const value of ["\0a", "a\0b", "ab\0"]) {
        const result = schema.safeParse({ ...input, name: value });
        expect(result.success).toBe(false);
        if (!result.success)
          expect(result.error.issues).toContainEqual(
            expect.objectContaining({ path: ["name"] }),
          );
      }
    },
  );
});

describe("branch and weekly hours input", () => {
  it("rejects a PostgreSQL-incompatible NUL in an optional address", () => {
    for (const address of ["\0", "a\0b", "ab\0"]) {
      const result = updateBranchSchema.safeParse({ ...branch, address });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({ path: ["address"] }),
        );
    }
  });
  it("trims names and addresses and stores an empty address as null", () => {
    expect(
      updateBranchSchema.parse({
        ...branch,
        name: "  테스트점  ",
        address: "  ",
      }),
    ).toMatchObject({ name: "테스트점", address: null });
    expect(
      updateBranchSchema.parse({ ...branch, address: " 가상로 1 " }).address,
    ).toBe("가상로 1");
  });
  it.each(["", " ", "가".repeat(41)])(
    "rejects an invalid branch name %s",
    (name) => {
      expect(updateBranchSchema.safeParse({ ...branch, name }).success).toBe(
        false,
      );
    },
  );
  it("accepts branch text limits exactly", () => {
    expect(
      updateBranchSchema.safeParse({
        ...branch,
        name: "가".repeat(40),
        address: "나".repeat(100),
      }).success,
    ).toBe(true);
    expect(
      updateBranchSchema.safeParse({ ...branch, address: "나".repeat(101) })
        .success,
    ).toBe(false);
    expect(
      updateBranchSchema.safeParse({ ...branch, address: null }).success,
    ).toBe(false);
  });
  it.each(dayKeys)("requires weekday %s, including closed days", (day) => {
    const missing = { ...openHours };
    Reflect.deleteProperty(missing, day);
    expect(requiredOpenHoursSchema.safeParse(missing).success).toBe(false);
    expect(
      requiredOpenHoursSchema.safeParse({ ...openHours, [day]: undefined })
        .success,
    ).toBe(false);
    expect(
      requiredOpenHoursSchema.safeParse({ ...openHours, [day]: null }).success,
    ).toBe(true);
  });
  it("uses strict objects for both the week and each open day", () => {
    expect(
      requiredOpenHoursSchema.safeParse({ ...openHours, holiday: null })
        .success,
    ).toBe(false);
    expect(
      requiredOpenHoursSchema.safeParse({
        ...openHours,
        mon: { ...openHours.mon, break: "12:00" },
      }).success,
    ).toBe(false);
  });
  it.each([
    { open: "22:00", close: "09:00" },
    { open: "09:00", close: "09:00" },
    { open: "09:15", close: "10:00" },
    { open: "09:00", close: "10:15" },
    { open: "24:00", close: "24:00" },
    { open: "09:00", close: "24:30" },
    { open: "9:00", close: "10:00" },
    { open: "09:00", close: "25:00" },
  ])("rejects hours $open–$close", (mon) => {
    expect(
      updateBranchSchema.safeParse({
        ...branch,
        openHours: { ...openHours, mon },
      }).success,
    ).toBe(false);
  });
  it.each([
    { open: "00:00", close: "24:00" },
    { open: "09:30", close: "10:00" },
  ])("accepts hours $open–$close", (mon) => {
    expect(
      updateBranchSchema.safeParse({
        ...branch,
        openHours: { ...openHours, mon },
      }).success,
    ).toBe(true);
  });
});

describe("floor input", () => {
  it.each([-5, -1, 1, 100])("accepts valid level %i", (level) => {
    expect(createFloorSchema.safeParse({ ...floor, level }).success).toBe(true);
    expect(updateFloorSchema.safeParse({ ...floorUpdate, level }).success).toBe(
      true,
    );
  });
  it.each([-6, 0, 101, 1.5, "7", null])("rejects invalid level %s", (level) => {
    expect(createFloorSchema.safeParse({ ...floor, level }).success).toBe(
      false,
    );
    expect(updateFloorSchema.safeParse({ ...floorUpdate, level }).success).toBe(
      false,
    );
  });
  it("leaves the create default to the server and requires update sortOrder", () => {
    expect(createFloorSchema.parse(floor).sortOrder).toBeUndefined();
    expect(
      updateFloorSchema.safeParse({ floorId: id, level: 7, name: "7F" })
        .success,
    ).toBe(false);
  });
  it.each([0, 999])("accepts sort order %i", (sortOrder) => {
    expect(createFloorSchema.safeParse({ ...floor, sortOrder }).success).toBe(
      true,
    );
    expect(
      updateFloorSchema.safeParse({ ...floorUpdate, sortOrder }).success,
    ).toBe(true);
  });
  it.each([-1, 1000, 0.5, "1", null])(
    "rejects invalid sort order %s",
    (sortOrder) => {
      expect(createFloorSchema.safeParse({ ...floor, sortOrder }).success).toBe(
        false,
      );
      expect(
        updateFloorSchema.safeParse({ ...floorUpdate, sortOrder }).success,
      ).toBe(false);
    },
  );
  it("trims floor names and enforces their 1–20 character range", () => {
    expect(createFloorSchema.parse({ ...floor, name: "  7F  " }).name).toBe(
      "7F",
    );
    expect(
      updateFloorSchema.safeParse({ ...floorUpdate, name: "가".repeat(20) })
        .success,
    ).toBe(true);
    for (const name of ["", " ", "가".repeat(21)]) {
      expect(createFloorSchema.safeParse({ ...floor, name }).success).toBe(
        false,
      );
      expect(
        updateFloorSchema.safeParse({ ...floorUpdate, name }).success,
      ).toBe(false);
    }
  });
});

describe("space input", () => {
  it.each(adminSpaceTypes)("allows managed type %s", (type) => {
    expect(createSpaceSchema.safeParse({ ...space, type }).success).toBe(true);
  });
  it.each(["desk", "fixture", "unknown"])(
    "rejects unmanaged type %s",
    (type) => {
      expect(createSpaceSchema.safeParse({ ...space, type }).success).toBe(
        false,
      );
    },
  );
  it.each(adminSpaceTypes)(
    "only lounge can have null capacity when creating %s",
    (type) => {
      const parsed = createSpaceSchema.safeParse({
        ...space,
        type,
        capacity: null,
      });
      expect(parsed.success).toBe(type === "lounge");
      if (!parsed.success)
        expect(parsed.error.issues[0]?.path).toEqual(["capacity"]);
    },
  );
  it("leaves type-specific update capacity and bookability to the server", () => {
    expect(
      updateSpaceSchema.safeParse({ ...spaceUpdate, capacity: null }).success,
    ).toBe(true);
    for (const type of ["lounge", "desk_area"])
      expect(
        createSpaceSchema.parse({ ...space, type, bookable: true }).bookable,
      ).toBe(true);
  });
  it.each([1, 500])("accepts capacity %i", (capacity) => {
    expect(createSpaceSchema.safeParse({ ...space, capacity }).success).toBe(
      true,
    );
    expect(
      updateSpaceSchema.safeParse({ ...spaceUpdate, capacity }).success,
    ).toBe(true);
  });
  it.each([0, -1, 501, 1.5, "4", false])(
    "rejects invalid capacity %s",
    (capacity) => {
      expect(createSpaceSchema.safeParse({ ...space, capacity }).success).toBe(
        false,
      );
      expect(
        updateSpaceSchema.safeParse({ ...spaceUpdate, capacity }).success,
      ).toBe(false);
    },
  );
  it("requires real boolean bookability", () => {
    for (const bookable of ["true", "false", 0, 1, null])
      expect(
        updateSpaceSchema.safeParse({ ...spaceUpdate, bookable }).success,
      ).toBe(false);
  });
  it("trims the name and accepts only the six documented amenities", () => {
    expect(
      createSpaceSchema.parse({
        ...space,
        name: "  새 회의실  ",
        amenities: [...amenityKeys],
      }),
    ).toMatchObject({ name: "새 회의실", amenities: [...amenityKeys] });
    expect(
      updateSpaceSchema.safeParse({
        ...spaceUpdate,
        name: "가".repeat(40),
        amenities: [],
      }).success,
    ).toBe(true);
    for (const name of ["", " ", "가".repeat(41)]) {
      expect(createSpaceSchema.safeParse({ ...space, name }).success).toBe(
        false,
      );
      expect(
        updateSpaceSchema.safeParse({ ...spaceUpdate, name }).success,
      ).toBe(false);
    }
    for (const amenities of [
      ["wifi"],
      ["MONITOR"],
      ["monitor", "unknown"],
      "monitor",
    ])
      expect(
        updateSpaceSchema.safeParse({ ...spaceUpdate, amenities }).success,
      ).toBe(false);
  });
});

describe("access input", () => {
  const teamIds = Array.from({ length: 21 }, () => crypto.randomUUID());
  it("deduplicates canonical UUIDs before enforcing the floor maximum", () => {
    expect(
      setFloorAccessSchema.parse({
        ...floorAccess,
        floorId: id.toUpperCase(),
        teamIds: [id, id.toUpperCase(), id],
      }),
    ).toEqual({ ...floorAccess, teamIds: [id] });
    expect(
      setSpaceAccessSchema.parse({
        ...spaceAccess,
        teamIds: [id, id.toUpperCase()],
      }).teamIds,
    ).toEqual([id]);
    expect(
      setFloorAccessSchema.parse({
        ...floorAccess,
        teamIds: [...teamIds.slice(0, 20), ...teamIds.slice(0, 20)],
      }).teamIds,
    ).toHaveLength(20);
  });
  it("requires 1–20 unique teams for floor access and at least one for space access", () => {
    expect(
      setFloorAccessSchema.safeParse({ ...floorAccess, teamIds: [] }).success,
    ).toBe(false);
    expect(
      setFloorAccessSchema.safeParse({
        ...floorAccess,
        teamIds: teamIds.slice(0, 20),
      }).success,
    ).toBe(true);
    expect(
      setFloorAccessSchema.safeParse({ ...floorAccess, teamIds }).success,
    ).toBe(false);
    expect(
      setSpaceAccessSchema.safeParse({ ...spaceAccess, teamIds: [] }).success,
    ).toBe(false);
    expect(
      setSpaceAccessSchema.safeParse({ ...spaceAccess, teamIds }).success,
    ).toBe(true);
  });
  it.each(["everyone", "closed"])(
    "requires no teams for %s floor and space access",
    (access) => {
      expect(
        setFloorAccessSchema.safeParse({ ...floorAccess, access, teamIds: [] })
          .success,
      ).toBe(true);
      expect(
        setSpaceAccessSchema.safeParse({ ...spaceAccess, access, teamIds: [] })
          .success,
      ).toBe(true);
      expect(
        setFloorAccessSchema.safeParse({ ...floorAccess, access }).success,
      ).toBe(false);
      expect(
        setSpaceAccessSchema.safeParse({ ...spaceAccess, access }).success,
      ).toBe(false);
    },
  );
  it("allows inheritance only for spaces, without grants", () => {
    expect(
      setSpaceAccessSchema.safeParse({
        ...spaceAccess,
        access: null,
        teamIds: [],
      }).success,
    ).toBe(true);
    expect(
      setSpaceAccessSchema.safeParse({ ...spaceAccess, access: null }).success,
    ).toBe(false);
    expect(
      setFloorAccessSchema.safeParse({
        ...floorAccess,
        access: null,
        teamIds: [],
      }).success,
    ).toBe(false);
  });
  it("validates every team UUID and rejects unknown access values", () => {
    for (const schema of [setFloorAccessSchema, setSpaceAccessSchema]) {
      const input = schema === setFloorAccessSchema ? floorAccess : spaceAccess;
      expect(schema.safeParse({ ...input, teamIds: ["invalid"] }).success).toBe(
        false,
      );
      expect(schema.safeParse({ ...input, access: "private" }).success).toBe(
        false,
      );
    }
  });
});
