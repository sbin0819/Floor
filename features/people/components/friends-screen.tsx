"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { SegmentedLink, SegmentedLinks } from "@/components/segmented-links";
import type { FriendsTab, FriendsView, MessageRequestRow } from "../types";
import { UsernameForm, type SaveUsername } from "./username-form";
import { PeopleSearch, type SearchPeople } from "./people-search";
import { FriendControls, type FriendActions } from "./friend-controls";
import { PersonSummary } from "./person-summary";
import { PersonCard } from "./person-card";
import { UnblockButton } from "./person-actions";
import { PendingMessageRequests } from "./message-requests-list";
import { Skeleton } from "@/components/ui/skeleton";

export function FriendsScreen({
  data,
  tab,
  actions,
  search,
  saveUsername,
  requests,
}: {
  data: FriendsView;
  tab: FriendsTab;
  actions?: FriendActions;
  search?: SearchPeople;
  saveUsername?: SaveUsername;
  requests?: Promise<MessageRequestRow[]>;
}) {
  const [savedUsername, setSavedUsername] = useState<string | null>(null);
  const labels = {
    all: "모두",
    received: "받은 요청",
    sent: "보낸 요청",
    requests: "메시지 요청",
    blocked: "차단",
  };
  return (
    <div className="space-y-6">
      {!data.settings.username && !savedUsername && (
        <section
          aria-label="사용자 이름 정하기"
          className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-card"
        >
          <div>
            <h2 className="font-semibold">
              사용자 이름을 정해 주세요. 친구가 이 이름으로 나를 찾아요
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              이메일 앞부분으로 제안했어요. 바꿔도 돼요
            </p>
          </div>
          <UsernameForm
            settings={data.settings}
            action={saveUsername}
            onSaved={setSavedUsername}
          />
        </section>
      )}
      <PeopleSearch actions={actions} search={search} />
      <SegmentedLinks label="친구 목록">
        {(["all", "received", "sent", "requests", "blocked"] as const).map(
          (item) => (
            <SegmentedLink asChild key={item} selected={tab === item}>
              <Link
                href={item === "all" ? "/friends" : `/friends?tab=${item}`}
                aria-label={
                  item === "received" && data.receivedCount > 0
                    ? `${labels[item]} ${data.receivedCount}`
                    : item === "requests" && data.messageRequestCount > 0
                      ? `${labels[item]} ${data.messageRequestCount}`
                      : labels[item]
                }
              >
                {labels[item]}
                {item === "received" && data.receivedCount > 0 && (
                  <span className="tabular-nums"> {data.receivedCount}</span>
                )}
                {item === "requests" && data.messageRequestCount > 0 && (
                  <span className="tabular-nums">
                    {" "}
                    {data.messageRequestCount}
                  </span>
                )}
              </Link>
            </SegmentedLink>
          ),
        )}
      </SegmentedLinks>
      <section
        aria-label={labels[tab]}
        className="overflow-hidden rounded-xl border border-border bg-card"
      >
        {tab === "requests" ? (
          <Suspense
            fallback={
              <Skeleton
                aria-label="메시지 요청을 불러오고 있어요"
                className="h-32 w-full"
              />
            }
          >
            {requests && (
              <PendingMessageRequests data={requests} now={data.settings.now} />
            )}
          </Suspense>
        ) : data.rows.length > 0 ? (
          <ul className="divide-y divide-border">
            {data.rows.map((person) => (
              <li
                key={person.userId}
                className="flex flex-wrap items-center gap-3 p-4"
              >
                <PersonCard
                  userId={person.userId}
                  name={person.name}
                  actions={actions}
                >
                  <button
                    type="button"
                    aria-label={`${person.name} 프로필`}
                    className="flex min-h-11 min-w-0 flex-1 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <PersonSummary person={person} />
                  </button>
                </PersonCard>
                {tab === "blocked" ? (
                  <UnblockButton userId={person.userId} />
                ) : (
                  <FriendControls
                    person={person}
                    relation={
                      tab === "all"
                        ? "friend"
                        : tab === "received"
                          ? "incoming"
                          : "outgoing"
                    }
                    actions={actions}
                    list
                  />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-6 text-sm text-muted-foreground">
            {tab === "all"
              ? "아직 친구가 없어요. 위에서 사용자 이름이나 이메일로 찾아 보세요"
              : tab === "received"
                ? "받은 요청이 없어요"
                : tab === "blocked"
                  ? "차단한 사람이 없어요"
                  : "보낸 요청이 없어요"}
          </p>
        )}
      </section>
    </div>
  );
}
