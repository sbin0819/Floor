"use client";

import Link from "next/link";
import { ChevronDown, ChevronsUpDown, Settings } from "lucide-react";
import { cn } from "cn";
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

export type AccountMenuVariant = "pill" | "card" | "avatar";

export type AccountMenuProps = {
  name: string;
  email: string;
  isOperator: boolean;
  variant?: AccountMenuVariant;
};

export function AccountMenu({
  name,
  email,
  isOperator,
  variant = "pill",
}: AccountMenuProps) {
  const initial = Array.from(name.trim())[0] ?? "?";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant === "card" ? "ghost" : "outline"}
          size={variant === "avatar" ? "icon" : "default"}
          className={cn(
            variant === "pill" && "max-w-52 rounded-full px-2 md:px-3",
            variant === "card" &&
              "h-14 w-full min-w-0 justify-start gap-3 rounded-lg px-3",
            variant === "avatar" && "rounded-full bg-muted p-0",
          )}
          aria-label={`${name}님 사용자 메뉴`}
        >
          <span
            aria-hidden="true"
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full font-medium",
              variant === "pill" && "size-7 bg-muted text-xs",
              variant === "card" && "size-8 bg-muted text-sm",
              variant === "avatar" && "text-sm",
            )}
          >
            {initial}
          </span>
          {variant !== "avatar" && (
            <>
              <span
                className={
                  variant === "card"
                    ? "min-w-0 flex-1 truncate text-left font-semibold"
                    : "max-w-28 truncate"
                }
              >
                {name}
              </span>
              {variant === "card" ? (
                <ChevronsUpDown aria-hidden="true" />
              ) : (
                <ChevronDown aria-hidden="true" />
              )}
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={
          variant === "card" ? "top" : variant === "avatar" ? "right" : "bottom"
        }
        align={variant === "card" ? "start" : "end"}
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
