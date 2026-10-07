import { createBookingQueries } from "@/features/bookings/query-factory";

export async function getBranchList() {
  return createBookingQueries().getBranchList();
}
export async function getBookingEntry() {
  return createBookingQueries().getBookingEntry();
}
export async function getBranchFloors(branchId: string) {
  return createBookingQueries().getBranchFloors(branchId);
}
export async function getBranchNavigation(branchId: string) {
  return createBookingQueries().getBranchNavigation(branchId);
}
export async function getFloorDay(
  branchId: string,
  floorId: string,
  date?: unknown,
) {
  return createBookingQueries().getFloorDay(branchId, floorId, date);
}
export async function getSpaceDay(
  branchId: string,
  floorId: string,
  spaceId: string,
  date?: unknown,
) {
  return createBookingQueries().getSpaceDay(branchId, floorId, spaceId, date);
}
export async function getMyBookings() {
  return createBookingQueries().getMyBookings();
}
