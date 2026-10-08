"use client";

import { useId, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createChannel, updateChannel } from "@/features/chat/space-actions";
import { channelNameSchema } from "../space-schema";
import { useSpaceMutation } from "./use-space-mutation";

type Channel = {
  id: string;
  name: string;
  topic: string | null;
  adminOnly: boolean;
};
export function ChannelDialog({
  spaceId,
  channel,
  compact = false,
  returnHref,
}: {
  spaceId: string;
  channel?: Channel;
  compact?: boolean;
  returnHref?: string;
}) {
  const [open, setOpen] = useState(!!returnHref);
  const pathname = usePathname(),
    router = useRouter();
  function changeOpen(value: boolean) {
    setOpen(value);
    if (!value && returnHref && pathname === `/s/${spaceId}/settings`)
      router.replace(returnHref, { scroll: false });
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {!returnHref && (
        <DialogTrigger asChild>
          <Button
            size={compact ? "icon" : "default"}
            variant="ghost"
            aria-label={channel ? `${channel.name} 채널 설정` : "채널 만들기"}
          >
            {compact ? "+" : channel ? "채널 설정" : "채널 만들기"}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{channel ? "채널 설정" : "채널 만들기"}</DialogTitle>
          <DialogDescription>
            함께 이야기할 주제와 이용 방식을 정해요
          </DialogDescription>
        </DialogHeader>
        {open && (
          <ChannelForm
            spaceId={spaceId}
            channel={channel}
            onClose={() => changeOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
function ChannelForm({
  spaceId,
  channel,
  onClose,
}: {
  spaceId: string;
  channel?: Channel;
  onClose: () => void;
}) {
  const id = useId(),
    router = useRouter();
  const [name, setName] = useState(channel?.name ?? ""),
    [topic, setTopic] = useState(channel?.topic ?? ""),
    [adminOnly, setAdminOnly] = useState(channel?.adminOnly ?? false);
  const parsed = channelNameSchema.safeParse(name);
  const valid = parsed.success && Array.from(topic.trim()).length <= 200;
  const mutation = useSpaceMutation(
    channel
      ? async (input: unknown) => {
          const result = await updateChannel(input);
          return result.ok
            ? { ok: true as const, data: { roomId: channel.id } }
            : result;
        }
      : createChannel,
  );
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        void mutation.submit(
          {
            ...(channel ? { roomId: channel.id } : { spaceId }),
            name,
            topic,
            adminOnly,
          },
          (data) => {
            onClose();
            if (!channel) router.push(`/s/${spaceId}/${data.roomId}`);
          },
          channel ? "채널을 바꿨어요" : "채널을 만들었어요",
        );
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={`${id}-name`}>채널 이름</Label>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-describedby={`${id}-preview`}
        />
        <p id={`${id}-preview`} className="text-sm text-muted-foreground">
          {parsed.success
            ? `# ${parsed.data}`
            : "한글·영문 소문자·숫자·하이픈으로 1자부터 30자까지"}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-topic`}>주제</Label>
        <Textarea
          id={`${id}-topic`}
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          aria-invalid={Array.from(topic.trim()).length > 200}
        />
      </div>
      <div className="flex items-center gap-3">
        <Switch
          id={`${id}-admin`}
          checked={adminOnly}
          onCheckedChange={setAdminOnly}
        />
        <Label htmlFor={`${id}-admin`}>관리자만 쓰기</Label>
      </div>
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          돌아가기
        </Button>
        <Button disabled={!valid || mutation.pending} type="submit">
          {channel ? "저장" : "만들기"}
        </Button>
      </DialogFooter>
    </form>
  );
}
