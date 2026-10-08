import { NextResponse, type NextRequest } from "next/server";
import { hasSessionCookie } from "@/lib/auth/cookies";
import { safeNext } from "@/lib/auth/safe-next";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/admin/login" || hasSessionCookie(request.headers))
    return NextResponse.next();
  if (pathname === "/admin" || pathname.startsWith("/admin/"))
    return NextResponse.redirect(new URL("/admin/login", request.url));
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "next",
    safeNext(`${pathname}${search}`, request.nextUrl.origin),
  );
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // /api/uploads는 포함하지 않는다. Proxy의 몸통 복제가 25MB 스트림을 잘라낼 수 있다.
  matcher: [
    "/",
    "/admin/:path*",
    "/teams/:path*",
    "/invite/:path*",
    "/branches/:path*",
    "/bookings/:path*",
    "/booking",
    "/notifications",
    "/s/:path*",
    "/messages/:path*",
    "/dm/:path*",
    "/m/:path*",
    "/friends",
    "/settings/:path*",
  ],
};
