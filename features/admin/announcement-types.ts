import type { SpaceType } from "@/features/bookings/types";

export type AnnouncementAudience = {
  date: string;
  floorId: string | null;
  spaceId: string | null;
};
export type LoungeAvailability = {
  available: boolean;
  reason: "missing_channel" | "banned" | "space_limit" | null;
  memberCount: number;
};
export type AnnouncementFloor = {
  id: string;
  name: string;
  spaces: { id: string; name: string; type: SpaceType }[];
};
export type AnnouncementAudiencePreview = {
  branchId: string;
  lounge: LoungeAvailability;
  recipientCount: number;
};
export type AnnouncementsData = {
  branch: { id: string; name: string; timezone: string };
  now: string;
  today: string;
  maxDate: string;
  lounge: LoungeAvailability;
  floors: AnnouncementFloor[];
  rows: {
    id: string;
    title: string;
    createdAt: string;
    lounge: boolean;
    audience: boolean;
    recipientCount: number;
  }[];
};
