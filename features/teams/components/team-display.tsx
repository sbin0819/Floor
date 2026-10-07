import type { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function TeamSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold">{title}</h2>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
    </section>
  );
}

export function EmptyTeamList({ children }: { children: ReactNode }) {
  return <p className="py-3 text-sm text-muted-foreground">{children}</p>;
}

export function TeamDate({ value }: { value: string }) {
  const label = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
  return (
    <time className="tabular-nums" dateTime={value}>
      {label} (한국 시간)
    </time>
  );
}

export function roleLabel(role: "admin" | "member") {
  return role === "admin" ? "팀 관리자" : "팀원";
}

export const teamLinkClassName =
  "inline-flex min-h-11 items-center rounded-lg underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";
