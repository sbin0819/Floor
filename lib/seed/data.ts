import { z } from "zod";

import seedFile from "@/docs/spec/examples/seed.json";
import spacesFile from "@/docs/spec/examples/gangnam-7f.spaces.json";
import planFile from "@/docs/spec/examples/gangnam-7f.plan.json";
import { nameSchema, passwordSchema } from "@/features/auth/schema";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import { amenityKeys } from "@/lib/spaces/amenities";
import { openHoursSchema } from "@/lib/time/open-hours";
import { isValidTimeZone } from "@/lib/time/zoned";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const key = z.string().min(1);
const access = z.enum(["everyone", "teams", "closed"]);
const amenities = z.array(z.enum(amenityKeys));
const timezone = z
  .string()
  .refine(isValidTimeZone, "올바른 시간대를 입력해 주세요.");
const floorFields = {
  id: uuid,
  branchId: uuid,
  level: z.int(),
  name: z.string().min(1),
  access,
};
const spaceSchema = z.strictObject({
  id: uuid,
  floorId: uuid,
  parentId: uuid.nullable(),
  type: z.enum([
    "meeting_room",
    "phone_booth",
    "seminar",
    "desk_area",
    "desk",
    "lounge",
  ]),
  name: z.string().min(1),
  capacity: z.int().positive().nullable(),
  bookable: z.boolean(),
  amenities: amenities.default([]),
  access: access.nullable(),
});
const grantFields = {
  targetType: z.enum(["floor", "space"]),
  targetId: uuid,
  teamId: uuid,
};

const seedSchema = z.strictObject({
  note: z.string(),
  branches: z.array(
    z.strictObject({
      id: uuid,
      name: z.string().min(1),
      address: z.string().nullable(),
      timezone,
      openHours: openHoursSchema,
    }),
  ),
  floors: z.array(
    z.strictObject({
      ...floorFields,
      sortOrder: z.int().nonnegative(),
      source: z.literal("gangnam-7f.spaces.json").optional(),
    }),
  ),
  spaces: z.array(spaceSchema),
  gangnam7fAmenities: z.array(
    z.strictObject({ spaceId: uuid, name: z.string(), amenities }),
  ),
  users: z.array(
    z.strictObject({
      key,
      email: z.email().toLowerCase(),
      name: nameSchema,
      password: passwordSchema,
      defaultBranchId: uuid.nullable().default(null),
    }),
  ),
  teams: z.array(
    z.strictObject({
      id: uuid,
      name: z.string().min(2).max(40),
      createdByKey: key,
      homeBranchId: uuid.nullable(),
      headcount: z.int().min(1).max(1000).nullable(),
      contactPhone: z.string().nullable(),
    }),
  ),
  teamMembers: z.array(
    z.strictObject({
      teamId: uuid,
      userKey: key,
      role: z.enum(["admin", "member"]),
      title: z.string().nullable(),
    }),
  ),
  branchStaff: z.array(z.strictObject({ branchId: uuid, userKey: key })),
  accessGrants: z.array(
    z.strictObject({
      id: uuid,
      ...grantFields,
      source: z.literal("gangnam-7f.spaces.json").optional(),
    }),
  ),
  floorPlans: z.array(
    z.strictObject({
      id: uuid,
      floorId: uuid,
      version: z.int().positive(),
      status: z.literal("published"),
      documentFile: z.literal("gangnam-7f.plan.json"),
      createdByKey: key,
    }),
  ),
});

const sourceSpacesSchema = z.strictObject({
  branch: z.strictObject({ id: uuid, name: z.string(), timezone }),
  floor: z.strictObject(floorFields),
  teams: z.array(z.strictObject({ id: uuid, name: z.string() })),
  accessGrants: z.array(z.strictObject(grantFields)),
  spaces: z.array(spaceSchema),
});

const filesSchema = z
  .strictObject({
    seed: seedSchema,
    spaces: sourceSpacesSchema,
    plan: floorPlanSchema,
  })
  .superRefine(({ seed, spaces: source, plan }, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: "custom", path, message });
    const unique = <T>(
      rows: T[],
      identity: (row: T) => string,
      path: (string | number)[],
      field = "id",
    ) => {
      const seen = new Set<string>();
      rows.forEach((row, index) => {
        const value = identity(row);
        if (seen.has(value))
          issue([...path, index, field], "같은 항목이 두 번 있어요.");
        seen.add(value);
      });
    };
    for (const collection of [
      "branches",
      "floors",
      "spaces",
      "teams",
      "accessGrants",
      "floorPlans",
    ] as const)
      unique<{ id: string }>(seed[collection], (row) => row.id, [
        "seed",
        collection,
      ]);
    unique(seed.users, (row) => row.key, ["seed", "users"], "key");
    unique(seed.users, (row) => row.email, ["seed", "users"], "email");
    unique(source.spaces, (row) => row.id, ["spaces", "spaces"]);
    unique(source.teams, (row) => row.id, ["spaces", "teams"]);
    unique(
      seed.gangnam7fAmenities,
      (row) => row.spaceId,
      ["seed", "gangnam7fAmenities"],
      "spaceId",
    );
    unique(
      seed.teamMembers,
      (row) => `${row.teamId}:${row.userKey}`,
      ["seed", "teamMembers"],
      "userKey",
    );
    unique(
      seed.branchStaff,
      (row) => `${row.branchId}:${row.userKey}`,
      ["seed", "branchStaff"],
      "userKey",
    );
    unique(
      seed.accessGrants,
      (row) => `${row.targetType}:${row.targetId}:${row.teamId}`,
      ["seed", "accessGrants"],
      "teamId",
    );

    const branches = new Map(seed.branches.map((row) => [row.id, row]));
    const floors = new Map(seed.floors.map((row) => [row.id, row]));
    const teams = new Map(seed.teams.map((row) => [row.id, row]));
    const users = new Set(seed.users.map((row) => row.key));
    const allSpaces = [...seed.spaces, ...source.spaces];
    const spaceRows = new Map(allSpaces.map((row) => [row.id, row]));
    const check = (
      exists: boolean,
      path: (string | number)[],
      kind: string,
    ) => {
      if (!exists) issue(path, `가리키는 ${kind} 항목이 없어요.`);
    };
    const branch = branches.get(source.branch.id);
    if (
      !branch ||
      branch.name !== source.branch.name ||
      branch.timezone !== source.branch.timezone
    )
      issue(["spaces", "branch"], "7층 원본과 시드의 지점 정보가 달라요.");
    const sourceFloors = seed.floors.filter((row) => row.source);
    if (sourceFloors.length !== 1 || sourceFloors[0]?.id !== source.floor.id)
      issue(["seed", "floors"], "7층 원본을 가리키는 층이 하나 있어야 해요.");
    const floor = floors.get(source.floor.id);
    if (
      !floor ||
      floor.branchId !== source.floor.branchId ||
      floor.level !== source.floor.level ||
      floor.name !== source.floor.name ||
      floor.access !== source.floor.access
    )
      issue(["spaces", "floor"], "7층 원본과 시드의 층 정보가 달라요.");
    if (source.floor.branchId !== source.branch.id)
      issue(["spaces", "floor", "branchId"], "7층의 지점이 원본과 달라요.");

    source.teams.forEach((row, index) => {
      if (teams.get(row.id)?.name !== row.name)
        issue(
          ["spaces", "teams", index],
          "7층 원본과 시드의 팀 정보가 달라요.",
        );
    });
    seed.floors.forEach((row, index) =>
      check(
        branches.has(row.branchId),
        ["seed", "floors", index, "branchId"],
        "지점",
      ),
    );
    for (const [label, rows] of [
      ["seed", seed.spaces],
      ["spaces", source.spaces],
    ] as const) {
      rows.forEach((row, index) => {
        const path = [label, "spaces", index];
        check(floors.has(row.floorId), [...path, "floorId"], "층");
        if (row.parentId !== null) {
          const parent = spaceRows.get(row.parentId);
          check(Boolean(parent), [...path, "parentId"], "부모 공간");
          if (
            parent &&
            (parent.floorId !== row.floorId || parent.id === row.id)
          )
            issue(
              [...path, "parentId"],
              "부모 공간은 같은 층의 다른 공간이어야 해요.",
            );
          if (row.type === "desk" && parent?.type !== "desk_area")
            issue(
              [...path, "parentId"],
              "좌석의 부모는 데스크 구역이어야 해요.",
            );
        } else if (row.type === "desk") {
          issue([...path, "parentId"], "좌석에는 부모 구역이 있어야 해요.");
        }
        if (label === "spaces" && row.floorId !== source.floor.id)
          issue(
            [...path, "floorId"],
            "7층 원본의 공간은 원본 층에 있어야 해요.",
          );
        if (
          label === "spaces" &&
          seed.spaces.some((other) => other.id === row.id)
        )
          issue([...path, "id"], "공간 id가 두 파일에 중복돼 있어요.");
        if (
          row.type === "desk_area" &&
          row.bookable &&
          allSpaces.some(
            (other) => other.parentId === row.id && other.type === "desk",
          )
        )
          issue(
            [...path, "bookable"],
            "좌석이 있는 데스크 구역은 예약할 수 없어요.",
          );
        const visited = new Set([row.id]);
        let parentId = row.parentId;
        while (parentId) {
          if (visited.has(parentId)) {
            issue([...path, "parentId"], "부모 공간 참조가 순환하고 있어요.");
            break;
          }
          visited.add(parentId);
          parentId = spaceRows.get(parentId)?.parentId ?? null;
        }
      });
    }
    seed.gangnam7fAmenities.forEach((row, index) => {
      const space = spaceRows.get(row.spaceId);
      if (space?.floorId !== source.floor.id || space.name !== row.name)
        issue(
          ["seed", "gangnam7fAmenities", index, "spaceId"],
          "편의 시설이 가리키는 7층 공간이 없거나 이름이 달라요.",
        );
    });
    seed.users.forEach((row, index) => {
      if (row.defaultBranchId !== null)
        check(
          branches.has(row.defaultBranchId),
          ["seed", "users", index, "defaultBranchId"],
          "지점",
        );
    });
    seed.teams.forEach((row, index) => {
      check(
        users.has(row.createdByKey),
        ["seed", "teams", index, "createdByKey"],
        "사용자",
      );
      if (row.homeBranchId !== null)
        check(
          branches.has(row.homeBranchId),
          ["seed", "teams", index, "homeBranchId"],
          "지점",
        );
    });
    seed.teamMembers.forEach((row, index) => {
      check(
        teams.has(row.teamId),
        ["seed", "teamMembers", index, "teamId"],
        "팀",
      );
      check(
        users.has(row.userKey),
        ["seed", "teamMembers", index, "userKey"],
        "사용자",
      );
    });
    seed.branchStaff.forEach((row, index) => {
      check(
        branches.has(row.branchId),
        ["seed", "branchStaff", index, "branchId"],
        "지점",
      );
      check(
        users.has(row.userKey),
        ["seed", "branchStaff", index, "userKey"],
        "사용자",
      );
    });
    const sameGrant = (
      left: z.infer<typeof sourceSpacesSchema>["accessGrants"][number],
      right: z.infer<typeof sourceSpacesSchema>["accessGrants"][number],
    ) =>
      left.targetType === right.targetType &&
      left.targetId === right.targetId &&
      left.teamId === right.teamId;
    seed.accessGrants.forEach((row, index) => {
      check(
        teams.has(row.teamId),
        ["seed", "accessGrants", index, "teamId"],
        "팀",
      );
      check(
        row.targetType === "floor"
          ? floors.has(row.targetId)
          : spaceRows.has(row.targetId),
        ["seed", "accessGrants", index, "targetId"],
        "이용 대상",
      );
      if (
        row.source &&
        !source.accessGrants.some((other) => sameGrant(row, other))
      )
        issue(
          ["seed", "accessGrants", index, "source"],
          "7층 원본의 허용 팀과 달라요.",
        );
    });
    source.accessGrants.forEach((row, index) => {
      if (
        !seed.accessGrants.some(
          (other) => other.source && sameGrant(row, other),
        )
      )
        issue(
          ["spaces", "accessGrants", index],
          "원본의 허용 팀이 시드 목록에 없어요.",
        );
    });
    seed.floorPlans.forEach((row, index) => {
      check(
        floors.has(row.floorId),
        ["seed", "floorPlans", index, "floorId"],
        "층",
      );
      check(
        users.has(row.createdByKey),
        ["seed", "floorPlans", index, "createdByKey"],
        "사용자",
      );
      for (const collection of ["spaces", "seats"] as const)
        plan[collection].forEach((shape, shapeIndex) => {
          if (spaceRows.get(shape.spaceId)?.floorId !== row.floorId)
            issue(
              ["plan", collection, shapeIndex, "spaceId"],
              "평면도 공간은 이 평면도의 층에 있어야 해요.",
            );
        });
    });
  });

export function parseSeedData(files: {
  seed: unknown;
  spaces: unknown;
  plan: unknown;
}) {
  const { seed, spaces: source, plan } = filesSchema.parse(files);
  const amenitiesBySpace = new Map(
    seed.gangnam7fAmenities.map((row) => [row.spaceId, row.amenities]),
  );
  return {
    branches: seed.branches,
    floors: seed.floors.map(({ source: sourceFile, ...floor }) => ({
      ...floor,
      ...(sourceFile ? source.floor : {}),
    })),
    spaces: [
      ...seed.spaces,
      ...source.spaces.map((space) => ({
        ...space,
        amenities: amenitiesBySpace.get(space.id) ?? space.amenities,
      })),
    ],
    users: seed.users,
    teams: seed.teams.map((team) => ({
      ...team,
      name: source.teams.find((row) => row.id === team.id)?.name ?? team.name,
    })),
    teamMembers: seed.teamMembers,
    branchStaff: seed.branchStaff,
    accessGrants: seed.accessGrants.map(({ source: sourceFile, ...grant }) => ({
      ...grant,
      ...(sourceFile
        ? source.accessGrants.find(
            (row) =>
              row.targetType === grant.targetType &&
              row.targetId === grant.targetId &&
              row.teamId === grant.teamId,
          )
        : {}),
    })),
    floorPlans: seed.floorPlans.map((row) => ({
      id: row.id,
      floorId: row.floorId,
      version: row.version,
      status: row.status,
      createdByKey: row.createdByKey,
      document: plan,
    })),
  };
}

export type SeedData = ReturnType<typeof parseSeedData>;

export function loadSeedData(): SeedData {
  return parseSeedData({ seed: seedFile, spaces: spacesFile, plan: planFile });
}
