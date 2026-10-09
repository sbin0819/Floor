"use client";

import { createContext, useContext, useEffect } from "react";
import type { AnnouncementAudiencePreview } from "../announcement-types";

export type AnnouncementPreviewResult =
  | { ok: true; data: AnnouncementAudiencePreview }
  | { ok: false; message: string };
export const AnnouncementPreviewContext = createContext<{
  key: string | null;
  accept: (key: string, result: AnnouncementPreviewResult) => void;
} | null>(null);

export function AnnouncementPreview({
  requestKey,
  result,
}: {
  requestKey: string;
  result: AnnouncementPreviewResult;
}) {
  const context = useContext(AnnouncementPreviewContext);
  const accept = context?.accept;
  const matches = context?.key === requestKey;
  useEffect(() => {
    if (matches) accept?.(requestKey, result);
  }, [accept, matches, requestKey, result]);
  return null;
}
