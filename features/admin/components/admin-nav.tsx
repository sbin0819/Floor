import Link from "next/link";

export function AdminNav() {
  return (
    <nav aria-label="운영자 메뉴" className="space-y-2">
      <Link
        href="/admin"
        aria-current="page"
        className="flex min-h-11 items-center rounded-lg bg-sidebar-accent px-4 text-sidebar-accent-foreground"
      >
        지점
      </Link>
      <Link
        href="/"
        className="flex min-h-11 items-center rounded-lg px-4 hover:bg-sidebar-accent"
      >
        멤버 화면으로
      </Link>
    </nav>
  );
}
