import { z } from "zod";
import { localDate, localTime, zonedDateTime } from "@/lib/time/zoned";

export type MaintenanceSearch = Record<string, string | string[] | undefined>;
export type MaintenanceDialogKind = "create" | "edit" | "end" | "delete";
export type MaintenanceWindowInput = {
  spaceId: string;
  start: { kind: "now" } | { kind: "at"; at: string };
  end: string;
};
export type MaintenanceDraft = {
  spaceId: string;
  startKind: "now" | "at";
  startAt: string;
  end: string;
  reason: string;
};
const previewKeys = ["space", "start", "end", "preview"] as const;

export function maintenancePath(branchId: string) {
  return `/admin/branches/${branchId}/maintenance`;
}
export function maintenanceHref(
  branchId: string,
  values: Record<string, string | undefined> = {},
) {
  const query = new URLSearchParams();
  for (const key of ["tab", "dialog", "block", ...previewKeys]) {
    const value = values[key];
    if (value) query.set(key, value);
  }
  return `${maintenancePath(branchId)}${query.size ? `?${query}` : ""}`;
}
export function maintenanceRoute(search: MaintenanceSearch) {
  const tab = search.tab === "past" ? "past" : "active";
  const dialog =
    search.create === "1"
      ? "create"
      : ["create", "edit", "end", "delete"].includes(String(search.dialog)) &&
          typeof search.dialog === "string"
        ? (search.dialog as MaintenanceDialogKind)
        : null;
  const block = z.uuid().safeParse(search.block);
  return {
    tab,
    dialog,
    blockId: block.success ? block.data.toLowerCase() : null,
  } as const;
}
export function maintenancePreviewKey(input: MaintenanceWindowInput) {
  return JSON.stringify([
    input.spaceId,
    input.start.kind === "now" ? "now" : input.start.at,
    input.end,
  ]);
}
export function maintenancePreviewRequest(search: MaintenanceSearch) {
  const space = z.uuid().safeParse(search.space);
  const end = z.iso.datetime({ offset: true }).safeParse(search.end);
  const start = z.iso.datetime({ offset: true }).safeParse(search.start);
  if (
    !space.success ||
    !end.success ||
    (search.start !== "now" && !start.success) ||
    typeof search.preview !== "string" ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(search.preview)
  )
    return null;
  const input: MaintenanceWindowInput = {
    spaceId: space.data.toLowerCase(),
    start:
      search.start === "now"
        ? { kind: "now" }
        : { kind: "at", at: new Date(start.data!).toISOString() },
    end: new Date(end.data).toISOString(),
  };
  return {
    input,
    inputKey: maintenancePreviewKey(input),
    nonce: search.preview,
  };
}
export type MaintenanceRequest = NonNullable<
  ReturnType<typeof maintenancePreviewRequest>
>;

export function maintenanceLocalValue(iso: string, timezone: string) {
  const instant = new Date(iso);
  return `${localDate(instant, timezone)}T${localTime(instant, timezone)}`;
}
function localInstant(value: string, timezone: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(00|30)$/.exec(value);
  if (!match) return null;
  try {
    const at = zonedDateTime(match[1]!, `${match[2]}:${match[3]}`, timezone);
    // DST로 존재하지 않는 시각을 다른 시각으로 조용히 바꾸지 않아요.
    return maintenanceLocalValue(at.toISOString(), timezone) === value
      ? at.toISOString()
      : null;
  } catch {
    return null;
  }
}
export function maintenanceDraftWindow(
  draft: Omit<MaintenanceDraft, "reason">,
  timezone: string,
): MaintenanceWindowInput | null {
  if (!z.uuid().safeParse(draft.spaceId).success) return null;
  const end = localInstant(draft.end, timezone);
  const at = localInstant(draft.startAt, timezone);
  if (!end || (draft.startKind === "at" && (!at || at >= end))) return null;
  return {
    spaceId: draft.spaceId,
    start:
      draft.startKind === "now" ? { kind: "now" } : { kind: "at", at: at! },
    end,
  };
}
export function maintenanceInitialDraft(
  now: string,
  timezone: string,
  initial?: {
    spaceId: string;
    start: string;
    end: string;
    reason: string | null;
  },
  request?: MaintenanceRequest | null,
): MaintenanceDraft {
  const next = new Date(
    Math.floor(new Date(now).getTime() / 1_800_000) * 1_800_000 + 1_800_000,
  ).toISOString();
  return {
    spaceId: initial?.spaceId ?? request?.input.spaceId ?? "",
    startKind: request ? request.input.start.kind : initial ? "at" : "now",
    startAt: maintenanceLocalValue(
      (request?.input.start.kind === "at"
        ? request.input.start.at
        : initial?.start) ?? next,
      timezone,
    ),
    end: maintenanceLocalValue(
      request?.input.end ?? initial?.end ?? next,
      timezone,
    ),
    reason: initial?.reason ?? "",
  };
}
export function maintenancePreviewHref(
  branchId: string,
  search: URLSearchParams,
  request: MaintenanceRequest,
) {
  const values = Object.fromEntries(search);
  return maintenanceHref(branchId, {
    ...values,
    dialog: search.get("create") === "1" ? "create" : values.dialog,
    space: request.input.spaceId,
    start: request.input.start.kind === "now" ? "now" : request.input.start.at,
    end: request.input.end,
    preview: request.nonce,
  });
}
export function maintenanceCloseHref(
  branchId: string,
  search: URLSearchParams,
) {
  return maintenanceHref(branchId, { tab: search.get("tab") ?? undefined });
}
