"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  createUploads,
  completeUploads,
  discardUploads,
} from "../upload-actions";
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
  const uploads = useMemo(
    () =>
      createUploadController({
        roomId,
        actions,
        upload: uploadFile,
        notify: (message) => toast.error(message),
        objectUrls: {
          create: (file) => URL.createObjectURL(file),
          revoke: (url) => URL.revokeObjectURL(url),
        },
      }),
    [roomId],
  );
  useEffect(() => {
    uploads.activate();
    return () => uploads.dispose();
  }, [uploads]);
  useEffect(() => uploads.setUnavailable(unavailable), [uploads, unavailable]);
  return uploads;
}
