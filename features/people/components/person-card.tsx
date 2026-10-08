"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { avatarSchema } from "@/lib/avatar";
import { UserAvatar } from "@/components/user-avatar";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { PersonProfile } from "../types";
import type { FriendActions } from "./friend-controls";
import { ProfilePersonActions } from "./person-actions";
import { PersonStatus } from "./person-status";

const profileSchema = z.strictObject({
  userId: z.uuid(),
  name: z.string(),
  avatar: avatarSchema,
  username: z.string().nullable(),
  isMe: z.boolean(),
  relation: z
    .enum(["none", "friend", "incoming", "outgoing", "blocked"])
    .nullable(),
  sharedSpaces: z.array(z.strictObject({ id: z.uuid(), name: z.string() })),
  directRoomId: z.uuid().nullable(),
  canDirectMessage: z.boolean(),
});
export type ReadPersonProfile = (
  userId: string,
  signal: AbortSignal,
) => Promise<PersonProfile | null>;
export const readPersonProfile: ReadPersonProfile = async (userId, signal) => {
  const response = await fetch(`/api/people/${encodeURIComponent(userId)}`, {
    signal,
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Profile unavailable");
  return profileSchema.parse(await response.json());
};
function subscribeNarrow(listener: () => void) {
  const media = window.matchMedia?.("(max-width: 767px)");
  media?.addEventListener("change", listener);
  return () => media?.removeEventListener("change", listener);
}
const narrowSnapshot = () =>
  window.matchMedia?.("(max-width: 767px)").matches ?? false;
const serverSnapshot = () => false;

export function PersonCard({
  userId,
  name,
  children,
  read = readPersonProfile,
  actions,
}: {
  userId: string;
  name: string;
  children: ReactElement;
  read?: ReadPersonProfile;
  actions?: FriendActions;
}) {
  const [open, setOpen] = useState(false);
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    narrowSnapshot,
    serverSnapshot,
  );
  const content = open ? (
    <ProfileContent
      key={userId}
      userId={userId}
      read={read}
      actions={actions}
    />
  ) : null;
  if (narrow)
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{children}</SheetTrigger>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          aria-describedby={undefined}
          className="max-h-[85dvh] overflow-y-auto rounded-t-xl p-5"
        >
          <SheetTitle className="sr-only">{name} 프로필</SheetTitle>
          <SheetClose asChild>
            <Button
              size="icon"
              variant="ghost"
              className="absolute top-2 right-2"
              aria-label="프로필 닫기"
            >
              <X aria-hidden="true" />
            </Button>
          </SheetClose>
          {content}
        </SheetContent>
      </Sheet>
    );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        aria-label={`${name} 프로필`}
        className="w-80 max-w-[calc(100vw-2rem)] p-5"
        align="start"
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}

function ProfileContent({
  userId,
  read,
  actions,
}: {
  userId: string;
  read: ReadPersonProfile;
  actions?: FriendActions;
}) {
  const query = useQuery({
    queryKey: ["people", userId],
    queryFn: ({ signal }) => read(userId, signal),
    staleTime: 30_000,
    retry: false,
  });
  if (query.isError)
    return <p role="alert">프로필을 불러오지 못했어요. 다시 열어 주세요</p>;
  if (query.isPending)
    return (
      <div
        role="status"
        aria-label="프로필을 불러오고 있어요"
        className="space-y-3"
      >
        <Skeleton className="size-16 rounded-full" />
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  if (!query.data) return <p>이 사용자를 볼 수 없어요</p>;
  return <PersonProfileContent person={query.data} actions={actions} />;
}

export function PersonProfileContent({
  person,
  actions,
  preview = false,
}: {
  person: PersonProfile;
  actions?: FriendActions;
  preview?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <UserAvatar
          name={person.name}
          avatar={person.avatar}
          size={64}
          className="mb-3"
        />
        <h2 className="text-lg font-bold">{person.name}</h2>
        <PersonStatus
          userId={person.userId}
          sharesSpace={person.sharedSpaces.length > 0}
          showLabel
        />
        {person.username && (
          <p className="text-sm text-muted-foreground">@{person.username}</p>
        )}
      </div>
      {person.sharedSpaces.length > 0 && (
        <section aria-label="같이 있는 스페이스">
          <h3 className="mb-1 text-xs font-semibold text-muted-foreground">
            같이 있는 스페이스
          </h3>
          <ul>
            {person.sharedSpaces.map((space) => (
              <li key={space.id}>
                {preview ? (
                  <span className="inline-flex min-h-11 items-center text-sm">
                    {space.name}
                  </span>
                ) : (
                  <Link
                    href={`/s/${space.id}`}
                    className="inline-flex min-h-11 items-center rounded-md text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {space.name}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {preview ? (
        <Button disabled variant="outline">
          {person.isMe ? "설정" : "메시지"}
        </Button>
      ) : person.isMe ? (
        <Button asChild variant="outline">
          <Link href="/settings">설정</Link>
        </Button>
      ) : (
        <ProfilePersonActions person={person} actions={actions} />
      )}
    </div>
  );
}
