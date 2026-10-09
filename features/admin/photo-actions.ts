"use server";

import { createSpacePhotoActions } from "./photo-action-factory";

export async function createSpacePhotoUpload(input: unknown) {
  return createSpacePhotoActions().createSpacePhotoUpload(input);
}
export async function confirmSpacePhotoUpload(input: unknown) {
  return createSpacePhotoActions().confirmSpacePhotoUpload(input);
}
export async function reorderSpacePhotos(input: unknown) {
  return createSpacePhotoActions().reorderSpacePhotos(input);
}
export async function updateSpacePhotoAlt(input: unknown) {
  return createSpacePhotoActions().updateSpacePhotoAlt(input);
}
export async function deleteSpacePhoto(input: unknown) {
  return createSpacePhotoActions().deleteSpacePhoto(input);
}
