import type { Avatar } from "@/lib/avatar";
import type { DeskPart } from "@/features/bookings/desk-parts";
import type { SpaceType } from "@/features/bookings/types";

export type AdminBookingRow = {
  id: string;
  start: string;
  end: string;
  floorName: string;
  spaceName: string;
  spaceType: SpaceType;
  areaName: string | null;
  deskPart: DeskPart | null;
  bookerName: string;
  avatar: Avatar;
  teamName: string | null;
  title: string | null;
  attendeeCount: number | null;
  participantCount: number;
  status: "confirmed" | "cancelled";
  cancelledByOwner: boolean;
  cancelKind: "operator" | "maintenance" | null;
  cancelReason: string | null;
  canCancel: boolean;
};
export type AdminBookingsData = {
  branch: { id: string; name: string; timezone: string };
  floors: { id: string; name: string }[];
  filters: {
    date: string;
    days: 1 | 7;
    floorId?: string;
    type?: SpaceType;
    status: "confirmed" | "cancelled" | "all";
    q: string;
    page: number;
  };
  now: string;
  total: number;
  rows: AdminBookingRow[];
};
