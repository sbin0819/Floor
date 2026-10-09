import { z } from "zod";

const uuid = z.uuid();
const keyPattern =
  /^(?:pending\/([^/]+)|plan-backgrounds\/([^/]+)\/([^/]+)|space-photos\/([^/]+))\.webp$/;

export function assertAdminObjectKey(key: string): void {
  const match = keyPattern.exec(key);
  const ids = match?.slice(1).filter((value) => value !== undefined);
  if (
    match?.[0] !== key ||
    !ids?.length ||
    ids.some((id) => id !== id.toLowerCase() || !uuid.safeParse(id).success)
  )
    throw new Error("Invalid admin object key.");
}

export function adminObjectKey(
  target:
    | { kind: "pending"; uploadId: string }
    | { kind: "plan-background"; planId: string; uploadId: string }
    | { kind: "space-photo"; photoId: string },
): string {
  const key =
    target.kind === "pending"
      ? `pending/${target.uploadId}.webp`
      : target.kind === "plan-background"
        ? `plan-backgrounds/${target.planId}/${target.uploadId}.webp`
        : `space-photos/${target.photoId}.webp`;
  assertAdminObjectKey(key);
  return key;
}
