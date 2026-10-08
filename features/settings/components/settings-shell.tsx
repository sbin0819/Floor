import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function SettingsCard({
  title,
  children,
  description,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-card"
    >
      <h2 className="font-semibold">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      {children}
    </section>
  );
}
export function SettingsSkeleton({
  tab,
}: {
  tab: "profile" | "account" | "preferences";
}) {
  const titles =
    tab === "profile"
      ? ["아바타", "이름", "사용자 이름", "다른 사람에게 이렇게 보여요"]
      : tab === "account"
        ? ["이메일", "비밀번호 바꾸기", "로그인 수단", "로그인한 기기"]
        : ["기본 지점", "채팅", "예약 미리 알림"];
  return (
    <div className="grid gap-5 lg:grid-cols-2" aria-busy="true">
      <span role="status" className="sr-only">
        설정을 불러오고 있어요
      </span>
      {titles.map((title) => (
        <SettingsCard key={title} title={title}>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </SettingsCard>
      ))}
    </div>
  );
}
