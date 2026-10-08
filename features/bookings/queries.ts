import { createBookingQueries } from "@/features/bookings/query-factory";
import type { MyBookingsMonthInput } from "@/features/bookings/calendar";

export async function getHomeHeader() {
  return createBookingQueries().getHomeHeader();
}
export async function getHomeUpcomingBookings() {
  return createBookingQueries().getHomeUpcomingBookings();
}
export async function getHomeWeekBookings() {
  return createBookingQueries().getHomeWeekBookings();
}
export async function getHomeFrequentSpaces() {
  return createBookingQueries().getHomeFrequentSpaces();
}
export async function getHomeFreeSpaces() {
  return createBookingQueries().getHomeFreeSpaces();
}
export async function getHomeBookingLimits() {
  return createBookingQueries().getHomeBookingLimits();
}
export async function getBookingDestination(date?: unknown) {
  return createBookingQueries().getBookingDestination(date);
}

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
export async function getBranchNavigationStream(branchId: string) {
  return createBookingQueries().getBranchNavigationStream(branchId);
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
export async function getMyBookingsMonth(input: MyBookingsMonthInput = {}) {
  return createBookingQueries().getMyBookingsMonth(input);
}
export async function getMyBookingsMonthStream(
  input: MyBookingsMonthInput = {},
) {
  return createBookingQueries().getMyBookingsMonthStream(input);
}
