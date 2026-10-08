"use client";

import Link from "next/link";
import { ChevronDown, ChevronsUpDown, Settings } from "lucide-react";
import { cn } from "cn";
import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { setStatus } from "@/features/people/actions";
import {
  userStatusSchema,
  statusLabel,
  type UserStatus,
} from "@/features/people/status";
import { StatusDot } from "@/features/people/components/person-status";
import { useChatMetadata } from "@/features/chat/components/use-chat-metadata";
import { applyMyStatus } from "@/features/chat/nav-state";
import {
  useRealtimeScope,
  useStatusPresencePublisher,
} from "@/components/realtime-provider";
import { SignOutButton } from "@/components/sign-out-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

export type AccountMenuVariant = "pill" | "card" | "avatar";

export type AccountMenuProps = {
  name: string;
  email: string;
  isOperator: boolean;
  myStatus?: UserStatus;
  username?: string | null;
  variant?: AccountMenuVariant;
};

export function AccountMenu({
  name,
  email,
  isOperator,
  myStatus = "online",
  username = null,
  variant = "pill",
}: AccountMenuProps) {
  const initial = Array.from(name.trim())[0] ?? "?";
  const metadata = useChatMetadata();
  const selected = metadata.myStatus ?? myStatus;
  const presence = useRealtimeScope().status;
  const shownStatus =
    presence?.auto && selected === "online" ? "away" : selected;
  const client = useQueryClient();
  const publish = useStatusPresencePublisher();
  const locked = useRef(false);
  const mutation = useMutation({
    mutationFn: (input: { status: UserStatus }) => setStatus(input),
    retry: false,
  });
  async function choose(value: string) {
    const parsed = userStatusSchema.safeParse(value);
    if (!parsed.success || locked.current || parsed.data === selected) return;
    locked.current = true;
    try {
      const result = await mutation.mutateAsync({ status: parsed.data });
      if (!result.ok) {
        toast.error("상태를 바꾸지 못했어요. 다시 시도해 주세요");
        return;
      }
      applyMyStatus(client, result.data.status);
      publish({ status: result.data.status, auto: false });
    } catch {
      toast.error("상태를 바꾸지 못했어요. 다시 시도해 주세요");
    } finally {
      locked.current = false;
    }
  }
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
              "relative flex shrink-0 items-center justify-center rounded-full font-medium",
              variant === "pill" && "size-7 bg-muted text-xs",
              variant === "card" && "size-8 bg-muted text-sm",
              variant === "avatar" && "text-sm",
            )}
          >
            {initial}
            <span className="absolute -right-1 -bottom-1 rounded-full bg-card p-0.5">
              <StatusDot status={shownStatus} />
            </span>
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
                {variant === "card" && (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {presence?.auto && selected === "online"
                      ? "자리 비움 (자동)"
                      : statusLabel(selected)}
                  </span>
                )}
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
          {username ? `@${username}` : email}
        </DropdownMenuLabel>
        <DropdownMenuLabel>상태</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={selected}
          onValueChange={(value) => {
            void choose(value);
          }}
        >
          {(["online", "away", "dnd"] as const).map((status) => (
            <DropdownMenuRadioItem
              key={status}
              value={status}
              disabled={mutation.isPending}
              className="min-h-11"
            >
              <span aria-hidden="true">
                <StatusDot status={status} />
              </span>
              {statusLabel(status)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          asChild
          className="min-h-11 px-3 focus:bg-muted focus:text-foreground"
        >
          <Link href="/settings">
            <Settings aria-hidden="true" />
            설정
          </Link>
        </DropdownMenuItem>
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
