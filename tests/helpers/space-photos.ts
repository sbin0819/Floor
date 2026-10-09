import type { AdminSpacePhoto } from "@/features/admin/space-detail-types";
export const photoSpaceId = "e3000000-0000-4000-8000-000000000003";
export const photoPath = `/admin/branches/e3000000-0000-4000-8000-000000000001/floors/e3000000-0000-4000-8000-000000000002/spaces/${photoSpaceId}`;
export function adminPhotosFixture(count = 3): AdminSpacePhoto[] {
  const files = [
    "meeting-small-sage",
    "meeting-small-sand",
    "phone-booth-sand",
  ];
  return Array.from({ length: count }, (_, index) => ({
    id: `e3100000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    path: `/seed/photos/${files[index % files.length]}.webp`,
    alt: `공간 사진 ${index + 1}`,
    sortOrder: index,
  }));
}
