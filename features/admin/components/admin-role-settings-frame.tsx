import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { permissionKeys, roles } from "@/lib/permissions/keys";
import type { RoleLimits } from "@/lib/permissions/types";
import { roleLabels, permissionLabels } from "../role-settings-editor";
export { roleLabels, permissionLabels } from "../role-settings-editor";
export const limitKeys = [
  "maxMinutesPerBooking",
  "maxMinutesPerDay",
  "maxDaysAhead",
] as const;
export const limitLabels: Record<keyof RoleLimits, string> = {
  maxMinutesPerBooking: "한 번에 최대",
  maxMinutesPerDay: "하루 합계",
  maxDaysAhead: "며칠 앞까지",
};

export function AdminRoleSettingsFrame({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
      <header className="sticky top-[var(--admin-mobile-header-height,0px)] z-30 flex flex-wrap items-center justify-between gap-4 bg-background py-2">
        <div>
          <h1 className="text-2xl font-bold">역할과 권한</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            역할별로 할 수 있는 일과 예약 한도를 정해요
          </p>
        </div>
        {actions}
      </header>
      {children}
    </main>
  );
}
export function AdminRoleSettingsSkeleton() {
  return (
    <AdminRoleSettingsFrame>
      <section
        aria-busy="true"
        className="space-y-5 rounded-xl border bg-card p-4 sm:p-6"
      >
        <span role="status" className="sr-only">
          역할 설정을 불러오고 있어요
        </span>
        <h2 className="font-semibold">역할별 권한</h2>
        <div className="hidden lg:block">
          <table className="w-full table-fixed text-left text-sm">
            <thead>
              <tr>
                <th className="w-[36%] py-3">권한</th>
                {roles.map((role) => (
                  <th key={role} className="text-center">
                    {roleLabels[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissionKeys.map((key) => (
                <tr key={key} className="border-t">
                  <th scope="row" className="py-4 font-medium">
                    {permissionLabels[key]}
                  </th>
                  {roles.map((role) => (
                    <td key={role}>
                      <Skeleton className="mx-auto h-5 w-8" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-3 lg:hidden">
          {roles.map((role) => (
            <div key={role} className="rounded-lg border p-4">
              <h3>{roleLabels[role]}</h3>
              <Skeleton className="mt-4 h-12 w-full" />
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-3 rounded-xl border p-6">
        <h2 className="font-semibold">예약 한도</h2>
        {limitKeys.map((key) => (
          <div key={key} className="flex justify-between gap-4">
            <span className="text-sm">{limitLabels[key]}</span>
            <Skeleton className="h-6 w-32" />
          </div>
        ))}
      </section>
    </AdminRoleSettingsFrame>
  );
}
