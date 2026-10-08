"use client";

import Link from "next/link";
import { useState } from "react";
import { SegmentedLink, SegmentedLinks } from "@/components/segmented-links";
import type { FriendsTab, FriendsView } from "../types";
import { UsernameForm, type SaveUsername } from "./username-form";
import { PeopleSearch, type SearchPeople } from "./people-search";
import { FriendControls, type FriendActions } from "./friend-controls";
import { PersonSummary } from "./person-summary";

export function FriendsScreen({
  data,
  tab,
  actions,
  search,
  saveUsername,
}: {
  data: FriendsView;
  tab: FriendsTab;
  actions?: FriendActions;
  search?: SearchPeople;
  saveUsername?: SaveUsername;
}) {
  const [savedUsername, setSavedUsername] = useState<string | null>(null);
  const labels = { all: "모두", received: "받은 요청", sent: "보낸 요청" };
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
        {(["all", "received", "sent"] as const).map((item) => (
          <SegmentedLink asChild key={item} selected={tab === item}>
            <Link
              href={item === "all" ? "/friends" : `/friends?tab=${item}`}
              aria-label={
                item === "received" && data.receivedCount > 0
                  ? `${labels[item]} ${data.receivedCount}`
                  : labels[item]
              }
            >
              {labels[item]}
              {item === "received" && data.receivedCount > 0 && (
                <span className="tabular-nums"> {data.receivedCount}</span>
              )}
            </Link>
          </SegmentedLink>
        ))}
      </SegmentedLinks>
      <section
        aria-label={labels[tab]}
        className="overflow-hidden rounded-xl border border-border bg-card"
      >
        {data.rows.length > 0 ? (
          <ul className="divide-y divide-border">
            {data.rows.map((person) => (
              <li
                key={person.userId}
                className="flex flex-wrap items-center gap-3 p-4"
              >
                <PersonSummary person={person} />
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
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-6 text-sm text-muted-foreground">
            {tab === "all"
              ? "아직 친구가 없어요. 위에서 사용자 이름이나 이메일로 찾아 보세요"
              : tab === "received"
                ? "받은 요청이 없어요"
                : "보낸 요청이 없어요"}
          </p>
        )}
      </section>
    </div>
  );
}
