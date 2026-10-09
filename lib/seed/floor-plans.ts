import * as dal from "@/lib/dal/seed-floor-plans";
import { putSeedPlan } from "@/lib/dal/seed";
import type { DalDatabase } from "@/lib/dal";
import type { SeedData } from "./data";
import type { SeedPlan } from "./seed-plans";
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
  validateFloorPlansOptions(input);
  const plans = [...input.plans].sort((a, b) =>
    a.floorId.localeCompare(b.floorId),
  );
  const floorIds = plans.map(({ floorId }) => floorId);
  const stop = () => {
    throw new SeedError(
      "평면도 시드의 고정 식별자나 부모 관계가 달라요. 자동 복구하지 말고 확인해 주세요.",
    );
  };
  if (!Number.isFinite(input.now.getTime()) || !plans.length) stop();
  await dal.prepareFloorPlansDatabase(input.databaseName, database);
  const floorRows = await dal.lockSeedPlanFloors(floorIds, database);
  const rows = await dal.readSeedPlanRows(
    floorIds,
    plans.map(({ id }) => id),
    database,
  );
  const spaces = await dal.lockSeedPlanSpaces(
    floorRows.map(({ id }) => id),
    database,
  );
  const skipped: FloorPlansReceipt["skipped"] = [];
  const pending: SeedPlan[] = [];
  // 표식은 감사 기록일 뿐이다. 매 실행마다 잠근 현재 DB 행으로 빈 층을 다시 찾는다.
  for (const plan of plans) {
    const fixed = rows.find(({ id }) => id === plan.id);
    if (fixed && fixed.floorId !== plan.floorId) stop();
    const floor = floorRows.find(({ id }) => id === plan.floorId);
    if (!floor) {
      skipped.push({ floorId: plan.floorId, reason: "missing_floor" });
      continue;
    }
    if (
      floor.branchId !==
      input.data.floors.find(({ id }) => id === floor.id)?.branchId
    )
      stop();
    if (rows.some(({ floorId }) => floorId === plan.floorId)) {
      skipped.push({ floorId: plan.floorId, reason: "existing_plan" });
      continue;
    }
    if (floor.publishedPlanId !== null) stop();
    const actual = spaces
      .filter(
        (space) =>
          space.floorId === floor.id &&
          space.archivedAt === null &&
          space.type !== "desk",
      )
      .map(({ id }) => id)
      .sort();
    const expected = plan.document.spaces.map(({ spaceId }) => spaceId).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      skipped.push({ floorId: plan.floorId, reason: "changed_spaces" });
      continue;
    }
    pending.push(plan);
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
    if (
      !(await putSeedPlan(
        { ...plan, createdBy, createdAt: input.now, publishedAt: input.now },
        database,
      ))
    )
      stop();
    added.push({ id: plan.id, floorId: plan.floorId, createdBy });
  }
  return {
    counts: { floorPlans: added.length },
    accounts: [],
    skippedBookings: 0,
    floorPlans: {
      applied: added.length > 0,
      receipt: {
        version: 1,
        mode: "floor-plans",
        targetHash: input.targetHash,
        manifestHash: hashFloorPlansValue(plans),
        appliedAt: input.now.toISOString(),
        added,
        skipped,
      },
    },
  };
}
