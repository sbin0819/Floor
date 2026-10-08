"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  archiveChannel,
  deleteSpace,
  updateSpace,
} from "@/features/chat/space-actions";
import { spaceNameSchema, type SpaceIconColor } from "../space-schema";
import type { SpaceSettings } from "../space-settings-queries";
import { ChannelDialog } from "./channel-dialog";
import { SpaceColorPicker, spaceColorNames } from "./space-colors";
import { SpaceConfirm } from "./space-confirm";
import { useSpaceMutation } from "./use-space-mutation";
import { spaceSettingsTabs } from "../space-settings";
export { spaceSettingsTabs } from "../space-settings";

export function SpaceSettingsTabs({
  space,
  selected,
}: {
  space: SpaceSettings;
  selected: string;
}) {
  return (
    <nav
      aria-label="스페이스 설정"
      className="flex flex-wrap gap-2 border-b border-border pb-3"
    >
      {spaceSettingsTabs(space).map((tab) => (
        <Button
          key={tab.key}
          asChild
          variant={tab.key === selected ? "secondary" : "ghost"}
        >
          <Link
            aria-current={tab.key === selected ? "page" : undefined}
            href={`/s/${space.id}/settings?tab=${tab.key}`}
          >
            {tab.name}
          </Link>
        </Button>
      ))}
    </nav>
  );
}
export function SpaceOverview({ space }: { space: SpaceSettings }) {
  const id = useId();
  const [name, setName] = useState(space.name),
    [color, setColor] = useState<SpaceIconColor>(space.iconColor);
  const mutation = useSpaceMutation(updateSpace);
  const editable = space.kind === "community" && space.role === "owner";
  return (
    <div className="space-y-8">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (editable && spaceNameSchema.safeParse(name).success)
            void mutation.submit(
              { spaceId: space.id, name, iconColor: color },
              undefined,
              "스페이스를 바꿨어요",
            );
        }}
      >
        <h2 className="text-lg font-bold">스페이스 정보</h2>
        {editable ? (
          <>
            <Label htmlFor={id}>이름</Label>
            <Input
              id={id}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={mutation.pending}
            />
            <SpaceColorPicker
              value={color}
              onChange={setColor}
              disabled={mutation.pending}
            />
            {mutation.error && (
              <p role="alert" className="text-sm text-destructive">
                {mutation.error}
              </p>
            )}
            <Button
              type="submit"
              disabled={
                mutation.pending || !spaceNameSchema.safeParse(name).success
              }
            >
              저장
            </Button>
          </>
        ) : (
          <>
            <p>{space.name}</p>
            <p className="text-sm text-muted-foreground">
              색: {spaceColorNames[space.iconColor]}
            </p>
            {space.kind === "team" && (
              <p className="text-sm text-muted-foreground">
                팀 이름은{" "}
                <Link href="/teams" className="underline">
                  팀 관리
                </Link>
                에서 바꿔요
              </p>
            )}
          </>
        )}
      </form>
      <section className="space-y-3" id="channels">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">텍스트 채널</h2>
          {space.role !== "member" && <ChannelDialog spaceId={space.id} />}
        </div>
        {space.channels.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {space.channels.map((channel) => (
              <li
                key={channel.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <Link
                  href={`/s/${space.id}/${channel.id}`}
                  className="inline-flex min-h-11 items-center font-semibold"
                >
                  # {channel.name}
                </Link>
                {space.role !== "member" && (
                  <div className="flex flex-wrap gap-2">
                    <ChannelDialog spaceId={space.id} channel={channel} />
                    <SpaceConfirm
                      label="보관"
                      title={`${channel.name} 채널을 보관할까요?`}
                      description="기존 대화는 남지만 새 메시지를 쓸 수 없어요"
                      action={archiveChannel}
                      input={{ roomId: channel.id }}
                      destructive
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">텍스트 채널이 없어요</p>
        )}
      </section>
    </div>
  );
}
export function SpaceDanger({ space }: { space: SpaceSettings }) {
  const [open, setOpen] = useState(false),
    [confirmName, setName] = useState("");
  const id = useId(),
    router = useRouter();
  const mutation = useSpaceMutation(deleteSpace);
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold">스페이스 지우기</h2>
      <p className="text-sm text-muted-foreground">
        모든 멤버가 이 스페이스의 대화를 볼 수 없게 돼요
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="destructive">스페이스 지우기</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{space.name}을 지울까요?</DialogTitle>
            <DialogDescription>
              확인하려면 스페이스 이름을 정확히 입력해 주세요
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (confirmName === space.name)
                void mutation.submit(
                  { spaceId: space.id, confirmName },
                  () => {
                    setOpen(false);
                    router.push("/messages");
                  },
                  "스페이스를 지웠어요",
                );
            }}
          >
            <Label htmlFor={id}>확인 이름</Label>
            <Input
              id={id}
              value={confirmName}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
            {mutation.error && (
              <p role="alert" className="text-sm text-destructive">
                {mutation.error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                돌아가기
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={confirmName !== space.name || mutation.pending}
              >
                지우기
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
