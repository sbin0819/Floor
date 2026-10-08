"use client";
import { UserAvatar } from "@/components/user-avatar";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Volume2 } from "lucide-react";
import type { ChatSpaceNav } from "@/features/chat/types";
import { shouldInterceptNavigation } from "@/components/optimistic-navigation";
import { useCall } from "./call-provider";
import { cn } from "cn";

export function VoiceChannelList({
  space,
  enabled,
  selected,
}: {
  space: ChatSpaceNav;
  enabled: boolean;
  selected: string | null;
}) {
  const call = useCall();
  const router = useRouter();
  return (
    <section aria-label="음성 채널" className="space-y-2 pt-4">
      <h2 className="px-3 text-xs font-semibold text-muted-foreground">
        음성 채널
      </h2>
      {space.voiceChannels.map((room) => {
        const href = `/s/${space.id}/${room.id}`;
        const target = {
          roomId: room.id,
          roomKind: "voice" as const,
          name: room.name,
          href,
          participants: room.participants,
        };
        return (
          <div key={room.id}>
            <Link
              href={href}
              aria-current={selected === room.id ? "page" : undefined}
              aria-label={`${room.name}, ${room.participantCount}명${room.participantCount >= room.capacity ? ", 인원 참" : ""}${!enabled ? ", 통화를 쓸 수 없어요" : ""}`}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-sm px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring",
                selected === room.id
                  ? "bg-sidebar-accent font-semibold"
                  : "text-muted-foreground hover:bg-sidebar-accent/60",
              )}
              onClick={(event) => {
                if (!shouldInterceptNavigation(event)) return;
                event.preventDefault();
                if (enabled && call.call?.roomId !== room.id)
                  void call.join(target);
                router.push(href);
              }}
            >
              <Volume2 className="size-5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{room.name}</span>
              <span className="text-xs tabular-nums">
                {room.participantCount >= room.capacity
                  ? `${room.participantCount}/${room.capacity}`
                  : room.participantCount || ""}
              </span>
            </Link>
            {space.kind === "branch"
              ? room.participantCount > 0 && (
                  <p className="pl-10 text-xs text-muted-foreground tabular-nums">
                    {room.participantCount}명
                  </p>
                )
              : room.participants.length > 0 && (
                  <ul className="space-y-1 py-1 pl-10">
                    {room.participants.map((person) => (
                      <li
                        key={person.userId}
                        className="flex items-center gap-2 text-sm"
                      >
                        <UserAvatar
                          name={person.name}
                          avatar={person.avatar}
                          size={20}
                          className={cn(
                            "rounded-full",
                            call.call?.roomId === room.id &&
                              call.participants.some(
                                (active) =>
                                  active.userId === person.userId &&
                                  active.speaking,
                              ) &&
                              "ring-2 ring-primary",
                          )}
                        />
                        <span className="truncate">{person.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
          </div>
        );
      })}
    </section>
  );
}
