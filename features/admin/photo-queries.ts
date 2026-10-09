import { createSpacePhotoQueries } from "./photo-query-factory";

export async function getSpacePhoto(file: string) {
  return createSpacePhotoQueries().getSpacePhoto(file);
}
