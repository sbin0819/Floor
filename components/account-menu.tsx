"use client";

import Link from "next/link";
import { ChevronDown, Settings } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type AccountMenuProps = {
  name: string;
  email: string;
  isOperator: boolean;
};

export function AccountMenu({ name, email, isOperator }: AccountMenuProps) {
  const initial = Array.from(name.trim())[0] ?? "?";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="max-w-52 rounded-full px-2 md:px-3"
          aria-label={`${name}님 사용자 메뉴`}
        >
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
          >
            {initial}
          </span>
          <span className="max-w-28 truncate">{name}</span>
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuLabel className="px-3 py-2 font-normal break-all">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isOperator && (
          <DropdownMenuItem
            asChild
            className="min-h-11 px-3 focus:bg-muted focus:text-foreground"
          >
            <Link href="/admin">
              <Settings aria-hidden="true" />
              운영자 화면
            </Link>
          </DropdownMenuItem>
        )}
        <SignOutButton menuItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
