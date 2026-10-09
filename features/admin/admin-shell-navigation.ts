import type { AdminMenu, AdminShellBranch } from "./admin-shell-types";

export const adminMenuLabels: Record<AdminMenu, string> = {
  dashboard: "대시보드",
  bookings: "예약 현황",
  spaces: "공간 관리",
  maintenance: "점검",
};

export function adminMenuHref(branchId: string, menu: AdminMenu) {
  const base = `/admin/branches/${encodeURIComponent(branchId)}`;
  return menu === "dashboard" ? base : `${base}/${menu}`;
}

export function adminMenuAt(
  pathname: string,
  branchId: string,
): AdminMenu | null {
  const base = adminMenuHref(branchId, "dashboard");
  if (pathname === base || pathname === `${base}/`) return "dashboard";
  if (pathname === `${base}/bookings`) return "bookings";
  if (pathname === `${base}/maintenance`) return "maintenance";
  if (pathname === `${base}/spaces` || pathname.startsWith(`${base}/floors/`))
    return "spaces";
  return null;
}

export function adminBranchHref(
  pathname: string,
  currentBranchId: string,
  target: AdminShellBranch,
) {
  const currentMenu = adminMenuAt(pathname, currentBranchId);
  const isTopLevel =
    currentMenu !== null &&
    pathname.replace(/\/$/, "") === adminMenuHref(currentBranchId, currentMenu);
  const menu =
    isTopLevel && currentMenu !== null && target.menus.includes(currentMenu)
      ? currentMenu
      : target.menus[0];
  return adminMenuHref(target.id, menu ?? "dashboard");
}
