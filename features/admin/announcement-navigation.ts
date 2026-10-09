import { z } from "zod";

export type AnnouncementSearch = Record<string, string | string[] | undefined>;
export type AnnouncementTargetInput = {
  branchId: string;
  lounge: boolean;
  audience: {
    date: string;
    floorId: string | null;
    spaceId: string | null;
  } | null;
};
export type AnnouncementPreviewRequest = {
  input: AnnouncementTargetInput;
  inputKey: string;
  nonce: string;
};

export function announcementPath(branchId: string) {
  return `/admin/branches/${encodeURIComponent(branchId)}/announcements`;
}
export function announcementTargetKey(input: AnnouncementTargetInput) {
  return JSON.stringify([
    input.branchId,
    input.lounge,
    input.audience?.date ?? null,
    input.audience?.floorId ?? null,
    input.audience?.spaceId ?? null,
  ]);
}
export function announcementPreviewHref(request: AnnouncementPreviewRequest) {
  const query = new URLSearchParams({
    preview: request.nonce,
    lounge: request.input.lounge ? "1" : "0",
  });
  const audience = request.input.audience;
  if (audience) {
    query.set("date", audience.date);
    if (audience.floorId) query.set("floor", audience.floorId);
    if (audience.spaceId) query.set("space", audience.spaceId);
  }
  return `${announcementPath(request.input.branchId)}?${query}`;
}
export function announcementPreviewRequest(
  branchId: string,
  search: AnnouncementSearch,
): AnnouncementPreviewRequest | null {
  const nonce = z.uuid().safeParse(search.preview);
  const branch = z.uuid().safeParse(branchId);
  if (
    !nonce.success ||
    !branch.success ||
    !["0", "1"].includes(String(search.lounge))
  )
    return null;
  if (typeof search.lounge !== "string") return null;
  const date = z.iso.date().safeParse(search.date);
  const floor = z.uuid().safeParse(search.floor);
  const space = z.uuid().safeParse(search.space);
  if (
    (search.date !== undefined && !date.success) ||
    (search.floor !== undefined && !floor.success) ||
    (search.space !== undefined && !space.success) ||
    ((floor.success || space.success) && !date.success) ||
    (space.success && !floor.success)
  )
    return null;
  const input: AnnouncementTargetInput = {
    branchId: branch.data.toLowerCase(),
    lounge: search.lounge === "1",
    audience: date.success
      ? {
          date: date.data,
          floorId: floor.success ? floor.data.toLowerCase() : null,
          spaceId: space.success ? space.data.toLowerCase() : null,
        }
      : null,
  };
  return { input, inputKey: announcementTargetKey(input), nonce: nonce.data };
}

export function announcementSendLabel(
  lounge: boolean,
  audience: boolean,
  count: number | null,
) {
  if (audience && count === null) return "받는 사람 확인 중";
  if (lounge && audience) return `보내기 · 라운지와 ${count}명`;
  if (lounge) return "보내기 · 라운지";
  if (audience) return `보내기 · ${count}명`;
  return "보내기";
}
