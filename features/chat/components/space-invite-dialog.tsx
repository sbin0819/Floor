"use client";

import { Suspense, use, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { createInviteLink, inviteToSpace } from "@/features/chat/space-actions";
import { useSpaceMutation } from "./use-space-mutation";

type Candidate = { userId: string; name: string; username: string | null };
export function SpaceInviteDialog({
  spaceId,
  spaceName,
  candidates,
  returnHref,
}: {
  spaceId: string;
  spaceName: string;
  candidates: Promise<Candidate[]>;
  returnHref: string;
}) {
  const router = useRouter(),
    pathname = usePathname();
  const [open, setOpen] = useState(true);
  function close() {
    setOpen(false);
    if (pathname === `/s/${spaceId}/settings`)
      router.replace(returnHref, { scroll: false });
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{spaceName}에 초대</DialogTitle>
          <DialogDescription>
            친구나 같은 팀·커뮤니티 사람을 초대하거나 링크를 보내 주세요
          </DialogDescription>
        </DialogHeader>
        <Suspense
          fallback={
            <div role="status" aria-label="초대할 사람을 불러오고 있어요">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="mt-3 h-32 w-full" />
            </div>
          }
        >
          <InvitePeople spaceId={spaceId} candidates={candidates} />
        </Suspense>
        <Separator />
        <InviteLinkForm spaceId={spaceId} />
      </DialogContent>
    </Dialog>
  );
}
function InvitePeople({
  spaceId,
  candidates,
}: {
  spaceId: string;
  candidates: Promise<Candidate[]>;
}) {
  const rows = use(candidates),
    id = useId();
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string[]>([]);
  const mutation = useSpaceMutation(inviteToSpace);
  const filtered = rows.filter((person) =>
    `${person.name} ${person.username ?? ""}`
      .normalize("NFC")
      .toLowerCase()
      .includes(query.normalize("NFC").trim().toLowerCase()),
  );
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!selected.length) return;
        void mutation.submit({ spaceId, userIds: selected }, ({ sent }) => {
          setSelected([]);
          toast.success(
            sent === 0 ? "새로 보낼 사람이 없어요" : "초대를 보냈어요",
          );
        });
      }}
    >
      <Label htmlFor={id}>초대할 사람 찾기</Label>
      <Input
        id={id}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {filtered.length ? (
        <ul className="max-h-52 divide-y divide-border overflow-y-auto">
          {filtered.map((person) => (
            <li key={person.userId}>
              <label className="flex min-h-11 items-center gap-3 py-3">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={selected.includes(person.userId)}
                  disabled={
                    mutation.pending ||
                    (!selected.includes(person.userId) && selected.length >= 20)
                  }
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, person.userId]
                        : current.filter((id) => id !== person.userId),
                    )
                  }
                />
                <span>
                  <span className="block font-semibold">{person.name}</span>
                  {person.username && (
                    <span className="text-xs text-muted-foreground">
                      @{person.username}
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">초대할 사람이 없어요</p>
      )}
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error}
        </p>
      )}
      <Button type="submit" disabled={!selected.length || mutation.pending}>
        초대 보내기
      </Button>
    </form>
  );
}
export function InviteLinkForm({
  spaceId,
  action = createInviteLink,
}: {
  spaceId: string;
  action?: typeof createInviteLink;
}) {
  const id = useId();
  const [expiresIn, setExpiry] = useState<"1d" | "7d" | "never">("7d"),
    [uses, setUses] = useState("10"),
    [url, setUrl] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const mutation = useSpaceMutation(action);
  const expiryLabels = { "1d": "1일 뒤", "7d": "7일 뒤", never: "없음" };
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void mutation.submit(
          {
            spaceId,
            expiresIn,
            maxUses: uses === "never" ? null : Number(uses),
          },
          (data) => setUrl(data.url),
        );
      }}
    >
      <h2 className="font-semibold">초대 링크</h2>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor={`${id}-expires`}>만료</Label>
          <Select
            value={expiresIn}
            onValueChange={(value) => {
              if (value === "1d" || value === "7d" || value === "never")
                setExpiry(value);
            }}
          >
            <SelectTrigger id={`${id}-expires`}>
              <SelectValue>{expiryLabels[expiresIn]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(expiryLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-uses`}>사용 횟수</Label>
          <Select value={uses} onValueChange={setUses}>
            <SelectTrigger id={`${id}-uses`}>
              <SelectValue>
                {uses === "never" ? "없음" : `${uses}회`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1회</SelectItem>
              <SelectItem value="10">10회</SelectItem>
              <SelectItem value="never">없음</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {url && (
        <div className="flex gap-2">
          <Input ref={input} value={url} readOnly aria-label="만든 초대 링크" />
          <Button
            variant="outline"
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                toast.success("링크를 복사했어요");
              } catch {
                input.current?.focus();
                input.current?.select();
                toast.error("링크를 선택했어요. 복사해 주세요");
              }
            }}
          >
            복사
          </Button>
        </div>
      )}
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error}
        </p>
      )}
      <Button type="submit" disabled={mutation.pending}>
        링크 만들기
      </Button>
      <p className="text-xs text-muted-foreground">
        링크를 가진 사람은 누구나 들어올 수 있어요. 내보낸 사람은 링크로도 다시
        들어올 수 없어요
      </p>
    </form>
  );
}
