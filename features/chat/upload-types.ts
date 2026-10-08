export type UploadTarget = {
  attachmentId: string;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
};

export type CompletedUpload = {
  attachmentId: string;
  name: string;
  size: number;
  kind: "image" | "file";
  width: number | null;
  height: number | null;
};

export type UploadCompletion =
  | (CompletedUpload & { ok: true })
  | {
      attachmentId: string;
      ok: false;
      reason: "not_found" | "not_uploaded" | "size_mismatch" | "blocked_type";
    };

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_STORAGE_BYTES = 1024 * 1024 * 1024;
export const UPLOAD_LIFETIME_MS = 24 * 60 * 60 * 1000;
