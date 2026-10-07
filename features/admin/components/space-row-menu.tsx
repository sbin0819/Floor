"use client";

import { useId, useRef } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type RowAction = (trigger: HTMLButtonElement | null) => void;
export function SpaceRowMenu({
  name,
  archived,
  canManage,
  pending,
  onEdit,
  onAccess,
  onArchive,
}: {
  name: string;
  archived: boolean;
  canManage: boolean;
  pending: boolean;
  onEdit: RowAction;
  onAccess: RowAction;
  onArchive: RowAction;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const openingDialog = useRef(false);
  const openDialog = (action: RowAction) => {
    openingDialog.current = true;
    action(trigger.current);
  };
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) openingDialog.current = false;
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`${name} 동작`}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-52"
        onCloseAutoFocus={(event) => {
          if (openingDialog.current) event.preventDefault();
        }}
      >
        <DropdownMenuItem onSelect={() => openDialog(onEdit)}>
          고치기
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openDialog(onAccess)}>
          이용 대상
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!canManage || pending}
          aria-describedby={!canManage ? id : undefined}
          onSelect={() => {
            if (archived) onArchive(trigger.current);
            else openDialog(onArchive);
          }}
        >
          {archived ? "되살리기" : "보관"}
        </DropdownMenuItem>
        {!canManage && (
          <DropdownMenuLabel
            id={id}
            className="max-w-56 font-normal whitespace-normal text-muted-foreground"
          >
            공간을 보관하거나 되살릴 권한이 없어요
          </DropdownMenuLabel>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
