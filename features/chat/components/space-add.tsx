"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCommunitySpace } from "@/features/chat/space-actions";
import {
  createCommunitySpaceSchema,
  type SpaceIconColor,
} from "../space-schema";
import { SpaceColorPicker } from "./space-colors";
import { useSpaceMutation } from "./use-space-mutation";

export function inviteCodeFromInput(input: string): string | null {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{22}$/.test(value)) return value;
  try {
    const url = new URL(value, "https://floor.invalid");
    const match = /^\/s\/join\/([A-Za-z0-9_-]{22})\/?$/.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function SpaceAdd() {
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            variant="ghost"
            size="icon"
            aria-label="스페이스 추가"
            className="mx-auto"
          >
            <Plus aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          onCloseAutoFocus={(event) => {
            if (dialog) event.preventDefault();
          }}
        >
          <DropdownMenuItem onSelect={() => setDialog("create")}>
            스페이스 만들기
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("join")}>
            초대 링크로 참여
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {dialog === "create" ? "스페이스 만들기" : "초대 링크로 참여"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "create"
                ? "함께 이야기할 커뮤니티를 만들어요"
                : "받은 링크나 초대 코드를 붙여 넣어 주세요"}
            </DialogDescription>
          </DialogHeader>
          {dialog === "create" ? (
            <CreateSpaceForm onDone={() => setDialog(null)} />
          ) : dialog === "join" ? (
            <JoinCodeForm onDone={() => setDialog(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CreateSpaceForm({
  onDone,
  action = createCommunitySpace,
}: {
  onDone: () => void;
  action?: typeof createCommunitySpace;
}) {
  const id = useId(),
    router = useRouter();
  const [name, setName] = useState("");
  const [iconColor, setColor] = useState<SpaceIconColor>("blue");
  const mutation = useSpaceMutation(action);
  const valid = createCommunitySpaceSchema.safeParse({
    name,
    iconColor,
  }).success;
  const tooLong = Array.from(name.trim()).length > 30;
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid)
          void mutation.submit(
            { name, iconColor },
            (data) => {
              onDone();
              router.push(`/s/${data.spaceId}/${data.roomId}`);
            },
            "스페이스를 만들었어요",
          );
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={id}>스페이스 이름</Label>
        <Input
          id={id}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={mutation.pending}
          aria-invalid={tooLong}
          aria-describedby={tooLong ? `${id}-error` : undefined}
        />
        {tooLong && (
          <p id={`${id}-error`} role="alert">
            이름은 30자까지 쓸 수 있어요
          </p>
        )}
      </div>
      <SpaceColorPicker
        value={iconColor}
        onChange={setColor}
        disabled={mutation.pending}
      />
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error}
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" type="button" onClick={onDone}>
          돌아가기
        </Button>
        <Button type="submit" disabled={!valid || mutation.pending}>
          만들기
        </Button>
      </DialogFooter>
    </form>
  );
}

function JoinCodeForm({ onDone }: { onDone: () => void }) {
  const id = useId(),
    router = useRouter();
  const [input, setInput] = useState("");
  const code = inviteCodeFromInput(input);
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!code) return;
        onDone();
        router.push(`/s/join/${code}`);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={id}>초대 링크 또는 코드</Label>
        <Input
          id={id}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          autoComplete="off"
        />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={!code}>
          초대 확인하기
        </Button>
      </DialogFooter>
    </form>
  );
}
