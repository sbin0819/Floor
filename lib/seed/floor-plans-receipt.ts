import { createHash } from "node:crypto";
import { z } from "zod";
import { SeedError } from "./errors";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const floorPlansReceiptSchema = z.strictObject({
  version: z.literal(1),
  mode: z.literal("floor-plans"),
  targetHash: digest,
  manifestHash: digest,
  appliedAt: z.iso.datetime(),
  added: z.array(
    z.strictObject({
      id: z.uuid(),
      floorId: z.uuid(),
      createdBy: z.uuid(),
    }),
  ),
  skipped: z.array(
    z.strictObject({
      floorId: z.uuid(),
      reason: z.enum(["missing_floor", "existing_plan", "changed_spaces"]),
    }),
  ),
});
export type FloorPlansReceipt = z.infer<typeof floorPlansReceiptSchema>;
export type FloorPlansOptions = {
  targetHash: string;
  databaseName: string;
  receipt: FloorPlansReceipt | null;
};
// 호스트가 같아도 다른 DB의 적용 기록을 재사용하지 않는다. DB 이름은 대소문자를 보존한다.
export function floorPlansTarget(connectionString: string) {
  try {
    const original = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(original.protocol))
      throw new Error();
    const url = new URL(
      `http:${connectionString.slice(original.protocol.length)}`,
    );
    const hostname = url.hostname;
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    const forbidden = new Set([
      "host",
      "hostaddr",
      "database",
      "dbname",
      "port",
    ]);
    if (
      !hostname ||
      !databaseName ||
      databaseName.includes("\u0000") ||
      // 드라이버가 DB 이름을 한 번 더 디코딩하므로 %25 등을 포함한 특이 이름은 지원하지 않는다.
      databaseName.includes("%") ||
      [...url.searchParams.keys()].some((key) =>
        forbidden.has(key.toLowerCase()),
      )
    )
      throw new Error();
    return {
      hostname,
      databaseName,
      targetHash: hashFloorPlansValue([hostname, databaseName]),
    };
  } catch {
    throw new SeedError(
      "평면도 시드의 대상 호스트와 DB 이름을 확인할 수 없어요.",
    );
  }
}
export function hashFloorPlansValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function validateFloorPlansOptions(input: FloorPlansOptions) {
  if (
    !digest.safeParse(input.targetHash).success ||
    !input.databaseName ||
    input.databaseName.includes("\u0000") ||
    input.databaseName.includes("%")
  )
    throw new SeedError("평면도 시드 대상 확인 값이 올바르지 않아요.");
  if (input.receipt === null) return null;
  const result = floorPlansReceiptSchema.safeParse(input.receipt);
  if (!result.success || result.data.targetHash !== input.targetHash)
    throw new SeedError("평면도 완료 기록이 올바르지 않거나 대상이 달라요.");
  const rows = result.data;
  const floors = [
    ...rows.added.map(({ floorId }) => floorId),
    ...rows.skipped.map(({ floorId }) => floorId),
  ];
  if (
    new Set(floors).size !== floors.length ||
    new Set(rows.added.map(({ id }) => id)).size !== rows.added.length
  )
    throw new SeedError("평면도 완료 기록에 중복된 층이나 평면도가 있어요.");
  return rows;
}
