"use client";

import { useState, type SubmitEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { teamSearchSchema } from "@/features/teams/schema";
import { TeamInput } from "./team-fields";

export function TeamSearchForm({ query }: { query: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = teamSearchSchema.safeParse(
      new FormData(event.currentTarget).get("q"),
    );
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "검색어를 확인해 주세요");
      return;
    }
    setError("");
    router.push(`/teams/start?q=${encodeURIComponent(parsed.data)}`);
  }
  return (
    <form
      action="/teams/start"
      method="get"
      onSubmit={onSubmit}
      noValidate
      role="search"
      aria-label="팀 찾기"
      className="flex flex-wrap items-start gap-3"
    >
      <div className="min-w-48 flex-1">
        <TeamInput
          label="팀 이름으로 찾기"
          name="q"
          defaultValue={query}
          error={error}
          required
        />
      </div>
      <Button variant="outline" type="submit" className="mt-6">
        검색
      </Button>
    </form>
  );
}
