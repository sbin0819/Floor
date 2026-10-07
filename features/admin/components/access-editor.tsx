"use client";

import { useId, useState, type Ref } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { setFloorAccess, setSpaceAccess } from "@/features/admin/actions";
import {
  setFloorAccessSchema,
  setSpaceAccessSchema,
} from "@/features/admin/schema";
import { allowedSpaceAccessValues } from "@/features/admin/access-rules";
import type {
  AdminFloorData,
  AdminSpace,
  TeamOption,
} from "@/features/admin/types";
import type { AccessScope } from "@/lib/permissions/types";
import { FormMessage } from "./form-fields";
import { useAdminMutation } from "./use-admin-mutation";

export const accessLabels = {
  everyone: "모두",
  teams: "지정한 팀",
  closed: "닫힘",
  inherit: "층 설정을 따름",
};
export function AccessEditor({
  data,
  space,
  headingRef,
}: {
  data: AdminFloorData;
  space?: AdminSpace;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const id = useId();
  const router = useRouter();
  const pathname = usePathname();
  const [access, setAccess] = useState<AccessScope | "inherit">(
    (space ? space.access : data.floor.access) ?? "inherit",
  );
  const [teams, setTeams] = useState<TeamOption[]>(
    space ? space.allowedTeams : data.floor.allowedTeams,
  );
  const [query, setQuery] = useState(data.teamSearch.query);
  const [savedMessage, setSavedMessage] = useState("");
  const mutation = useAdminMutation<
    | { spaceId: string }
    | {
        floorId: string;
        changedSpaces: {
          id: string;
          name: string;
          access: AccessScope | null;
        }[];
      }
  >({
    action: space ? setSpaceAccess : setFloorAccess,
    successMessage: (result) => {
      if (!("changedSpaces" in result) || result.changedSpaces.length === 0)
        return "저장했어요";
      const closed = result.changedSpaces
        .filter((item) => item.access === "closed")
        .map((item) => item.name);
      return `저장했어요. 공간 ${result.changedSpaces.length}곳의 이용 대상도 층에 맞게 바뀌었어요${closed.length ? `. ${closed.join(", ")}은 쓸 수 있는 팀이 없어 닫힘이 됐어요` : ""}`;
    },
    onSuccess: (result) => {
      if (!("changedSpaces" in result) || result.changedSpaces.length === 0) {
        setSavedMessage("저장했어요");
        return;
      }
      const closed = result.changedSpaces
        .filter((item) => item.access === "closed")
        .map((item) => item.name);
      setSavedMessage(
        `저장했어요. 공간 ${result.changedSpaces.length}곳의 이용 대상도 층에 맞게 바뀌었어요${closed.length ? `. ${closed.join(", ")}은 쓸 수 있는 팀이 없어 닫힘이 됐어요` : ""}`,
      );
    },
  });
  const disabled =
    !data.permissions.editAccess ||
    mutation.pending ||
    Boolean(space?.archivedAt);
  const allowed: (AccessScope | null)[] = space
    ? allowedSpaceAccessValues(data.floor.access)
    : ["everyone", "teams", "closed"];
  const search = () => {
    const params = new URLSearchParams();
    if (query) params.set("team", query);
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, {
      scroll: false,
    });
  };
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        setSavedMessage("");
        const values = {
          access: access === "inherit" ? null : access,
          teamIds: access === "teams" ? teams.map((team) => team.id) : [],
        };
        void mutation.submit(
          space ? setSpaceAccessSchema : setFloorAccessSchema,
          space
            ? { spaceId: space.id, ...values }
            : { floorId: data.floor.id, ...values },
        );
      }}
    >
      <h2
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className="font-semibold focus-visible:rounded focus-visible:outline-2 focus-visible:outline-ring"
      >
        {space ? "공간" : "층"} 이용 대상
      </h2>
      {!data.permissions.editAccess && (
        <p className="text-muted-foreground">
          읽기 전용이에요. 이용 대상을 고칠 권한이 없어요
        </p>
      )}
      <RadioGroup
        aria-label={`${space ? "공간" : "층"} 이용 대상`}
        value={access}
        onValueChange={(value) => setAccess(value as AccessScope | "inherit")}
        disabled={disabled}
      >
        {(space
          ? (["inherit", "everyone", "teams", "closed"] as const)
          : (["everyone", "teams", "closed"] as const)
        ).map((value) => {
          const blocked = !allowed.includes(value === "inherit" ? null : value);
          return (
            <div key={value} className="space-y-1">
              <div className="flex min-h-11 items-center gap-3">
                <RadioGroupItem
                  id={`${id}-${value}`}
                  value={value}
                  disabled={disabled || blocked}
                  aria-describedby={
                    blocked ? `${id}-${value}-reason` : undefined
                  }
                />
                <Label
                  className="flex min-h-11 items-center"
                  htmlFor={`${id}-${value}`}
                >
                  {accessLabels[value]}
                </Label>
              </div>
              {blocked && (
                <p
                  id={`${id}-${value}-reason`}
                  className="text-sm text-muted-foreground"
                >
                  층이 &quot;{accessLabels[data.floor.access]}&quot;이라 고를 수
                  없어요
                </p>
              )}
            </div>
          );
        })}
      </RadioGroup>
      {access === "teams" && (
        <div
          className="space-y-3"
          role="group"
          aria-label="허용할 팀"
          aria-describedby={
            mutation.errors.teamIds ? `${id}-teams-error` : undefined
          }
        >
          <div>
            <Label htmlFor={`${id}-team`}>팀 이름으로 찾기</Label>
            <div className="mt-2 flex gap-2">
              <Input
                id={`${id}-team`}
                aria-invalid={Boolean(mutation.errors.teamIds)}
                aria-describedby={
                  mutation.errors.teamIds ? `${id}-teams-error` : undefined
                }
                value={query}
                disabled={disabled}
                maxLength={40}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (!disabled) search();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={search}
              >
                찾기
              </Button>
            </div>
          </div>
          {data.teamSearch.query && !data.teamSearch.valid && (
            <p className="text-muted-foreground">
              팀 이름은 2–40자로 입력해 주세요
            </p>
          )}
          {data.teamSearch.valid &&
            data.teamSearch.query &&
            data.teamSearch.results.length === 0 && (
              <p className="text-muted-foreground">찾은 팀이 없어요</p>
            )}
          <ul aria-label="팀 검색 결과" className="space-y-2">
            {data.teamSearch.results.map((team) => {
              const blocked = Boolean(
                space &&
                data.floor.access === "teams" &&
                !data.floor.allowedTeams.some(({ id }) => id === team.id),
              );
              const selected = teams.some(({ id }) => id === team.id);
              return (
                <li
                  key={team.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div>
                    <p>{team.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {team.homeBranchName ?? "주 이용 지점 없음"}
                      {blocked ? " · 이 층에서 허용하지 않은 팀이에요" : ""}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    type="button"
                    disabled={
                      disabled ||
                      selected ||
                      blocked ||
                      (!space && teams.length >= 20)
                    }
                    onClick={() =>
                      setTeams([...teams, { id: team.id, name: team.name }])
                    }
                  >
                    {selected ? "선택됨" : "선택"}
                  </Button>
                </li>
              );
            })}
          </ul>
          <ul aria-label="고른 팀" className="space-y-2">
            {teams.map((team) => (
              <li
                key={team.id}
                className="flex items-center justify-between gap-3"
              >
                <span>{team.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={`${team.name} 선택 해제`}
                  onClick={() =>
                    setTeams(teams.filter(({ id }) => id !== team.id))
                  }
                >
                  빼기
                </Button>
              </li>
            ))}
          </ul>
          {teams.length === 0 && (
            <p className="text-muted-foreground">
              허용할 팀을 한 곳 이상 골라 주세요
            </p>
          )}
          {mutation.errors.teamIds && (
            <p
              id={`${id}-teams-error`}
              role="alert"
              className="text-destructive"
            >
              {mutation.errors.teamIds}
            </p>
          )}
        </div>
      )}
      <FormMessage message={mutation.message} />
      <p role="status" className="text-sm">
        {savedMessage}
      </p>
      <Button type="submit" disabled={disabled}>
        이용 대상 저장
      </Button>
    </form>
  );
}
