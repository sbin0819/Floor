import Link from "next/link";
import { Suspense } from "react";
import { getSession } from "@/lib/auth/session";
import { SignOutButton } from "@/components/sign-out-button";

async function AccountMenu() {
  const session = await getSession();
  if (!session) return null;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <span className="max-w-48 truncate text-sm">{session.name}님</span>
      <SignOutButton />
    </div>
  );
}

export function AppHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex min-h-16 max-w-5xl items-center justify-between gap-4 px-6">
        <Link
          className="inline-flex min-h-11 items-center text-xl font-semibold"
          href="/"
        >
          Floor
        </Link>
        <Suspense fallback={null}>
          <AccountMenu />
        </Suspense>
      </div>
    </header>
  );
}
