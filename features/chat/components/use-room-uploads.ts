"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { notifySessionExpired } from "@/lib/errors/session-expired";
import {
  createUploads,
  completeUploads,
  discardUploads,
} from "@/features/chat/upload-actions";
import { createUploadController } from "../upload-controller";
import { uploadFile } from "../upload-file";

const actions = {
  create: createUploads,
  complete: completeUploads,
  discard: discardUploads,
};
const online = () => navigator.onLine;
const onlineServer = () => true;
const subscribeOnline = (listener: () => void) => {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
};
export const useUploadOnline = () =>
  useSyncExternalStore(subscribeOnline, online, onlineServer);
export function useRoomUploads(roomId: string, unavailable: string | null) {
  const client = useQueryClient();
  const uploads = useMemo(
    () =>
      createUploadController({
        roomId,
        actions,
        upload: uploadFile,
        notify: (message) => toast.error(message),
        reportError: (error) => notifySessionExpired(client, error),
        objectUrls: {
          create: (file) => URL.createObjectURL(file),
          revoke: (url) => URL.revokeObjectURL(url),
        },
      }),
    [roomId, client],
  );
  useEffect(() => {
    uploads.activate();
    return () => uploads.dispose();
  }, [uploads]);
  useEffect(() => uploads.setUnavailable(unavailable), [uploads, unavailable]);
  return uploads;
}
