import Link from "next/link";
import { Suspense } from "react";
import { Grid2X2 } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { getAccountMenuData } from "@/features/auth/queries";
import { AccountMenu } from "@/components/account-menu";
import { MemberNav } from "@/components/member-nav";

async function HeaderAccount() {
  const session = await getSession();
  if (!session) return null;
  return <AccountMenu {...await getAccountMenuData()} />;
}

export function AccountMenuPlaceholder() {
  return (
    <div
      aria-busy="true"
      className="flex h-11 w-36 items-center gap-2 rounded-full border border-border px-2"
    >
      <span
        aria-hidden="true"
        className="size-7 shrink-0 rounded-full bg-muted"
      />
      <span aria-hidden="true" className="h-4 w-16 rounded bg-muted" />
      <span role="status" className="sr-only">
        불러오고 있어요
      </span>
    </div>
  );
}

export function AppHeader() {
  return (
    <header className="h-15 border-b border-border bg-card">
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-4 px-4 md:px-8">
        <div className="flex h-full min-w-0 items-center gap-6">
          <Link
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg text-xl font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            href="/"
          >
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"
            >
              <Grid2X2 className="size-5" />
            </span>
            Floor
          </Link>
          <Suspense
            fallback={
              <div
                aria-busy="true"
                className="hidden h-11 items-center gap-2 md:flex"
              >
                <span role="status" className="sr-only">
                  불러오고 있어요
                </span>
                {[12, 20, 16, 12].map((width, index) => (
                  <span
                    key={index}
                    aria-hidden="true"
                    className="h-8 rounded-lg bg-muted"
                    style={{ width: `${width * 4}px` }}
                  />
                ))}
              </div>
            }
          >
            <MemberNav />
          </Suspense>
        </div>
        <Suspense fallback={<AccountMenuPlaceholder />}>
          <HeaderAccount />
        </Suspense>
      </div>
    </header>
  );
}
