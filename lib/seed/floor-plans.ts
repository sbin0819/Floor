import * as dal from "@/lib/dal/seed-floor-plans";
import type { DalDatabase } from "@/lib/dal";
import type { SeedData } from "./data";
import type { SeedPlan } from "./plans";
import type { SeedResult } from "./run-seed";
import { SeedError } from "./errors";
import {
  hashFloorPlansValue,
  validateFloorPlansOptions,
  type FloorPlansOptions,
  type FloorPlansReceipt,
} from "./floor-plans-receipt";

export async function applyFloorPlansSeed(
  input: FloorPlansOptions & {
    data: SeedData;
    plans: SeedPlan[];
    now: Date;
  },
  database: DalDatabase,
): Promise<SeedResult> {
  const receipt = validateFloorPlansOptions(input);
  const plans = [...input.plans].sort((a, b) =>
    a.floorId.localeCompare(b.floorId),
  );
  const floorIds = plans.map(({ floorId }) => floorId);
  const manifestHash = hashFloorPlansValue(plans);
  const stop = () => {
    throw new SeedError(
      "평면도 시드의 기존 데이터나 완료 기록이 달라요. 자동 복구하지 말고 확인해 주세요.",
    );
  };
  if (
    !Number.isFinite(input.now.getTime()) ||
    !plans.length ||
    (receipt &&
      (receipt.manifestHash !== manifestHash ||
        new Date(receipt.appliedAt) > input.now))
  )
    stop();
  await dal.prepareFloorPlansDatabase(input.databaseName, database);
  const floorRows = await dal.lockSeedPlanFloors(floorIds, database);
  for (const floorId of floorIds) {
    const floor = floorRows.find(({ id }) => id === floorId);
    if (
      !floor ||
      floor.branchId !==
        input.data.floors.find(({ id }) => id === floorId)?.branchId
    )
      stop();
  }
  const rows = await dal.readSeedPlanRows(
    floorIds,
    plans.map(({ id }) => id),
    database,
  );
  if (receipt) {
    const covered = [
      ...receipt.added.map(({ floorId }) => floorId),
      ...receipt.skippedFloorIds,
    ].sort();
    if (JSON.stringify(covered) !== JSON.stringify([...floorIds].sort()))
      stop();
    for (const anchor of receipt.added) {
      const plan = plans.find(({ id }) => id === anchor.id);
      const row = rows.find(({ id }) => id === anchor.id);
      // 운영자가 바꾼 문서·게시 상태·연결은 재실행으로 되돌리지 않는다.
      if (
        !plan ||
        plan.floorId !== anchor.floorId ||
        !row ||
        row.floorId !== anchor.floorId ||
        row.version !== plan.version ||
        row.createdBy !== anchor.createdBy ||
        row.createdAt.toISOString() !== receipt.appliedAt
      )
        stop();
    }
    return {
      counts: { floorPlans: 0 },
      accounts: [],
      skippedBookings: 0,
      floorPlans: { applied: false, receipt },
    };
  }
  const skippedFloorIds: string[] = [];
  const pending: SeedPlan[] = [];
  for (const plan of plans) {
    if (rows.some(({ floorId }) => floorId === plan.floorId)) {
      skippedFloorIds.push(plan.floorId);
      continue;
    }
    if (
      rows.some(({ id }) => id === plan.id) ||
      floorRows.find(({ id }) => id === plan.floorId)?.publishedPlanId !== null
    )
      stop();
    pending.push(plan);
  }
  const shapeIds = pending.flatMap(({ document }) =>
    [...document.spaces, ...document.seats].map(({ spaceId }) => spaceId),
  );
  const spaces = shapeIds.length
    ? await dal.lockSeedPlanSpaces(shapeIds, database)
    : [];
  for (const plan of pending) {
    for (const [collection, desk] of [
      [plan.document.spaces, false],
      [plan.document.seats, true],
    ] as const) {
      for (const shape of collection) {
        const row = spaces.find(({ id }) => id === shape.spaceId);
        if (
          !row ||
          row.floorId !== plan.floorId ||
          (row.type === "desk") !== desk
        )
          stop();
      }
    }
  }
  const keys = [...new Set(pending.map(({ createdByKey }) => createdByKey))];
  const emails = keys.map((key) => {
    const user = input.data.users.find((row) => row.key === key);
    if (!user) throw new SeedError("평면도 작성자 참조가 없어요.");
    return user.email;
  });
  const authors = emails.length
    ? await dal.lockSeedPlanAuthors(emails, database)
    : [];
  const ids = new Map(
    keys.map((key, index) => {
      const author = authors.find(({ email }) => email === emails[index]);
      if (!author?.emailVerified)
        throw new SeedError("평면도 작성자의 기존 인증 완료 계정이 필요해요.");
      return [key, author.id];
    }),
  );
  const added: FloorPlansReceipt["added"] = [];
  for (const { createdByKey, ...plan } of pending) {
    const createdBy = ids.get(createdByKey)!;
    await dal.insertSeedFloorPlan(
      { ...plan, createdBy, createdAt: input.now, publishedAt: input.now },
      database,
    );
    added.push({ id: plan.id, floorId: plan.floorId, createdBy });
  }
  return {
    counts: { floorPlans: added.length },
    accounts: [],
    skippedBookings: 0,
    floorPlans: {
      applied: true,
      receipt: {
        version: 1,
        mode: "floor-plans",
        targetHash: input.targetHash,
        manifestHash,
        appliedAt: input.now.toISOString(),
        added,
        skippedFloorIds,
      },
    },
  };
}
