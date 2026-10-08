import { Suspense } from "react";
import { MemberNav } from "@/components/member-nav";

export function MobileNav() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card px-2 pb-[env(safe-area-inset-bottom)] md:hidden [#content:has([data-chat-screen])_&]:hidden">
      <Suspense
        fallback={
          <div
            aria-busy="true"
            className="grid h-16 grid-cols-4 items-center gap-4 px-4"
          >
            <span role="status" className="sr-only">
              불러오고 있어요
            </span>
            {[0, 1, 2, 3].map((key) => (
              <span
                key={key}
                aria-hidden="true"
                className="mx-auto h-10 w-12 rounded-lg bg-muted"
              />
            ))}
          </div>
        }
      >
        <MemberNav mobile />
      </Suspense>
    </div>
  );
}
