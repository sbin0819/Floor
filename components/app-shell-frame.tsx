"use client";

import Link from "next/link";
import { Grid2X2, Menu, X } from "lucide-react";
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CloseOnRouteChange,
  MemberSectionName,
} from "@/components/member-shell-route";

export type AppShellFrameProps = {
  children: ReactNode;
  menu: ReactNode;
  accountCard: ReactNode;
  accountAvatar: ReactNode;
  notifications: ReactNode;
};

function AppRail({
  avatar,
  drawer = false,
}: {
  avatar?: ReactNode;
  drawer?: boolean;
}) {
  return (
    <div
      data-slot={drawer ? "drawer-rail" : "app-rail"}
      className={cn(
        "w-[72px] shrink-0 flex-col items-center overflow-y-auto border-r border-sidebar-border bg-rail py-3",
        drawer ? "flex h-full" : "sticky top-0 hidden h-dvh self-start md:flex",
      )}
    >
      <div className="relative flex w-full shrink-0 justify-center">
        <span
          aria-hidden="true"
          className="absolute inset-y-2 left-0 w-1 rounded-r bg-primary"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/"
              aria-label="Floor 홈"
              aria-current="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Grid2X2 aria-hidden="true" className="size-5" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">홈</TooltipContent>
        </Tooltip>
      </div>
      <div
        aria-hidden="true"
        className="mx-4 mt-3 h-px w-10 shrink-0 bg-sidebar-border"
      />
      {!drawer && (
        <div className="mt-auto pt-4 pb-[env(safe-area-inset-bottom)] xl:hidden">
          {avatar}
        </div>
      )}
    </div>
  );
}

function AppSidebar({
  menu,
  accountCard,
  drawer = false,
}: Pick<AppShellFrameProps, "menu" | "accountCard"> & { drawer?: boolean }) {
  return (
    <div
      data-slot={drawer ? "drawer-sidebar" : "app-sidebar"}
      className={cn(
        "w-[248px] min-w-0 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        drawer ? "flex h-full" : "sticky top-0 hidden h-dvh self-start xl:flex",
      )}
    >
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-4">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-lg font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Floor
        </Link>
        {drawer && (
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label="메뉴 닫기">
              <X aria-hidden="true" className="size-5" />
            </Button>
          </SheetClose>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{menu}</div>
      <div className="shrink-0 border-t border-sidebar-border p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {accountCard}
      </div>
    </div>
  );
}

export function AppShellFrame({
  children,
  menu,
  accountCard,
  accountAvatar,
  notifications,
}: AppShellFrameProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const onResize = () => {
      if (media.matches) close();
    };
    media.addEventListener("change", onResize);
    return () => media.removeEventListener("change", onResize);
  }, [close]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-card focus:p-3 focus:outline-2 focus:outline-ring"
      >
        본문으로 건너뛰기
      </a>
      <Suspense fallback={null}>
        <CloseOnRouteChange onChange={close} />
      </Suspense>
      <div
        data-slot="app-shell"
        className="grid min-h-dvh grid-cols-1 md:grid-cols-[72px_minmax(0,1fr)] xl:grid-cols-[72px_248px_minmax(0,1fr)]"
      >
        <AppRail avatar={accountAvatar} />
        <AppSidebar menu={menu} accountCard={accountCard} />
        <div className="min-w-0">
          <header className="sticky top-0 z-[45] flex h-14 items-center justify-between gap-4 border-b border-border bg-card px-4 md:px-8">
            <div className="flex min-w-0 items-center gap-2">
              <SheetTrigger asChild>
                <Button
                  ref={trigger}
                  variant="ghost"
                  size="icon"
                  className="xl:hidden"
                  aria-label="메뉴 열기"
                >
                  <Menu aria-hidden="true" className="size-5" />
                </Button>
              </SheetTrigger>
              <Suspense
                fallback={<span aria-hidden="true" className="h-6 w-16" />}
              >
                <MemberSectionName />
              </Suspense>
            </div>
            <div className="shrink-0">{notifications}</div>
          </header>
          <div id="content" tabIndex={-1} className="scroll-mt-14">
            {children}
          </div>
        </div>
      </div>
      <SheetContent
        side="left"
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex-row gap-0 bg-sidebar p-0 data-[side=left]:w-80 data-[side=left]:sm:max-w-none"
        onClick={(event) => {
          // 메뉴의 낙관적 이동이 preventDefault해도 서랍은 닫는다.
          if (
            event.target instanceof Element &&
            event.target.closest("a[href]")
          )
            close();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}
      >
        <SheetTitle className="sr-only">메뉴</SheetTitle>
        <AppRail drawer />
        <AppSidebar drawer menu={menu} accountCard={accountCard} />
      </SheetContent>
    </Sheet>
  );
}
