"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { Building2, CalendarDays, LayoutDashboard, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  adminBranchHref,
  adminMenuAt,
  adminMenuHref,
  adminMenuLabels,
} from "../admin-shell-navigation";
import type { AdminMenu, AdminShellData } from "../admin-shell-types";
import { AdminBrand, AdminShellFooter } from "./admin-shell-frame";

const icons = {
  dashboard: LayoutDashboard,
  bookings: CalendarDays,
  spaces: Building2,
};

export function AdminShellNavigation({
  data,
  mobile = false,
}: {
  data?: AdminShellData;
  mobile?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedPath, setSelectedPath] = useOptimistic(pathname);
  const [open, setOpen] = useState(false);
  const openedAt = useRef<string | null>(null);
  useEffect(() => () => setOpen(false), [pathname]);
  const current = data?.branches.find((branch) => branch.id === data.branchId);
  const selectedBranch =
    data?.branches.find((branch) => {
      const base = adminMenuHref(branch.id, "dashboard");
      return selectedPath === base || selectedPath.startsWith(`${base}/`);
    }) ?? current;
  const selectedMenu = data ? adminMenuAt(selectedPath, data.branchId) : null;
  const title = selectedMenu ? adminMenuLabels[selectedMenu] : "운영 지점";
  function navigate(href: string) {
    const actual = window.location.pathname;
    if (
      data &&
      actual !== adminMenuHref(data.branchId, "dashboard") &&
      !actual.startsWith(`${adminMenuHref(data.branchId, "dashboard")}/`)
    )
      return;
    setOpen(false);
    startTransition(() => {
      setSelectedPath(href);
      router.push(href);
    });
  }
  const contents = (
    <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
        {data && current && (
          <Select
            value={selectedBranch?.id ?? current.id}
            onValueChange={(id) => {
              const target = data.branches.find((branch) => branch.id === id);
              if (target)
                navigate(adminBranchHref(pathname, data.branchId, target));
            }}
          >
            <SelectTrigger
              aria-label="운영 지점 바꾸기"
              className="min-h-11 w-full border-sidebar-border"
            >
              <SelectValue>{selectedBranch?.name ?? current.name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {data.branches.map((branch) => (
                <SelectItem
                  key={branch.id}
                  value={branch.id}
                  className="min-h-11"
                >
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <nav
          aria-label="운영자 메뉴"
          aria-busy={pending || undefined}
          className="space-y-1"
        >
          {data && current ? (
            current.menus.map((menu: AdminMenu) => {
              const Icon = icons[menu];
              const href = adminMenuHref(current.id, menu);
              return (
                <Link
                  key={menu}
                  href={href}
                  aria-current={selectedMenu === menu ? "page" : undefined}
                  onClick={(event) => {
                    if (
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    navigate(href);
                  }}
                  className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-semibold aria-[current=page]:text-sidebar-accent-foreground"
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  {adminMenuLabels[menu]}
                </Link>
              );
            })
          ) : (
            <Link
              href="/admin"
              aria-current="page"
              className="flex min-h-11 items-center gap-3 rounded-lg bg-sidebar-accent px-3 text-sm"
            >
              <Building2 aria-hidden="true" className="size-4" />
              지점
            </Link>
          )}
        </nav>
      </div>
      <AdminShellFooter
        name={data?.user.name}
        onNavigate={() => setOpen(false)}
      />
    </>
  );
  if (!mobile) return contents;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) openedAt.current = pathname;
        setOpen(next);
      }}
    >
      <div className="flex h-16 items-center gap-3 px-4">
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="운영자 메뉴 열기">
            <Menu aria-hidden="true" className="size-5" />
          </Button>
        </SheetTrigger>
        <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>
        {current && (
          <span className="max-w-32 truncate rounded-md border border-border px-2 py-1 text-xs">
            {current.name}
          </span>
        )}
      </div>
      <SheetContent
        side="left"
        closeLabel="운영자 메뉴 닫기"
        className="admin-shell gap-6 bg-sidebar p-5 text-sidebar-foreground data-[side=left]:w-60 data-[side=left]:sm:max-w-60"
        onCloseAutoFocus={(event) => {
          if (window.location.pathname !== openedAt.current)
            event.preventDefault();
        }}
      >
        <SheetTitle className="sr-only">운영자 메뉴</SheetTitle>
        <SheetDescription className="sr-only">
          운영 지점과 관리할 화면을 골라 주세요.
        </SheetDescription>
        <div className="pr-11">
          <AdminBrand />
        </div>
        {contents}
      </SheetContent>
    </Sheet>
  );
}
