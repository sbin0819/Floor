import type { ReactNode } from "react";
import { CalendarDays, MapPin, Users } from "lucide-react";

export function MemberAuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-[1088px] items-center gap-16 lg:grid-cols-[minmax(0,1fr)_400px]">
      <aside aria-label="Floor 소개" className="hidden space-y-8 lg:block">
        <p className="text-4xl font-semibold tracking-tight">Floor</p>
        <h2 className="max-w-lg text-3xl leading-snug font-semibold tracking-tight">
          공유오피스의 빈 공간을 찾아 바로 예약해요
        </h2>
        <ul className="space-y-5 text-muted-foreground">
          <li className="flex items-center gap-3">
            <MapPin aria-hidden="true" className="size-5 shrink-0" />
            지점과 층을 골라 지금 빈 공간을 찾아요
          </li>
          <li className="flex items-center gap-3">
            <CalendarDays aria-hidden="true" className="size-5 shrink-0" />
            하루 일정을 보고 필요한 시간을 예약해요
          </li>
          <li className="flex items-center gap-3">
            <Users aria-hidden="true" className="size-5 shrink-0" />
            팀에 모여 함께 쓸 공간을 정해요
          </li>
        </ul>
      </aside>
      <div className="mx-auto w-full max-w-[400px]">{children}</div>
    </div>
  );
}
