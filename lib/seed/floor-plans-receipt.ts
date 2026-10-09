import { createHash } from "node:crypto";
import { z } from "zod";
import { chatSpacesTarget } from "./chat-spaces-receipt";
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
  skippedFloorIds: z.array(z.uuid()),
});
export type FloorPlansReceipt = z.infer<typeof floorPlansReceiptSchema>;
export type FloorPlansOptions = {
  targetHash: string;
  databaseName: string;
  receipt: FloorPlansReceipt | null;
};
export function floorPlansTarget(connectionString: string) {
  try {
    return chatSpacesTarget(connectionString);
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
    ...rows.skippedFloorIds,
  ];
  if (
    new Set(floors).size !== floors.length ||
    new Set(rows.added.map(({ id }) => id)).size !== rows.added.length
  )
    throw new SeedError("평면도 완료 기록에 중복된 층이나 평면도가 있어요.");
  return rows;
}
