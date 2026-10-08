"use client";

import { Suspense, use, useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActionResult } from "@/lib/actions/result";
import type { MessageContact } from "@/features/people/types";
import { addGroupMembers, leaveGroupDm, renameGroupDm } from "../actions";
import { ContactPicker } from "./contact-picker";

type GroupAction = (input: unknown) => Promise<ActionResult<unknown>>;
export type GroupActions = {
  add: GroupAction;
  leave: GroupAction;
  rename: GroupAction;
};
export const defaultGroupActions: GroupActions = {
  add: (input) => addGroupMembers(input),
  leave: (input) => leaveGroupDm(input),
  rename: (input) => renameGroupDm(input),
};
export type GroupDialog = "add" | "leave" | "rename" | null;

export function GroupDialogs({
  roomId,
  name,
  memberIds,
  contacts,
  dialog,
  onClose,
  onReturnFocus,
  actions = defaultGroupActions,
}: {
  roomId: string;
  name: string | null;
  memberIds: readonly string[];
  contacts: Promise<MessageContact[]>;
  dialog: GroupDialog;
  onClose: () => void;
  onReturnFocus: () => void;
  actions?: GroupActions;
}) {
  return (
    <Dialog
      open={dialog !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {dialog === "add"
              ? "사람 추가"
              : dialog === "rename"
                ? "이름 바꾸기"
                : "그룹에서 나갈까요?"}
          </DialogTitle>
          <DialogDescription>
            {dialog === "add"
              ? `나를 포함해 10명까지 · ${Math.max(0, 10 - memberIds.length)}명 더 추가할 수 있어요`
              : dialog === "rename"
                ? "이름을 비우면 멤버 이름으로 보여요"
                : "다시 들어오려면 누군가 추가해 줘야 해요"}
          </DialogDescription>
        </DialogHeader>
        {dialog && (
          <GroupDialogForm
            key={`${roomId}:${dialog}`}
            {...{ roomId, name, memberIds, contacts, dialog, onClose, actions }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResolvedContacts({
  contacts,
  ...props
}: { contacts: Promise<MessageContact[]> } & Omit<
  Parameters<typeof ContactPicker>[0],
  "people"
>) {
  return <ContactPicker people={use(contacts)} {...props} />;
}

function GroupDialogForm({
  roomId,
  name,
  memberIds,
  contacts,
  dialog,
  onClose,
  actions,
}: {
  roomId: string;
  name: string | null;
  memberIds: readonly string[];
  contacts: Promise<MessageContact[]>;
  dialog: NonNullable<GroupDialog>;
  onClose: () => void;
  actions: GroupActions;
}) {
  const id = useId();
  const router = useRouter();
  const client = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [nextName, setName] = useState(name ?? "");
  const [error, setError] = useState("");
  const locked = useRef(false);
  const active = useRef({ current: true });
  useEffect(() => {
    const scope = { current: true };
    active.current = scope;
    return () => {
      scope.current = false;
    };
  }, []);
  const mutation = useMutation({
    mutationFn: () =>
      dialog === "leave"
        ? actions.leave({ roomId })
        : dialog === "rename"
          ? actions.rename({ roomId, name: nextName.trim() })
          : actions.add({ roomId, userIds: selected }),
    retry: false,
  });
  const invalidName = Array.from(nextName.trim()).length > 30;
  const invalid =
    dialog === "rename"
      ? invalidName
      : dialog === "add"
        ? !selected.length || selected.length > 10 - memberIds.length
        : false;
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (locked.current || invalid) return;
        locked.current = true;
        const scope = active.current;
        setError("");
        try {
          const result = await mutation.mutateAsync();
          if (!scope.current) return;
          if (!result.ok) {
            setError(
              result.code === "FORBIDDEN"
                ? "이 작업을 할 수 없어요"
                : result.code === "LIMIT_EXCEEDED"
                  ? "그룹은 나를 포함해 10명까지예요"
                  : "처리하지 못했어요. 다시 시도해 주세요",
            );
            return;
          }
          void client.invalidateQueries({ queryKey: ["chat", "nav"] });
          onClose();
          if (dialog === "leave") {
            toast.success("그룹에서 나갔어요");
            router.push("/messages");
          } else {
            toast.success(
              dialog === "add" ? "사람을 추가했어요" : "이름을 바꿨어요",
            );
            router.refresh();
          }
        } catch {
          if (scope.current) setError("처리하지 못했어요. 다시 시도해 주세요");
        } finally {
          locked.current = false;
        }
      }}
    >
      {dialog === "add" && (
        <Suspense
          fallback={
            <div role="status" aria-label="사람을 불러오고 있어요">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="mt-3 h-36 w-full" />
            </div>
          }
        >
          <ResolvedContacts
            contacts={contacts}
            selected={selected}
            onChange={setSelected}
            max={Math.max(0, 10 - memberIds.length)}
            existing={memberIds}
            disabled={mutation.isPending}
          />
        </Suspense>
      )}
      {dialog === "rename" && (
        <div className="space-y-2">
          <Label htmlFor={id}>그룹 이름</Label>
          <Input
            id={id}
            value={nextName}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={invalidName}
            aria-describedby={invalidName ? `${id}-error` : undefined}
            disabled={mutation.isPending}
          />
          {invalidName && (
            <p
              role="alert"
              id={`${id}-error`}
              className="text-sm text-destructive"
            >
              이름은 30자까지 쓸 수 있어요
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button
          variant="outline"
          type="button"
          onClick={onClose}
          disabled={mutation.isPending}
        >
          돌아가기
        </Button>
        <Button
          type="submit"
          variant={dialog === "leave" ? "destructive" : "default"}
          disabled={invalid || mutation.isPending}
        >
          {dialog === "leave"
            ? "그룹 나가기"
            : dialog === "rename"
              ? "저장"
              : "추가"}
        </Button>
      </DialogFooter>
    </form>
  );
}
