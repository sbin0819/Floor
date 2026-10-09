import { z } from "zod";
import { photoAltSchema } from "@/lib/photos/schema";

export const SPACE_PHOTO_MAX_BYTES = 1024 * 1024;
export const SPACE_PHOTO_UPLOAD_LIMIT = 8;
export const SPACE_PHOTO_EXPIRY_SECONDS = 300;
export const SPACE_PHOTO_SIZE = { width: 1200, height: 750 } as const;
const id = z.uuid().transform((value) => value.toLowerCase());
const alt = z
  .string()
  .trim()
  .refine((value) => !value.includes("\0"), {
    message: "사진 설명을 확인해 주세요.",
  })
  .pipe(photoAltSchema);

export const createSpacePhotoUploadSchema = z.strictObject({
  spaceId: id,
  size: z.number().int().min(1).max(SPACE_PHOTO_MAX_BYTES),
});
export const confirmSpacePhotoUploadSchema = z.strictObject({
  spaceId: id,
  uploadId: id,
  alt,
});
export const reorderSpacePhotosSchema = z.strictObject({
  spaceId: id,
  photoIds: z
    .array(id)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const updateSpacePhotoAltSchema = z.strictObject({ photoId: id, alt });
export const deleteSpacePhotoSchema = z.strictObject({ photoId: id });
export type CreateSpacePhotoUploadResult = { uploadId: string; url: string };
export type ConfirmSpacePhotoUploadResult = { photoId: string };
export type SpacePhotoMutationResult = { spaceId: string };
