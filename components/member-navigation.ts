export const sidebarNavItems = [
  { key: "home", href: "/", label: "홈" },
  { key: "spaces", href: "/booking", label: "공간 예약" },
  { key: "bookings", href: "/bookings", label: "내 예약" },
  { key: "friends", href: "/friends", label: "친구" },
  { key: "teams", href: "/teams", label: "팀 관리" },
] as const;

export const mobileNavItems = [
  ...sidebarNavItems.slice(0, 3),
  { key: "messages", href: "/messages", label: "메시지" },
] as const;

export type MemberNavKey = (typeof sidebarNavItems)[number]["key"] | "messages";

function under(pathname: string, root: string) {
  return pathname === root || pathname.startsWith(`${root}/`);
}

export function activeMemberNav(pathname: string): MemberNavKey | null {
  if (pathname === "/") return "home";
  if (under(pathname, "/booking") || under(pathname, "/branches"))
    return "spaces";
  if (under(pathname, "/bookings")) return "bookings";
  if (under(pathname, "/friends")) return "friends";
  if (under(pathname, "/teams") || under(pathname, "/invite")) return "teams";
  if (
    under(pathname, "/messages") ||
    under(pathname, "/s") ||
    under(pathname, "/dm") ||
    under(pathname, "/m")
  )
    return "messages";
  return null;
}

export function memberSectionName(pathname: string): string | null {
  if (under(pathname, "/notifications")) return "알림";
  if (under(pathname, "/settings")) return "설정";
  const active = activeMemberNav(pathname);
  if (active === "messages") return "메시지";
  return sidebarNavItems.find((item) => item.key === active)?.label ?? null;
}
