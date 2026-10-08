"use client";

import { useState, useSyncExternalStore } from "react";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PersonCard,
  type ReadPersonProfile,
} from "@/features/people/components/person-card";
import type { TeamMember, TeamPageData } from "../types";
import { TeamMemberMenu } from "./team-member-menu";

function subscribeViewport(listener: () => void) {
  const media = window.matchMedia?.("(max-width: 767px)");
  media?.addEventListener("change", listener);
  return () => media?.removeEventListener("change", listener);
}
const narrowViewport = () =>
  window.matchMedia?.("(max-width: 767px)").matches ?? false;
const serverViewport = () => false;

function MemberName({
  member,
  self,
  readPerson,
}: {
  member: TeamMember;
  self: boolean;
  readPerson?: ReadPersonProfile;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <UserAvatar name={member.name} avatar={member.avatar} size={36} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <PersonCard userId={member.id} name={member.name} read={readPerson}>
            <button
              type="button"
              className="min-h-11 text-left font-medium hover:underline"
            >
              {member.name}
            </button>
          </PersonCard>
          {self && <Badge variant="secondary">나</Badge>}
        </div>
        {member.username && (
          <p className="truncate text-xs text-muted-foreground">
            @{member.username}
          </p>
        )}
      </div>
    </div>
  );
}
function Role({
  role,
  narrow = false,
}: {
  role: TeamMember["role"];
  narrow?: boolean;
}) {
  return (
    <Badge
      variant="secondary"
      className={role === "admin" ? "bg-primary/10 text-primary" : undefined}
    >
      {role === "admin" ? (narrow ? "관리자" : "팀 관리자") : "팀원"}
    </Badge>
  );
}
export function TeamMembers({
  data,
  readPerson,
}: {
  data: TeamPageData;
  readPerson?: ReadPersonProfile;
}) {
  const [query, setQuery] = useState("");
  const narrow = useSyncExternalStore(
    subscribeViewport,
    narrowViewport,
    serverViewport,
  );
  const adminCount = data.members.filter(
    (member) => member.role === "admin",
  ).length;
  const search = query.normalize("NFC").trim().toLowerCase();
  const members = data.members.filter((member) =>
    [member.name, member.username, member.title].some((value) =>
      value?.normalize("NFC").toLowerCase().includes(search),
    ),
  );
  const emailById =
    data.role === "admin"
      ? new Map(data.members.map((member) => [member.id, member.email]))
      : null;
  return (
    <section className="space-y-4" aria-label="팀원 목록">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Input
          aria-label="팀원 찾기"
          placeholder="이름, 사용자 이름, 직함"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="max-w-sm"
        />
        <p className="text-sm text-muted-foreground tabular-nums">
          팀 관리자 {adminCount}명 · 팀원 {data.memberCount - adminCount}명
        </p>
      </div>
      {members.length === 0 ? (
        <p className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
          {data.members.length ? "찾는 팀원이 없어요" : "팀원이 없어요"}
        </p>
      ) : narrow ? (
        <ul className="divide-y rounded-xl border bg-card">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex items-center justify-between gap-2 p-4"
            >
              <div className="min-w-0 space-y-2">
                <MemberName
                  member={member}
                  self={member.id === data.userId}
                  readPerson={readPerson}
                />
                <div className="flex flex-wrap items-center gap-2 pl-12">
                  <Role role={member.role} narrow />
                  <span className="text-xs text-muted-foreground">
                    {member.title || "—"}
                  </span>
                </div>
              </div>
              <TeamMemberMenu
                data={data}
                member={member}
                adminCount={adminCount}
                narrow
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableCaption className="sr-only">
              {data.name} 팀원 목록
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>직함</TableHead>
                <TableHead>역할</TableHead>
                {emailById && <TableHead>이메일</TableHead>}
                <TableHead>
                  <span className="sr-only">메뉴</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <MemberName
                      member={member}
                      self={member.id === data.userId}
                      readPerson={readPerson}
                    />
                  </TableCell>
                  <TableCell>{member.title || "—"}</TableCell>
                  <TableCell>
                    <Role role={member.role} />
                  </TableCell>
                  {emailById && (
                    <TableCell className="break-all text-muted-foreground">
                      {emailById.get(member.id)}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <TeamMemberMenu
                      data={data}
                      member={member}
                      adminCount={adminCount}
                      narrow={false}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {data.memberCount > 1 && (
        <p className="text-xs leading-5 text-muted-foreground">
          팀을 떠나려면 내 줄의 메뉴에서 팀 나가기. 팀 관리자가 나 혼자면 먼저
          다른 팀원을 팀 관리자로 지정해요.
        </p>
      )}
    </section>
  );
}
