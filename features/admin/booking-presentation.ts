import type { AdminBookingRow, AdminBookingsData } from "./booking-types";

export function adminBookingStatus(
  row: Pick<AdminBookingRow, "status" | "cancelKind" | "cancelledByOwner">,
) {
  if (row.status === "confirmed") return "확정";
  return `취소됨 · ${row.cancelKind === "operator" ? "운영자" : row.cancelKind === "maintenance" ? "점검" : row.cancelledByOwner ? "본인" : "다른 사람"}`;
}
export function adminBookingsHref(
  branchId: string,
  filters: AdminBookingsData["filters"],
) {
  const query = new URLSearchParams({
    date: filters.date,
    days: String(filters.days),
    status: filters.status,
  });
  if (filters.floorId) query.set("floor", filters.floorId);
  if (filters.type) query.set("type", filters.type);
  if (filters.q) query.set("q", filters.q);
  if (filters.page > 1) query.set("page", String(filters.page));
  return `/admin/branches/${branchId}/bookings?${query}`;
}
