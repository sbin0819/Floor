import { z } from "zod";
import manifest from "@/docs/spec/examples/seed-plans.json";
import gangnam6 from "@/docs/spec/examples/plans/gangnam-6f.plan.json";
import gangnam8 from "@/docs/spec/examples/plans/gangnam-8f.plan.json";
import seongsu2 from "@/docs/spec/examples/plans/seongsu-2f.plan.json";
import seongsu3 from "@/docs/spec/examples/plans/seongsu-3f.plan.json";
import hongdae2 from "@/docs/spec/examples/plans/hongdae-2f.plan.json";
import hongdae3 from "@/docs/spec/examples/plans/hongdae-3f.plan.json";
import yeouido10 from "@/docs/spec/examples/plans/yeouido-10f.plan.json";
import yeouido11 from "@/docs/spec/examples/plans/yeouido-11f.plan.json";
import pangyo4 from "@/docs/spec/examples/plans/pangyo-4f.plan.json";
import pangyo5 from "@/docs/spec/examples/plans/pangyo-5f.plan.json";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import type { SeedData } from "./data";

const documents: Readonly<Record<string, unknown>> = {
  "plans/gangnam-6f.plan.json": gangnam6,
  "plans/gangnam-8f.plan.json": gangnam8,
  "plans/seongsu-2f.plan.json": seongsu2,
  "plans/seongsu-3f.plan.json": seongsu3,
  "plans/hongdae-2f.plan.json": hongdae2,
  "plans/hongdae-3f.plan.json": hongdae3,
  "plans/yeouido-10f.plan.json": yeouido10,
  "plans/yeouido-11f.plan.json": yeouido11,
  "plans/pangyo-4f.plan.json": pangyo4,
  "plans/pangyo-5f.plan.json": pangyo5,
};
const uuid = z.uuid().transform((id) => id.toLowerCase());
const manifestSchema = z.strictObject({
  note: z.string(),
  floorPlans: z.array(
    z.strictObject({
      id: uuid,
      floorId: uuid,
      floorName: z.string().min(1),
      version: z.int().positive(),
      status: z.literal("published"),
      documentFile: z.string().regex(/^plans\/[a-z0-9-]+\.plan\.json$/u),
      createdByKey: z.string().min(1),
    }),
  ),
});

export function parseSeedPlans(
  input: unknown,
  seed: Pick<SeedData, "floors" | "spaces" | "users" | "floorPlans">,
  sources: Readonly<Record<string, unknown>> = documents,
) {
  const parsed = manifestSchema.parse(input);
  if (parsed.floorPlans.length !== seed.floors.length - seed.floorPlans.length)
    throw new z.ZodError([
      {
        code: "custom",
        path: ["floorPlans"],
        message: "기존 평면도를 제외한 모든 시드 층의 평면도가 필요해요.",
      },
    ]);
  const planIds = new Set(seed.floorPlans.map(({ id }) => id));
  const floorIds = new Set(seed.floorPlans.map(({ floorId }) => floorId));
  return parsed.floorPlans.map((row, index) => {
    const document = floorPlanSchema.parse(sources[row.documentFile]);
    const issues: z.core.$ZodIssue[] = [];
    const issue = (field: string, message: string) =>
      issues.push({
        code: "custom",
        path: ["floorPlans", index, field],
        message,
      });
    if (planIds.has(row.id)) issue("id", "평면도 ID가 중복돼요.");
    if (floorIds.has(row.floorId))
      issue("floorId", "이미 평면도가 있는 층이에요.");
    if (!seed.floors.some(({ id }) => id === row.floorId))
      issue("floorId", "시드에 없는 층이에요.");
    if (!seed.users.some(({ key }) => key === row.createdByKey))
      issue("createdByKey", "시드에 없는 작성자예요.");
    const shapes = new Set(document.spaces.map(({ spaceId }) => spaceId));
    for (const shape of document.spaces) {
      const space = seed.spaces.find(({ id }) => id === shape.spaceId);
      if (!space || space.floorId !== row.floorId || space.type === "desk")
        issue(
          "documentFile",
          "공간 도형은 같은 층의 비좌석 공간을 가리켜야 해요.",
        );
    }
    for (const shape of document.seats) {
      const space = seed.spaces.find(({ id }) => id === shape.spaceId);
      if (!space || space.floorId !== row.floorId || space.type !== "desk")
        issue("documentFile", "좌석 도형은 같은 층의 좌석을 가리켜야 해요.");
    }
    if (
      seed.spaces.some(
        ({ id, floorId, type }) =>
          floorId === row.floorId && type !== "desk" && !shapes.has(id),
      )
    )
      issue("documentFile", "층의 공간 도형이 빠졌어요.");
    if (issues.length) throw new z.ZodError(issues);
    planIds.add(row.id);
    floorIds.add(row.floorId);
    return {
      id: row.id,
      floorId: row.floorId,
      version: row.version,
      status: row.status,
      createdByKey: row.createdByKey,
      document,
    };
  });
}

export function loadSeedPlans(seed: SeedData) {
  return parseSeedPlans(manifest, seed);
}
export type SeedPlan = SeedData["floorPlans"][number];
