import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getBranch,
  getFloorWithAccess,
  getOperatorBranches,
  listBranchDetails,
  listBranches,
  listFloorsWithAccess,
} from "@/lib/dal/branches";
import type { DalDatabase } from "@/lib/dal/database";
import { getRoleSettings } from "@/lib/dal/role-settings";
import { getMemberships } from "@/lib/dal/users";
import {
  loadPermissionContext,
  loadPermissionData,
} from "@/lib/permissions/context";

const mocks = vi.hoisted(() => ({
  cacheCalls: [] as unknown[][],
  getDb: vi.fn(),
}));

vi.mock("react", () => ({
  cache:
    <Arguments extends unknown[], Result>(fn: (...args: Arguments) => Result) =>
    (...args: Arguments): Result => {
      mocks.cacheCalls.push(args);
      return fn(...args);
    },
}));
vi.mock("@/lib/db/client", () => ({ getDb: mocks.getDb }));

function fakeDatabase() {
  const responses: unknown[][] = [];
  const select = vi.fn(() => {
    const result = Promise.resolve(responses.shift() ?? []);
    const query = {
      from: () => query,
      innerJoin: () => query,
      where: () => query,
      orderBy: () => query,
      limit: () => query,
      then: result.then.bind(result),
    };
    return query;
  });
  return {
    database: { select } as unknown as DalDatabase,
    responses,
    select,
  };
}

const userId = "user-a";
const branchId = "branch-a";
const floorId = "floor-a";
const session = { userId, name: "회원", email: "member@example.test" };
const floor = { id: floorId, branchId, name: "7층" };
const branch = { id: branchId, name: "가상 지점" };
const settings = {
  role: "user",
  permissions: ["floor.view"],
  limits: { maxDaysAhead: 3 },
};
const cases = [
  {
    name: "memberships",
    read: (db?: DalDatabase) => getMemberships(userId, db),
    rows: [[{ teamId: "team-a", role: "member" }], [{ branchId }]],
    keys: [userId],
  },
  {
    name: "role settings",
    read: (db?: DalDatabase) => getRoleSettings(branchId, db),
    rows: [[settings]],
    keys: [branchId],
  },
  {
    name: "operator branches",
    read: (db?: DalDatabase) => getOperatorBranches(userId, db),
    rows: [[branch]],
    keys: [userId],
  },
  {
    name: "branch",
    read: (db?: DalDatabase) => getBranch(branchId, db),
    rows: [[branch]],
    keys: [branchId],
  },
  {
    name: "branch details",
    read: (db?: DalDatabase) => listBranchDetails(db),
    rows: [[branch]],
    keys: [],
  },
  {
    name: "branch names",
    read: (db?: DalDatabase) => listBranches(db),
    rows: [[branch]],
    keys: [],
  },
  {
    name: "floor with access",
    read: (db?: DalDatabase) => getFloorWithAccess(floorId, db),
    rows: [[floor], [{ floorId, teamId: "team-a" }]],
    keys: [floorId],
  },
  {
    name: "floors with access",
    read: (db?: DalDatabase) => listFloorsWithAccess(branchId, db),
    rows: [[floor], [{ floorId, teamId: "team-a" }]],
    keys: [branchId],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cacheCalls.length = 0;
});

describe("request memo boundaries", () => {
  it.each(cases)(
    "uses primitive cache keys for $name",
    async ({ read, rows, keys }) => {
      const fake = fakeDatabase();
      fake.responses.push(...rows, ...rows);
      mocks.getDb.mockReturnValue(fake.database);
      const first = await read();
      expect(await read()).toEqual(first);
      expect(mocks.cacheCalls).toEqual([keys, keys]);
      expect(fake.select).toHaveBeenCalledTimes(rows.length * 2);
    },
  );

  it.each(cases)(
    "bypasses memo and the default DB for injected $name reads",
    async ({ read, rows }) => {
      const fake = fakeDatabase();
      fake.responses.push(...rows, ...rows);
      const first = await read(fake.database);
      expect(await read(fake.database)).toEqual(first);
      expect(fake.select).toHaveBeenCalledTimes(rows.length * 2);
      expect(mocks.cacheCalls).toEqual([]);
      expect(mocks.getDb).not.toHaveBeenCalled();
    },
  );

  it("unpacks session objects before entering permission memo", async () => {
    const fake = fakeDatabase();
    fake.responses.push([], [], [settings], [], [], [settings]);
    mocks.getDb.mockReturnValue(fake.database);
    const first = await loadPermissionData(session, branchId);
    expect(await loadPermissionContext({ ...session }, branchId)).toEqual(
      first.context,
    );
    expect(mocks.cacheCalls).toEqual([
      [userId, branchId],
      [userId],
      [branchId],
      [userId, branchId],
      [userId],
      [branchId],
    ]);
  });

  it("does not memoize permission data or nested DAL reads with an injected DB", async () => {
    const fake = fakeDatabase();
    fake.responses.push(
      [],
      [],
      [settings],
      [{ teamId: "new-team", role: "member" }],
      [],
      [settings],
    );
    const first = await loadPermissionContext(session, branchId, fake.database);
    const second = await loadPermissionData(
      { ...session },
      branchId,
      fake.database,
    );
    expect(first.teams).toEqual([]);
    expect(second.context.teams).toEqual([
      { teamId: "new-team", role: "member" },
    ]);
    expect(second.settings.user?.limits).toEqual({ maxDaysAhead: 3 });
    expect(fake.select).toHaveBeenCalledTimes(6);
    expect(mocks.cacheCalls).toEqual([]);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
