import { createHash } from "node:crypto";
import { z } from "zod";
import { SeedError } from "./errors";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const chatSpacesReceiptSchema = z.strictObject({
  version: z.literal(1),
  mode: z.literal("chat-spaces"),
  targetHash: digest,
  manifestHash: digest,
  appliedAt: z.iso.datetime(),
  bundleHash: digest,
  lounges: z
    .array(
      z.strictObject({
        branchId: z.uuid(),
        spaceId: z.uuid(),
        roomId: z.uuid(),
      }),
    )
    .min(1),
});
export type ChatSpacesReceipt = z.infer<typeof chatSpacesReceiptSchema>;
export type ChatSpacesOptions = {
  targetHash: string;
  databaseName: string;
  receipt: ChatSpacesReceipt | null;
};

export function hashChatSpacesValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// 호스트가 같아도 다른 DB의 적용 기록을 재사용하지 않는다. DB 이름은 대소문자를 보존한다.
export function chatSpacesTarget(connectionString: string) {
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
      targetHash: hashChatSpacesValue([hostname, databaseName]),
    };
  } catch {
    throw new SeedError(
      "스페이스 시드의 대상 호스트와 DB 이름을 확인할 수 없어요.",
    );
  }
}

export function validateChatSpacesOptions(
  input: ChatSpacesOptions,
): ChatSpacesReceipt | null {
  if (
    !digest.safeParse(input.targetHash).success ||
    !input.databaseName ||
    input.databaseName.includes("\u0000") ||
    input.databaseName.includes("%")
  )
    throw new SeedError("스페이스 시드 대상 확인 값이 올바르지 않아요.");
  if (input.receipt === null) return null;
  const parsed = chatSpacesReceiptSchema.safeParse(input.receipt);
  if (
    !parsed.success ||
    parsed.data.targetHash !== input.targetHash ||
    new Set(parsed.data.lounges.map(({ branchId }) => branchId)).size !==
      parsed.data.lounges.length
  )
    throw new SeedError("스페이스 완료 기록이 올바르지 않거나 대상이 달라요.");
  return parsed.data;
}
