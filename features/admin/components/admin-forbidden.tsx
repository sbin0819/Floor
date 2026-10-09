import Link from "next/link";

export function AdminForbidden() {
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6 lg:p-8">
      <h1 className="text-xl font-semibold">이 일을 할 권한이 꺼져 있어요</h1>
      <p className="text-sm text-muted-foreground">
        다른 메뉴를 고르거나 운영 지점을 확인해 주세요.
      </p>
      <Link
        href="/admin"
        className="inline-flex min-h-11 items-center rounded-sm underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        운영자 홈으로
      </Link>
    </main>
  );
}
