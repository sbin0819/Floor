"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { openDirectMessage } from "@/features/chat/actions";
import { setMemberRole, setMemberTitle } from "@/features/teams/manage-actions";
import { setMemberTitleSchema } from "@/features/teams/manage-schema";
import type { TeamMember, TeamPageData } from "../types";
import { teamDialogHref, teamHref } from "../navigation";
import { TeamFeedback, TeamInput } from "./team-fields";
import { useTeamMutation, validationErrors } from "./use-team-mutation";

const lastAdminHelp = "팀 관리자가 한 명뿐이에요";

export function TeamMemberMenu({
  data,
  member,
  adminCount,
  narrow,
}: {
  data: Pick<TeamPageData, "id" | "name" | "role" | "userId" | "memberCount">;
  member: TeamMember;
  adminCount: number;
  narrow: boolean;
}) {
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<"title" | "demote" | null>(null);
  const [title, setTitle] = useState(member.title ?? "");
  const [feedback, setFeedback] = useState<"promote" | "message" | null>(null);
  const self = member.id === data.userId,
    admin = data.role === "admin";
  const lastAdmin = member.role === "admin" && adminCount === 1;
  const promote = useTeamMutation({
    action: setMemberRole,
    onStart: () => setFeedback("promote"),
    successMessage: `${member.name} 님을 팀 관리자로 지정했어요`,
    limitMessage: `${member.name} 님은 이미 팀 5개의 팀 관리자예요`,
  });
  const demote = useTeamMutation({
    action: setMemberRole,
    successMessage: `${member.name} 님을 팀원으로 바꿨어요`,
    onSuccess: () => setDialog(null),
  });
  const changeTitle = useTeamMutation({
    action: setMemberTitle,
    successMessage: "직함을 바꿨어요",
    onSuccess: () => setDialog(null),
  });
  const message = useTeamMutation({
    action: openDirectMessage,
    onStart: () => setFeedback("message"),
    successMessage: "대화를 열었어요",
    onSuccess: (result) => {
      if (window.location.pathname === `/teams/${data.id}`)
        router.push(`/dm/${result.roomId}`);
    },
  });
  const pending =
    promote.pending || demote.pending || changeTitle.pending || message.pending;
  const restore = () => trigger.current?.focus();
  function openDialog(value: "title" | "demote") {
    setMenuOpen(false);
    setTitle(member.title ?? "");
    setDialog(value);
  }
  type Item = {
    label: string;
    action?: () => void;
    href?: string;
    disabled?: boolean;
    destructive?: boolean;
    hint?: string;
  };
  const items: Item[] = [
    ...(admin || self
      ? [{ label: "직함 바꾸기", action: () => openDialog("title") }]
      : []),
    ...(admin && member.role === "member"
      ? [
          {
            label: "팀 관리자로 지정",
            action: () => {
              setMenuOpen(false);
              void promote.submit({
                teamId: data.id,
                userId: member.id,
                role: "admin",
              });
            },
          },
        ]
      : []),
    ...(admin && member.role === "admin"
      ? [
          {
            label: "팀원으로 바꾸기",
            disabled: lastAdmin,
            hint: lastAdmin ? lastAdminHelp : undefined,
            action: () => openDialog("demote"),
          },
        ]
      : []),
    ...(!self
      ? [
          {
            label: "메시지 보내기",
            action: () => {
              setMenuOpen(false);
              void message.submit({ userId: member.id });
            },
          },
        ]
      : []),
    ...(admin && !self
      ? [
          {
            label: "팀에서 내보내기",
            href: teamDialogHref(data.id, member.id, false),
            destructive: true,
            disabled: lastAdmin,
            hint: lastAdmin ? lastAdminHelp : undefined,
          },
        ]
      : []),
    ...(self
      ? data.memberCount === 1
        ? [
            {
              label: "팀 지우기",
              href: teamHref(data.id, { tab: "settings" }),
              destructive: true,
            },
          ]
        : [
            {
              label: "팀 나가기",
              href: teamDialogHref(data.id, member.id, true),
              destructive: true,
              disabled: lastAdmin,
              hint: lastAdmin ? lastAdminHelp : undefined,
            },
          ]
      : []),
  ];
  const menuButton = (
    <Button
      ref={trigger}
      variant="ghost"
      size="icon"
      aria-label={`${member.name} 메뉴`}
      data-team-member-menu={member.id}
      disabled={pending}
      onClick={narrow ? () => setMenuOpen(true) : undefined}
    >
      <MoreHorizontal aria-hidden="true" />
    </Button>
  );
  return (
    <>
      {narrow ? (
        <>
          {menuButton}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetContent
              side="bottom"
              closeLabel="팀원 메뉴 닫기"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (!dialog) restore();
              }}
            >
              <SheetHeader>
                <SheetTitle>{member.name}</SheetTitle>
                <SheetDescription>
                  {member.username ? `@${member.username} · ` : ""}
                  {member.title ?? "팀원 메뉴"}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-1 p-4">
                {items.map((item) => (
                  <div key={item.label}>
                    {item.href && !item.disabled ? (
                      <Button
                        asChild
                        variant="ghost"
                        className={`w-full justify-start ${item.destructive ? "text-destructive" : ""}`}
                      >
                        <Link
                          href={item.href}
                          scroll={false}
                          onClick={() => setMenuOpen(false)}
                        >
                          {item.label}
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        className={`w-full justify-start ${item.destructive ? "text-destructive" : ""}`}
                        disabled={pending || item.disabled}
                        onClick={item.action}
                      >
                        {item.label}
                      </Button>
                    )}
                    {item.hint && (
                      <p className="px-4 text-xs text-muted-foreground">
                        {item.hint}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>{menuButton}</DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              if (dialog) event.preventDefault();
            }}
          >
            {items.map((item) => (
              <DropdownMenuItem
                key={item.label}
                disabled={pending || item.disabled}
                title={item.hint}
                className={item.destructive ? "text-destructive" : undefined}
                onSelect={item.action}
                asChild={!!item.href && !item.disabled}
              >
                {item.href && !item.disabled ? (
                  <Link href={item.href} scroll={false}>
                    {item.label}
                  </Link>
                ) : (
                  <span>
                    {item.label}
                    {item.hint && (
                      <span className="block text-xs">{item.hint}</span>
                    )}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <TeamFeedback
        message={
          feedback === "promote"
            ? promote.message
            : feedback === "message"
              ? message.message
              : ""
        }
      />
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setDialog(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restore();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {dialog === "title"
                ? `${member.name} 님의 직함 바꾸기`
                : `${member.name} 님을 팀원으로 바꿀까요?`}
            </DialogTitle>
            <DialogDescription>
              {dialog === "title"
                ? "40자 이하로 입력해 주세요. 비우면 직함이 없어져요."
                : "팀 관리 권한이 없어져요."}
            </DialogDescription>
          </DialogHeader>
          {dialog === "title" ? (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const parsed = setMemberTitleSchema.safeParse({
                  teamId: data.id,
                  userId: member.id,
                  title,
                });
                if (!parsed.success) {
                  changeTitle.setErrors(validationErrors(parsed.error.issues));
                  return;
                }
                await changeTitle.submit(parsed.data);
              }}
              className="space-y-4"
            >
              <TeamInput
                label="직함"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={40}
                disabled={pending}
                error={changeTitle.errors.title}
              />
              <TeamFeedback message={changeTitle.message} />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setDialog(null)}
                >
                  취소
                </Button>
                <Button type="submit" disabled={pending}>
                  저장
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <>
              <TeamFeedback message={demote.message} />
              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => setDialog(null)}
                >
                  취소
                </Button>
                <Button
                  disabled={pending || lastAdmin}
                  onClick={() =>
                    void demote.submit({
                      teamId: data.id,
                      userId: member.id,
                      role: "member",
                    })
                  }
                >
                  팀원으로 바꾸기
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
