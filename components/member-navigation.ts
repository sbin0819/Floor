export const memberNavItems = [
  { key: "home", href: "/", label: "홈" },
  { key: "spaces", href: "/booking", label: "공간 예약" },
  { key: "bookings", href: "/bookings", label: "내 예약" },
  { key: "teams", href: "/teams", label: "팀" },
] as const;

export type MemberNavKey = (typeof memberNavItems)[number]["key"];

function under(pathname: string, root: string) {
  return pathname === root || pathname.startsWith(`${root}/`);
}

export function activeMemberNav(pathname: string): MemberNavKey | null {
  if (pathname === "/") return "home";
  if (under(pathname, "/booking") || under(pathname, "/branches"))
    return "spaces";
  if (under(pathname, "/bookings")) return "bookings";
  if (under(pathname, "/teams") || under(pathname, "/invite")) return "teams";
  return null;
}

export function memberSectionName(pathname: string): string | null {
  if (under(pathname, "/notifications")) return "알림";
  const active = activeMemberNav(pathname);
  return memberNavItems.find((item) => item.key === active)?.label ?? null;
}
